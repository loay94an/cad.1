/**
 * Quantities for a renovation: floor and wall areas, skirting, doors and
 * windows per room, with totals per floor and for the house. Pure: no DOM.
 * Lengths in mm, areas in m².
 */
import { type Floor, type Project, type WallStatus, holeSize } from './schema';
import { floorLabel, hasSkirting } from './finishes';
import { HEADROOM_MM, ceilingCells, ceilingPlanes, headroomArea_m2, wallProfile } from '../geometry/ceiling';
import { type Gap, type RoomGeom, matchingWalls, roomGeometry, wallGaps } from '../geometry/floor';
import { signedArea } from '../geometry/vec';
import { UTILITIES, runTotals } from './utilities';
import { pointInfo } from './electrical';

export interface Count {
  count: number;
  area_m2: number;
}

export interface RoomQuantities {
  roomId: string;
  name: string;
  closed: boolean;
  floorArea_m2: number;
  /** Floor with at least the project's headroom. */
  usableArea_m2: number;
  perimeter_mm: number;
  skirting_mm: number;
  wallGross_m2: number;
  wallNet_m2: number;
  ceiling_m2: number;
  /** Includes doors and windows of the room behind that cut through a shared wall. */
  doors: Count;
  windows: Count;
  /** Floor covering label, '' when not set. */
  covering: string;
}

export interface Totals {
  floorArea_m2: number;
  usableArea_m2: number;
  perimeter_mm: number;
  skirting_mm: number;
  wallGross_m2: number;
  wallNet_m2: number;
  ceiling_m2: number;
  /** Each door and window once, even when it is in a wall between two rooms. */
  doors: Count;
  windows: Count;
}

export interface Grouped {
  /** Floor area per covering ('' = not set). */
  coverings: { covering: string; area_m2: number }[];
  /** New walls and walls to demolish, each physical wall once (inside face). */
  walls: { status: Exclude<WallStatus, 'existing'>; length_mm: number; area_m2: number }[];
  /** Metres of pipe per utility and kind. */
  pipes: { utility: string; kind: string; length_mm: number; count: number }[];
  /** Electrical points per kind. */
  electrical: { kind: string; count: number }[];
}

export interface FloorQuantities {
  floorId: string;
  name: string;
  rooms: RoomQuantities[];
  total: Totals;
  grouped: Grouped;
}

export interface HouseQuantities {
  floors: FloorQuantities[];
  total: Totals;
  grouped: Grouped;
}

const area = (poly: { x: number; y: number }[]) => Math.abs(signedArea(poly)) / 1e6;

/** Area under a piecewise linear profile, in mm². */
function profileArea(prof: { t: number; h: number }[]): number {
  let s = 0;
  for (let i = 1; i < prof.length; i++) s += ((prof[i].h + prof[i - 1].h) / 2) * (prof[i].t - prof[i - 1].t);
  return s;
}

/** Height of the profile at t (linear between points). */
function heightAt(prof: { t: number; h: number }[], t: number): number {
  for (let i = 1; i < prof.length; i++)
    if (t <= prof[i].t) {
      const p = prof[i - 1];
      const q = prof[i];
      return p.h + ((q.h - p.h) * (t - p.t)) / (q.t - p.t || 1);
    }
  return prof[prof.length - 1]?.h ?? 0;
}

/** The part of a gap (a..b along the wall, sill..top high) that is under the top of the wall, in mm². */
export function gapArea(prof: { t: number; h: number }[], gap: Pick<Gap, 'a' | 'b' | 'sill' | 'top'>): number {
  const L = prof[prof.length - 1]?.t ?? 0;
  const a = Math.max(0, gap.a);
  const b = Math.min(L, gap.b);
  if (b <= a || gap.top <= gap.sill) return 0;
  // Break where the profile bends or crosses the sill or the top: f is linear in between.
  const ts = new Set<number>([a, b]);
  for (let i = 1; i < prof.length; i++) {
    const p = prof[i - 1];
    const q = prof[i];
    if (q.t > a && q.t < b) ts.add(q.t);
    for (const level of [gap.sill, gap.top]) {
      if ((p.h - level) * (q.h - level) < 0) {
        const t = p.t + ((level - p.h) / (q.h - p.h)) * (q.t - p.t);
        if (t > a && t < b) ts.add(t);
      }
    }
  }
  const f = (t: number) => Math.max(0, Math.min(gap.top, heightAt(prof, t)) - gap.sill);
  const sorted = [...ts].sort((x, y) => x - y);
  let s = 0;
  for (let i = 1; i < sorted.length; i++) s += ((f(sorted[i]) + f(sorted[i - 1])) / 2) * (sorted[i] - sorted[i - 1]);
  return s;
}

