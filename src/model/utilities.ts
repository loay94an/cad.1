/**
 * The other utilities on the plan: water, drainage, heating, ventilation and
 * gas. Each has points (a tap, a radiator, a valve, …) and runs (pipes or
 * ducts drawn as lines from point to point). Floor (world) coordinates, mm.
 */
import { type Id, uid } from './schema';

export type UtilityId = 'water' | 'drain' | 'heating' | 'ventilation' | 'gas';

export interface UtilKind {
  id: string;
  label: string;
  /** One to three letters drawn in the symbol. */
  code: string;
  /** Equipment (meter, boiler, unit) is drawn as a square, the rest as a circle. */
  box?: boolean;
}

export interface RunKind {
  id: string;
  label: string;
  color: string;
  dashed?: boolean;
  /** Usual outside diameter in mm, offered as the default. */
  size_mm: number;
}

export interface UtilityInfo {
  id: UtilityId;
  label: string;
  icon: string;
  color: string;
  /** "pipe" or "duct", for the texts. */
  line: string;
  points: UtilKind[];
  runs: RunKind[];
}

export const UTILITIES: UtilityInfo[] = [
  {
    id: 'water',
    label: 'Water',
    icon: '💧',
    color: '#1d4ed8',
    line: 'pipe',
    points: [
      { id: 'meter', label: 'Water meter', code: 'WM', box: true },
      { id: 'valve', label: 'Stop valve', code: 'V' },
      { id: 'tap', label: 'Tap / connection', code: 'T' },
      { id: 'outdoor', label: 'Outdoor tap', code: 'OT' },
      { id: 'heater', label: 'Water heater', code: 'WH', box: true },
      { id: 'manifold', label: 'Manifold', code: 'MF', box: true },
      { id: 'softener', label: 'Softener / filter', code: 'SF', box: true },
    ],
    runs: [
      { id: 'cold', label: 'Cold water', color: '#1d4ed8', size_mm: 16 },
      { id: 'hot', label: 'Hot water', color: '#dc2626', size_mm: 16 },
      { id: 'rain', label: 'Rainwater supply', color: '#0e7490', dashed: true, size_mm: 16 },
    ],
  },
  {
    id: 'drain',
    label: 'Drainage',
    icon: '🚿',
    color: '#92400e',
    line: 'pipe',
    points: [
      { id: 'drain', label: 'Drain point', code: 'D' },
      { id: 'wc', label: 'Toilet', code: 'WC' },
      { id: 'floor', label: 'Floor drain', code: 'FD' },
      { id: 'stack', label: 'Stack (down pipe)', code: 'S' },
      { id: 'chamber', label: 'Inspection chamber', code: 'IC', box: true },
      { id: 'tank', label: 'Tank (rain / septic)', code: 'TK', box: true },
    ],
    runs: [
      { id: 'waste', label: 'Waste water', color: '#92400e', size_mm: 50 },
      { id: 'soil', label: 'Toilet waste', color: '#44403c', size_mm: 110 },
      { id: 'rain', label: 'Rainwater', color: '#0e7490', dashed: true, size_mm: 80 },
    ],
  },
  {
    id: 'heating',
    label: 'Heating',
    icon: '🔥',
    color: '#dc2626',
    line: 'pipe',
    points: [
      { id: 'source', label: 'Boiler / heat pump', code: 'HP', box: true },
      { id: 'radiator', label: 'Radiator', code: 'R' },
      { id: 'towel', label: 'Towel radiator', code: 'TR' },
      { id: 'manifold', label: 'Underfloor manifold', code: 'MF', box: true },
      { id: 'thermostat', label: 'Thermostat', code: 'TH' },
      { id: 'tank', label: 'Buffer / hot water tank', code: 'BT', box: true },
    ],
    runs: [
      { id: 'supply', label: 'Supply', color: '#dc2626', size_mm: 16 },
      { id: 'return', label: 'Return', color: '#1d4ed8', dashed: true, size_mm: 16 },
      { id: 'floor', label: 'Underfloor loop', color: '#ea580c', size_mm: 16 },
    ],
  },
  {
    id: 'ventilation',
    label: 'Ventilation',
    icon: '🌀',
    color: '#15803d',
    line: 'duct',
    points: [
      { id: 'unit', label: 'Ventilation unit', code: 'VU', box: true },
      { id: 'supply', label: 'Supply valve', code: 'S' },
      { id: 'extract', label: 'Extract valve', code: 'E' },
      { id: 'terminal', label: 'Roof / wall terminal', code: 'RT' },
      { id: 'hood', label: 'Cooker hood', code: 'CH', box: true },
      { id: 'box', label: 'Distribution box', code: 'DB', box: true },
    ],
    runs: [
      { id: 'supply', label: 'Supply air', color: '#15803d', size_mm: 125 },
      { id: 'extract', label: 'Extract air', color: '#7e22ce', dashed: true, size_mm: 125 },
    ],
  },
  {
    id: 'gas',
    label: 'Gas',
    icon: '⛽',
    color: '#a16207',
    line: 'pipe',
    points: [
      { id: 'meter', label: 'Gas meter', code: 'GM', box: true },
      { id: 'valve', label: 'Shut-off valve', code: 'V' },
      { id: 'point', label: 'Gas point', code: 'G' },
      { id: 'appliance', label: 'Gas appliance', code: 'GA', box: true },
    ],
    runs: [{ id: 'gas', label: 'Gas pipe', color: '#a16207', size_mm: 22 }],
  },
];

export const utilityInfo = (u: UtilityId): UtilityInfo => UTILITIES.find((x) => x.id === u) ?? UTILITIES[0];
export const pointKind = (u: UtilityId, kind: string): UtilKind => {
  const info = utilityInfo(u);
  return info.points.find((k) => k.id === kind) ?? info.points[0];
};
export const runKind = (u: UtilityId, kind: string): RunKind => {
  const info = utilityInfo(u);
  return info.runs.find((k) => k.id === kind) ?? info.runs[0];
};