function roomQuantities(g: RoomGeom, gapsOf: (k: number) => Gap[], defaultHeight: number, headroom: number): RoomQuantities {
  const room = g.room;
  const base: RoomQuantities = {
    roomId: room.id,
    name: room.name,
    closed: g.solved.closed,
    floorArea_m2: 0,
    usableArea_m2: 0,
    perimeter_mm: 0,
    skirting_mm: 0,
    wallGross_m2: 0,
    wallNet_m2: 0,
    ceiling_m2: 0,
    doors: { count: 0, area_m2: 0 },
    windows: { count: 0, area_m2: 0 },
    covering: floorLabel(room),
  };
  if (!g.solved.closed) return base;
  const planes = ceilingPlanes(g.inner, room.walls, room.height_mm ?? defaultHeight);
  let gross = 0;
  let holes = 0;
  let skirtingGaps = 0;
  for (let k = 0; k < g.inner.length; k++) {
    const own = room.walls[k]?.slope_deg ? undefined : room.walls[k]?.height_mm;
    const prof = wallProfile(g.inner, planes, k, own);
    gross += profileArea(prof);
    const L = prof[prof.length - 1]?.t ?? 0;
    for (const gap of gapsOf(k)) {
      holes += gapArea(prof, gap);
      const kind = gap.type === 'window' ? base.windows : gap.type === 'door' ? base.doors : null;
      if (kind) {
        kind.count++;
        kind.area_m2 += ((gap.b - gap.a) * (gap.top - gap.sill)) / 1e6;
      }
      // Skirting stops at doors and at openings down to the floor.
      if (gap.type !== 'window' && gap.sill <= 0) skirtingGaps += Math.max(0, Math.min(L, gap.b) - Math.max(0, gap.a));
    }
  }
  const ceiling = ceilingCells(g.inner, planes).reduce((s, c) => s + area(c.poly) * Math.hypot(1, c.plane.a, c.plane.b), 0);
  return {
    ...base,
    floorArea_m2: g.solved.area_m2,
    usableArea_m2: headroomArea_m2(g.inner, planes, headroom),
    perimeter_mm: g.solved.perimeter_mm,
    skirting_mm: hasSkirting(room) ? Math.max(0, g.solved.perimeter_mm - skirtingGaps) : 0,
    wallGross_m2: gross / 1e6,
    wallNet_m2: Math.max(0, gross - holes) / 1e6,
    ceiling_m2: ceiling,
  };
}

const emptyTotals = (): Totals => ({
  floorArea_m2: 0,
  usableArea_m2: 0,
  perimeter_mm: 0,
  skirting_mm: 0,
  wallGross_m2: 0,
  wallNet_m2: 0,
  ceiling_m2: 0,
  doors: { count: 0, area_m2: 0 },
  windows: { count: 0, area_m2: 0 },
});

function addTotals(into: Totals, x: Omit<Totals, 'doors' | 'windows'>) {
  into.floorArea_m2 += x.floorArea_m2;
  into.usableArea_m2 += x.usableArea_m2;
  into.perimeter_mm += x.perimeter_mm;
  into.skirting_mm += x.skirting_mm;
  into.wallGross_m2 += x.wallGross_m2;
  into.wallNet_m2 += x.wallNet_m2;
  into.ceiling_m2 += x.ceiling_m2;
}

/** Each door and window once: the floor's own openings that fit their wall. */
function openingCounts(floor: Floor, gaps: Map<string, Gap[]>): Pick<Totals, 'doors' | 'windows'> {
  const doors = { count: 0, area_m2: 0 };
  const windows = { count: 0, area_m2: 0 };
  for (const list of gaps.values())
    for (const gap of list) {
      if (gap.behind) continue;
      const op = floor.openings.find((o) => o.id === gap.openingId);
      const c = gap.type === 'door' ? doors : gap.type === 'window' ? windows : null;
      if (op && c) {
        c.count++;
        const hole = holeSize(op);
        c.area_m2 += (hole.width * hole.height) / 1e6;
      }
    }
  return { doors, windows };
}

/** New walls and walls to demolish, each physical wall once: the other side of a shared wall is skipped. */
function wallsByStatus(geoms: RoomGeom[], defaultHeight: number) {
  const seen = new Set<string>();
  const out = new Map<'new' | 'demolish', { length_mm: number; area_m2: number }>();
  for (const g of geoms) {
    if (!g.solved.closed) continue;
    const planes = ceilingPlanes(g.inner, g.room.walls, g.room.height_mm ?? defaultHeight);
    g.room.walls.forEach((w, k) => {
      const key = `${g.room.id}:${k}`;
      if (seen.has(key)) return;
      for (const m of matchingWalls(geoms, g.room.id, k)) seen.add(`${m.roomId}:${m.wallIndex}`);
      if (w.status !== 'new' && w.status !== 'demolish') return;
      const own = w.slope_deg ? undefined : w.height_mm;
      const prof = wallProfile(g.inner, planes, k, own);
      const sum = out.get(w.status) ?? { length_mm: 0, area_m2: 0 };
      sum.length_mm += prof[prof.length - 1]?.t ?? 0;
      sum.area_m2 += profileArea(prof) / 1e6;
      out.set(w.status, sum);
    });
  }
  return (['new', 'demolish'] as const).flatMap((status) => {
    const s = out.get(status);
    return s ? [{ status, ...s }] : [];
  });
}

function coverings(rooms: RoomQuantities[]) {
  const m = new Map<string, number>();
  for (const r of rooms) if (r.closed) m.set(r.covering, (m.get(r.covering) ?? 0) + r.floorArea_m2);
  return [...m]
    .map(([covering, area_m2]) => ({ covering, area_m2 }))
    .sort((a, b) => (a.covering === '' ? 1 : b.covering === '' ? -1 : a.covering.localeCompare(b.covering)));
}

function pipes(project: Project, floorId?: string) {
  const u = project.utilities;
  if (!u) return [];
  return UTILITIES.flatMap((info) =>
    runTotals(u, info.id, floorId).map((t) => ({ utility: info.label, kind: t.kind.label, length_mm: t.length_mm, count: t.count })),
  );
}

function electrical(project: Project, floorId?: string) {
  const m = new Map<string, number>();
  for (const p of project.electrical?.points ?? []) {
    if (floorId && p.floorId !== floorId) continue;
    const label = pointInfo(p.kind).label;
    m.set(label, (m.get(label) ?? 0) + 1);
  }
  return [...m].map(([kind, count]) => ({ kind, count }));
}

export function floorQuantities(project: Project, floor: Floor): FloorQuantities {
  const defaultHeight = project.settings.defaultHeight_mm ?? 2600;
  const headroom = project.settings.headroom_mm ?? HEADROOM_MM;
  const geoms = floor.rooms.map(roomGeometry);
  const closed = geoms.filter((g) => g.solved.closed);
  const gaps = wallGaps(closed, floor.openings);
  const rooms = geoms.map((g) => roomQuantities(g, (k) => gaps.get(`${g.room.id}:${k}`) ?? [], defaultHeight, headroom));
  const total = emptyTotals();
  for (const r of rooms) addTotals(total, r);
  Object.assign(total, openingCounts(floor, gaps));
  return {
    floorId: floor.id,
    name: floor.name,
    rooms,
    total,
    grouped: {
      coverings: coverings(rooms),
      walls: wallsByStatus(closed, defaultHeight),
      pipes: pipes(project, floor.id),
      electrical: electrical(project, floor.id),
    },
  };
}