export interface UtilPoint {
  id: Id;
  floorId: Id;
  utility: UtilityId;
  kind: string;
  x_mm: number;
  y_mm: number;
  label?: string;
  note?: string;
}

export interface UtilRun {
  id: Id;
  floorId: Id;
  utility: UtilityId;
  kind: string;
  /** The corners of the pipe, in order. */
  path: { x: number; y: number }[];
  /** Outside diameter. */
  size_mm?: number;
  label?: string;
}

/** What the next tap does: place a point of this kind, or add a corner to a pipe of this kind. */
export interface UtilTool {
  type: 'point' | 'run';
  kind: string;
}
export interface UtilSel {
  type: 'point' | 'run';
  id: Id;
}

export interface Utilities {
  points: UtilPoint[];
  runs: UtilRun[];
}

export const emptyUtilities = (): Utilities => ({ points: [], runs: [] });

export function newUtilPoint(floorId: Id, utility: UtilityId, kind: string, x: number, y: number): UtilPoint {
  return { id: uid(), floorId, utility, kind: pointKind(utility, kind).id, x_mm: Math.round(x), y_mm: Math.round(y) };
}

export function newUtilRun(floorId: Id, utility: UtilityId, kind: string, path: { x: number; y: number }[]): UtilRun {
  const k = runKind(utility, kind);
  return {
    id: uid(),
    floorId,
    utility,
    kind: k.id,
    path: path.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })),
    size_mm: k.size_mm,
  };
}

export const runLength_mm = (r: UtilRun) =>
  r.path.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - r.path[i].x, p.y - r.path[i].y), 0);

/** Metres of pipe per kind for one utility, in the order of its run kinds (kinds without pipe are left out). */
export function runTotals(u: Utilities, utility: UtilityId, floorId?: Id): { kind: RunKind; length_mm: number; count: number }[] {
  return utilityInfo(utility)
    .runs.map((kind) => {
      const runs = u.runs.filter((r) => r.utility === utility && r.kind === kind.id && (!floorId || r.floorId === floorId));
      return { kind, length_mm: runs.reduce((s, r) => s + runLength_mm(r), 0), count: runs.length };
    })
    .filter((t) => t.count);
}

/**
 * Where the next corner of a pipe goes: on a point or pipe corner of the same
 * utility when close, else straight (horizontal or vertical) from the
 * previous corner when nearly so.
 */
export function snapRunPoint(
  u: Utilities,
  utility: UtilityId,
  floorId: Id,
  p: { x: number; y: number },
  prev: { x: number; y: number } | undefined,
  tol: number,
): { x: number; y: number } {
  let best: { x: number; y: number; d: number } | null = null;
  const consider = (x: number, y: number) => {
    const d = Math.hypot(x - p.x, y - p.y);
    if (d <= tol && (!best || d < best.d)) best = { x, y, d };
  };
  for (const q of u.points) if (q.utility === utility && q.floorId === floorId) consider(q.x_mm, q.y_mm);
  for (const r of u.runs) if (r.utility === utility && r.floorId === floorId) for (const c of r.path) consider(c.x, c.y);
  if (best) return { x: (best as { x: number }).x, y: (best as { y: number }).y };
  const out = { x: Math.round(p.x), y: Math.round(p.y) };
  if (prev) {
    if (Math.abs(out.x - prev.x) <= tol * 0.7) out.x = prev.x;
    else if (Math.abs(out.y - prev.y) <= tol * 0.7) out.y = prev.y;
  }
  return out;
}

// ---- reading files ---------------------------------------------------------------

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown, f: number) => (typeof x === 'number' && Number.isFinite(x) ? x : f);
const str = (x: unknown, f: string) => (typeof x === 'string' ? x : f);
const IDS = UTILITIES.map((u) => u.id);

export function normalizeUtilities(x: unknown): Utilities | undefined {
  if (!isObj(x)) return undefined;
  const utilityOf = (v: unknown): UtilityId | null => (IDS.includes(v as UtilityId) ? (v as UtilityId) : null);
  const points: UtilPoint[] = [];
  for (const p of Array.isArray(x.points) ? x.points : []) {
    const utility = isObj(p) ? utilityOf(p.utility) : null;
    if (!isObj(p) || !utility) continue;
    const out: UtilPoint = {
      id: str(p.id, uid()),
      floorId: str(p.floorId, ''),
      utility,
      kind: pointKind(utility, str(p.kind, '')).id,
      x_mm: num(p.x_mm, 0),
      y_mm: num(p.y_mm, 0),
    };
    if (typeof p.label === 'string' && p.label) out.label = p.label;
    if (typeof p.note === 'string' && p.note) out.note = p.note;
    points.push(out);
  }
  const runs: UtilRun[] = [];
  for (const r of Array.isArray(x.runs) ? x.runs : []) {
    const utility = isObj(r) ? utilityOf(r.utility) : null;
    if (!isObj(r) || !utility) continue;
    const path = (Array.isArray(r.path) ? r.path : []).filter(isObj).map((c) => ({ x: num(c.x, 0), y: num(c.y, 0) }));
    if (path.length < 2) continue;
    const out: UtilRun = { id: str(r.id, uid()), floorId: str(r.floorId, ''), utility, kind: runKind(utility, str(r.kind, '')).id, path };
    if (typeof r.size_mm === 'number' && r.size_mm > 0) out.size_mm = r.size_mm;
    if (typeof r.label === 'string' && r.label) out.label = r.label;
    runs.push(out);
  }
  return { points, runs };
}