export function houseQuantities(project: Project): HouseQuantities {
  const floors = [...project.floors].sort((a, b) => a.level - b.level).map((f) => floorQuantities(project, f));
  const total = emptyTotals();
  const walls = new Map<string, { length_mm: number; area_m2: number }>();
  for (const f of floors) {
    addTotals(total, f.total);
    for (const k of ['doors', 'windows'] as const) {
      total[k].count += f.total[k].count;
      total[k].area_m2 += f.total[k].area_m2;
    }
    for (const w of f.grouped.walls) {
      const s = walls.get(w.status) ?? { length_mm: 0, area_m2: 0 };
      s.length_mm += w.length_mm;
      s.area_m2 += w.area_m2;
      walls.set(w.status, s);
    }
  }
  return {
    floors,
    total,
    grouped: {
      coverings: coverings(floors.flatMap((f) => f.rooms)),
      walls: (['new', 'demolish'] as const).flatMap((status) => {
        const s = walls.get(status);
        return s ? [{ status, ...s }] : [];
      }),
      pipes: pipes(project),
      electrical: electrical(project),
    },
  };
}

// ---- spreadsheet ------------------------------------------------------------------

export const STATUS_LABEL = { new: 'New walls', demolish: 'Walls to demolish' } as const;

/**
 * The quantities as CSV for Excel / LibreOffice with Belgian settings:
 * UTF-8 with BOM, ';' between fields, decimal comma. Lengths in metres.
 */
export function quantitiesCsv(q: HouseQuantities, title: string): string {
  const dec = (x: number, digits = 2) => x.toFixed(digits).replace('.', ',');
  const m = (mm: number) => dec(mm / 1000);
  const cell = (v: string | number) => {
    const s = typeof v === 'number' ? String(v) : v;
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows: (string | number)[][] = [];
  const header = [
    'Floor',
    'Room',
    'Floor covering',
    'Floor area (m²)',
    'Usable area (m²)',
    'Perimeter (m)',
    'Skirting (m)',
    'Wall area gross (m²)',
    'Wall area net (m²)',
    'Ceiling area (m²)',
    'Doors',
    'Door area (m²)',
    'Windows',
    'Window area (m²)',
  ];
  const line = (floor: string, room: string, covering: string, x: Totals) => [
    floor,
    room,
    covering,
    dec(x.floorArea_m2),
    dec(x.usableArea_m2),
    m(x.perimeter_mm),
    m(x.skirting_mm),
    dec(x.wallGross_m2),
    dec(x.wallNet_m2),
    dec(x.ceiling_m2),
    x.doors.count,
    dec(x.doors.area_m2),
    x.windows.count,
    dec(x.windows.area_m2),
  ];
  rows.push([title], [], header);
  for (const f of q.floors) {
    for (const r of f.rooms) rows.push(r.closed ? line(f.name, r.name, r.covering, r) : [f.name, r.name, '', 'not closed']);
    rows.push(line(f.name, 'Total', '', f.total));
  }
  rows.push(line('House', 'Total', '', q.total));

  const g = q.grouped;
  if (g.coverings.length) {
    rows.push([], ['Floor area by covering'], ['Covering', 'Area (m²)']);
    for (const c of g.coverings) rows.push([c.covering || 'Not set', dec(c.area_m2)]);
  }
  if (g.walls.length) {
    rows.push([], ['Walls by status'], ['Status', 'Length (m)', 'Area, one face (m²)']);
    for (const w of g.walls) rows.push([STATUS_LABEL[w.status], m(w.length_mm), dec(w.area_m2)]);
  }
  if (g.pipes.length) {
    rows.push([], ['Pipes'], ['Utility', 'Kind', 'Length (m)', 'Runs']);
    for (const p of g.pipes) rows.push([p.utility, p.kind, m(p.length_mm), p.count]);
  }
  if (g.electrical.length) {
    rows.push([], ['Electrical points'], ['Kind', 'Count']);
    for (const e of g.electrical) rows.push([e.kind, e.count]);
  }
  return '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n';
}
