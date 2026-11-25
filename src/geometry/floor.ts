/** Rooms placed on a floor: wall thickness, snapping rooms together, door and window positions. */
import { type Opening, type Point, type Room, holeSize, holeSpan } from '../model/schema';
import { type SolvedRoom, solveRoom } from './room';
import {
  type Vec,
  add,
  angleDeg,
  cross,
  dist,
  dot,
  len,
  lineIntersect,
  mid,
  normDeg,
  raySegment,
  rotate,
  scale,
  signedArea,
  sub,
  unit,
  vec,
  wrapDeg,
} from './vec';

export interface RoomGeom {
  room: Room;
  solved: SolvedRoom;
  /** Inside faces of the walls, world coordinates. */
  inner: Vec[];
  /** Outside faces (inner offset by each wall's thickness). Empty if the room isn't closed. */
  outer: Vec[];
  /** Unit direction of wall k. */
  dirs: Vec[];
  /** Unit normal of wall k pointing out of the room. */
  normals: Vec[];
  thickness: number[];
  /**
   * The footprint of wall k. Where two walls meet, the stronger one (exterior,
   * not shared with another room, thicker) runs through the corner and the
   * other butts against it; equal walls meet on the diagonal.
   */
  pieces: Vec[][];
  /** Start and end of wall k's outside face (shorter than outer[k]..outer[k+1] where it butts). */
  outerFace: [Vec, Vec][];
  /** Start and end of wall k's inside face, lengthened where it runs through a corner. */
  innerFace: [Vec, Vec][];
}

export const toWorld = (room: { origin: Point; rotation_deg: number }, p: Vec): Vec =>
  add(rotate(p, room.rotation_deg), room.origin);

export function roomGeometry(room: Room): RoomGeom {
  const solved = solveRoom(room);
  const inner = solved.points.map((p) => toWorld(room, p));
  if (!solved.closed) return { room, solved, inner, outer: [], dirs: [], normals: [], thickness: [], pieces: [], outerFace: [], innerFace: [] };

  const n = inner.length;
  const clockwise = signedArea(inner) >= 0;
  const dirs = inner.map((p, i) => unit(sub(inner[(i + 1) % n], p)));
  const normals = dirs.map((d) => (clockwise ? vec(d.y, -d.x) : vec(-d.y, d.x)));
  const thickness = room.walls.map((w) => Math.max(0, w.thickness_mm));
  const tMax = Math.max(1, ...thickness);
  const outer = inner.map((p, i) => {
    const j = (i - 1 + n) % n;
    const q1 = add(p, scale(normals[j], thickness[j]));
    const q2 = add(p, scale(normals[i], thickness[i]));
    const x = lineIntersect(q1, dirs[j], q2, dirs[i]);
    return !x || dist(x, p) > 4 * tMax ? q2 : x;
  });
  const g: RoomGeom = { room, solved, inner, outer, dirs, normals, thickness, pieces: [], outerFace: [], innerFace: [] };
  setJoints(g, (k) => wallRank(g, k, false));
  return g;
}

/** Which wall runs through a corner: exterior first, then one not shared with another room, then the thicker. */
function wallRank(g: RoomGeom, k: number, shared: boolean): number {
  return (g.room.walls[k]?.kind === 'exterior' ? 2e6 : 0) + (shared ? 0 : 1e6) + Math.round(g.thickness[k]);
}

/** Splits every corner block between its two walls (see RoomGeom.pieces). */
function setJoints(g: RoomGeom, rank: (k: number) => number) {
  const n = g.inner.length;
  const orient = signedArea(g.inner) >= 0 ? 1 : -1;
  const tMax = Math.max(1, ...g.thickness);
  const startEdge: Vec[][] = [];
  const endEdge: Vec[][] = [];
  for (let c = 0; c < n; c++) {
    const j = (c - 1 + n) % n;
    const i = c;
    const p = g.inner[c];
    const x = g.outer[c];
    let ej: Vec[] = [p, x];
    let si: Vec[] = [p, x];
    const convex = cross(g.dirs[j], g.dirs[i]) * orient > 1e-6;
    const straight = Math.abs(cross(g.dirs[j], g.dirs[i])) < 1e-6 && dot(g.dirs[j], g.dirs[i]) > 0;
    const rj = rank(j);
    const ri = rank(i);
    if (straight) {
      // A straight corner where the wall type changes: each part ends square, at its own thickness.
      ej = [p, add(p, scale(g.normals[j], g.thickness[j]))];
      si = [p, add(p, scale(g.normals[i], g.thickness[i]))];
    } else if (convex && g.thickness[j] > 0 && g.thickness[i] > 0 && rj !== ri) {
      const [strong, weak] = rj > ri ? [j, i] : [i, j];
      // Where the strong wall's inside face meets the weak wall's outside face.
      const q = lineIntersect(p, g.dirs[strong], add(p, scale(g.normals[weak], g.thickness[weak])), g.dirs[weak]);
      if (q && dist(q, p) <= 4 * tMax) {
        if (strong === j) {
          ej = [p, q, x];
          si = [p, q];
        } else {
          ej = [p, q];
          si = [p, q, x];
        }
      }
    }
    endEdge[j] = ej;
    startEdge[i] = si;
  }
  const last = (e: Vec[]) => e[e.length - 1];
  // The inside face runs on to q where the wall goes through the corner.
  const innerEnd = (e: Vec[]) => (e.length === 3 ? e[1] : e[0]);
  g.pieces = g.inner.map((p, k) => [...endEdge[k], ...[...startEdge[k]].reverse()]);
  g.outerFace = g.inner.map((_, k) => [last(startEdge[k]), last(endEdge[k])]);
  g.innerFace = g.inner.map((_, k) => [innerEnd(startEdge[k]), innerEnd(endEdge[k])]);
}

/** All rooms of a floor; walls shared with a neighbouring room give way at corners to the walls that aren't. */
export function floorGeometry(rooms: Room[]): RoomGeom[] {
  const geoms = rooms.map(roomGeometry);
  for (const g of geoms) {
    if (!g.solved.closed) continue;
    const shared = g.inner.map((_, k) => matchingWalls(geoms, g.room.id, k).length > 0);
    if (shared.some(Boolean)) setJoints(g, (k) => wallRank(g, k, shared[k]));
  }
  return geoms;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function boundsOf(geoms: RoomGeom[]): Bounds | null {
  const pts = geoms.flatMap((g) => [...g.inner, ...g.outer]);
  if (!pts.length) return null;
  return {
    minX: Math.min(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxX: Math.max(...pts.map((p) => p.x)),
    maxY: Math.max(...pts.map((p) => p.y)),
  };
}

export const SNAP_MM = 350;

export interface SnapResult {
  origin: Vec;
  rotation_deg: number;
  /** The wall it snapped to, for drawing a guide. */
  guide: [Vec, Vec] | null;
}

/**
 * Moving `roomId` to `origin`/`rotation_deg`: if one of its walls is close and
 * nearly parallel to a wall of another room, line them up so the two inside
 * faces are exactly one wall thickness apart (the thicker of the two), and
 * line up the corners along the wall if they're close.
 */
export function snapRoom(rooms: Room[], roomId: string, origin: Vec, rotation_deg: number): SnapResult {
  const none: SnapResult = { origin, rotation_deg, guide: null };
  const room = rooms.find((r) => r.id === roomId);
  if (!room) return none;
  const solved = solveRoom(room);
  if (!solved.closed) return none;
  const others = rooms
    .filter((r) => r.id !== roomId)
    .map(roomGeometry)
    .filter((g) => g.solved.closed);
  const n = solved.points.length;
  let best: (SnapResult & { score: number }) | null = null;

  for (let i = 0; i < n; i++) {
    const L0 = solved.points[i];
    const L1 = solved.points[(i + 1) % n];
    const dA = unit(sub(toWorld({ origin, rotation_deg }, L1), toWorld({ origin, rotation_deg }, L0)));
    for (const g of others) {
      const m = g.inner.length;
      for (let j = 0; j < m; j++) {
        const B0 = g.inner[j];
        const B1 = g.inner[(j + 1) % m];
        const dB = g.dirs[j];
        const nB = g.normals[j];
        const lenB = dist(B0, B1);
        // Facing walls run in opposite directions.
        const diff = wrapDeg(angleDeg(dA) - angleDeg(scale(dB, -1)));
        if (Math.abs(diff) > 6) continue;
        const rot = rotation_deg - diff;
        const a0 = toWorld({ origin, rotation_deg: rot }, L0);
        const a1 = toWorld({ origin, rotation_deg: rot }, L1);
        const gap = Math.max(room.walls[i].thickness_mm, g.thickness[j]);
        const delta = gap - dot(sub(mid(a0, a1), B0), nB);
        if (Math.abs(delta) > SNAP_MM) continue;
        const p0 = dot(sub(a0, B0), dB);
        const p1 = dot(sub(a1, B0), dB);
        const overlap = Math.min(Math.max(p0, p1), lenB) - Math.max(Math.min(p0, p1), 0);
        if (overlap < 100) continue;
        const score = Math.abs(delta) + Math.abs(diff) * 30;
        if (best && score >= best.score) continue;

        let shift = scale(nB, delta);
        let along = Infinity;
        for (const p of [p0, p1]) {
          for (const target of [0, lenB]) {
            if (Math.abs(target - p) < Math.abs(along)) along = target - p;
          }
        }
        if (Math.abs(along) <= 200) shift = add(shift, scale(dB, along));
        best = { score, origin: add(origin, shift), rotation_deg: normDeg(rot), guide: [B0, B1] };
      }
    }
  }
  return best ? { origin: best.origin, rotation_deg: best.rotation_deg, guide: best.guide } : none;
}

/** New origin/rotation after turning a room by `deg` around a world point. */
export function rotateRoomAbout(room: Room, deg: number, pivot: Vec): { origin: Vec; rotation_deg: number } {
  return { origin: add(pivot, rotate(sub(room.origin, pivot), deg)), rotation_deg: normDeg(room.rotation_deg + deg) };
}

export interface OpeningGeom {
  /** Inside face: start and end of the gap. */
  a: Vec;
  b: Vec;
  /** Outside face of the gap. */
  ao: Vec;
  bo: Vec;
  d: Vec;
  n: Vec;
  /** The hole, as distance from the wall's start corner. */
  s0: number;
  s1: number;
  /** How deep the gap cuts: the wall thickness, or through to the neighbouring room. */
  depth: number;
  wallLength: number;
  fits: boolean;
}

export function openingGeometry(g: RoomGeom, op: Opening, all: RoomGeom[]): OpeningGeom | null {
  if (!g.solved.closed) return null;
  const k = op.wallIndex;
  const m = g.inner.length;
  if (k < 0 || k >= m) return null;
  const P0 = g.inner[k];
  const wallLength = dist(P0, g.inner[(k + 1) % m]);
  const d = g.dirs[k];
  const n = g.normals[k];
  const t = g.thickness[k];
  const span = holeSpan(op, wallLength);
  const a = add(P0, scale(d, span.a));
  const b = add(P0, scale(d, span.b));

  // A door in a shared wall should cut all the way through to the next room.
  let depth = t;
  const c = mid(a, b);
  let nearest = Infinity;
  for (const o of all) {
    if (o.room.id === g.room.id || !o.solved.closed) continue;
    for (let j = 0; j < o.inner.length; j++) {
      const s = raySegment(c, n, o.inner[j], o.inner[(j + 1) % o.inner.length]);
      if (s !== null && s < nearest) nearest = s;
    }
  }
  if (nearest <= 700) depth = Math.max(t, nearest);

  return {
    a,
    b,
    ao: add(a, scale(n, depth)),
    bo: add(b, scale(n, depth)),
    d,
    n,
    depth,
    wallLength,
    s0: span.a,
    s1: span.b,
    fits: op.offset_mm >= 0 && op.width_mm > 0 && span.a >= -1 && span.b <= wallLength + 1,
  };
}

export const wallLength = (g: RoomGeom, k: number) => len(sub(g.inner[(k + 1) % g.inner.length], g.inner[k]));

// ---- turning rooms ------------------------------------------------------------

/** Wraps to [-45, 45): how far a direction is from the nearest multiple of 90°. */
const wrap90 = (d: number) => ((((d + 45) % 90) + 90) % 90) - 45;

/** Direction of each wall in the room's own frame (degrees). */
function localWallAngles(room: Room): number[] {
  const s = solveRoom(room);
  if (!s.closed) return [];
  const n = s.points.length;
  return s.points.map((p, i) => angleDeg(sub(s.points[(i + 1) % n], p)));
}

function otherWallAngles(rooms: Room[], roomId: string): number[] {
  return rooms
    .filter((r) => r.id !== roomId)
    .map(roomGeometry)
    .filter((g) => g.solved.closed)
    .flatMap((g) => g.dirs.map(angleDeg));
}

/**
 * While turning a room by hand: if one of its walls is within `tol` degrees of
 * lining up (parallel or square) with a wall of another room, snap to it;
 * otherwise round to whole degrees.
 */
export function snapRotation(rooms: Room[], roomId: string, rawRotation: number, tol = 2.5) {
  const room = rooms.find((r) => r.id === roomId);
  const local = room ? localWallAngles(room) : [];
  let best: number | null = null;
  for (const t of otherWallAngles(rooms, roomId)) {
    for (const l of local) {
      const d = wrap90(t - l - rawRotation);
      if (Math.abs(d) < tol && (best === null || Math.abs(d) < Math.abs(best))) best = d;
    }
  }
  return best !== null
    ? { rotation_deg: normDeg(rawRotation + best), aligned: true }
    : { rotation_deg: normDeg(Math.round(rawRotation)), aligned: false };
}

/** How far to turn `roomId` so its walls line up with wall `wallIndex` of `targetId` (smallest turn, ±45°). */
export function alignDelta(rooms: Room[], roomId: string, targetId: string, wallIndex: number): number | null {
  const room = rooms.find((r) => r.id === roomId);
  const target = rooms.find((r) => r.id === targetId);
  if (!room || !target) return null;
  const g = roomGeometry(target);
  if (!g.solved.closed || !g.dirs[wallIndex]) return null;
  const t = angleDeg(g.dirs[wallIndex]);
  let best: number | null = null;
  for (const l of localWallAngles(room)) {
    const d = wrap90(t - l - room.rotation_deg);
    if (best === null || Math.abs(d) < Math.abs(best)) best = d;
  }
  return best;
}

/** The wall (inside or outside face) nearest to a point, within maxDist. */
export function nearestWall(rooms: Room[], p: Vec, maxDist: number, excludeId?: string) {
  let best: { roomId: string; wallIndex: number; dist: number } | null = null;
  for (const room of rooms) {
    if (room.id === excludeId) continue;
    const g = roomGeometry(room);
    if (!g.solved.closed) continue;
    const n = g.inner.length;
    for (let k = 0; k < n; k++) {
      for (const [a, b] of [
        [g.inner[k], g.inner[(k + 1) % n]],
        [g.outer[k], g.outer[(k + 1) % n]],
      ]) {
        const d = distToSegment(p, a, b);
        if (d <= maxDist && (!best || d < best.dist)) best = { roomId: room.id, wallIndex: k, dist: d };
      }
    }
  }
  return best;
}

function distToSegment(p: Vec, a: Vec, b: Vec): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2)) : 0;
  return dist(p, add(a, scale(ab, t)));
}

// ---- dragging doors and windows -------------------------------------------------

/**
 * Where an opening goes when dragged to point `p` (world coordinates): onto the
 * nearest wall of its room, `grab` mm from its start corner-side edge, kept
 * inside the wall and rounded to 1 cm.
 */
export function placeOpeningAt(g: RoomGeom, op: Opening, p: Vec, grab: number): { wallIndex: number; offset_mm: number } | null {
  if (!g.solved.closed) return null;
  const width_mm = holeSize(op).width;
  const n = g.inner.length;
  let best: { wallIndex: number; offset_mm: number; d: number } | null = null;
  for (let k = 0; k < n; k++) {
    const a = g.inner[k];
    const b = g.inner[(k + 1) % n];
    const len = dist(a, b);
    const d = distToSegment(p, a, b);
    if (best && d >= best.d) continue;
    const along = dot(sub(p, a), g.dirs[k]) - grab;
    const max = Math.max(0, len - width_mm);
    const start = Math.min(max, Math.max(0, along));
    // Kept in the opening's own terms: from the end corner if it is measured from there.
    const offset = op.from === 'end' ? len - start - width_mm : start;
    best = { wallIndex: k, offset_mm: Math.max(0, Math.round(offset / 10) * 10), d };
  }
  return best && { wallIndex: best.wallIndex, offset_mm: best.offset_mm };
}

/** How far along its wall a point is from the opening's start edge (to keep the grab point while dragging). */
export function grabOffset(g: RoomGeom, op: Opening, p: Vec): number {
  const a = g.inner[op.wallIndex];
  const d = g.dirs[op.wallIndex];
  const span = holeSpan(op, wallLength(g, op.wallIndex));
  const w = span.b - span.a;
  if (!a || !d) return w / 2;
  return Math.min(w, Math.max(0, dot(sub(p, a), d) - span.a));
}

// ---- shared walls ----------------------------------------------------------------

/**
 * Wall j of room `o` is the other face of a wall whose inside face runs from
 * `a` along `d`, with `n` pointing out of its room through `depth` mm of wall:
 * parallel, and its inside face between 1 mm and depth + 1 mm away.
 * Returns the overlap as distances along wall j, or null.
 */
export function facingSpan(o: RoomGeom, j: number, a: Vec, b: Vec, d: Vec, n: Vec, depth: number, minOverlap = 50) {
  const m = o.inner.length;
  if (Math.abs(cross(o.dirs[j], d)) > 0.05) return null;
  const s = dot(sub(o.inner[j], a), n);
  if (s < 1 || s > depth + 1) return null;
  const l = dist(o.inner[(j + 1) % m], o.inner[j]);
  const t0 = dot(sub(a, o.inner[j]), o.dirs[j]);
  const t1 = dot(sub(b, o.inner[j]), o.dirs[j]);
  const lo = Math.max(0, Math.min(t0, t1));
  const hi = Math.min(l, Math.max(t0, t1));
  return hi - lo < minOverlap ? null : { a: lo, b: hi };
}

/**
 * The walls of other rooms on the same line as wall k of `roomId` (the other
 * face of a shared wall), with how long they overlap.
 */
export function matchingWalls(geoms: RoomGeom[], roomId: string, k: number): { roomId: string; wallIndex: number; overlap_mm: number }[] {
  const g = geoms.find((x) => x.room.id === roomId);
  if (!g || !g.solved.closed || !g.dirs[k]) return [];
  const a = g.inner[k];
  const b = g.inner[(k + 1) % g.inner.length];
  const out: { roomId: string; wallIndex: number; overlap_mm: number }[] = [];
  for (const o of geoms) {
    if (o.room.id === roomId || !o.solved.closed) continue;
    for (let j = 0; j < o.inner.length; j++) {
      // Snapped rooms share one wall (faces the thicker wall apart); rooms drawn with
      // a wall each make one wall of both thicknesses together.
      const depth = g.thickness[k] + o.thickness[j] + 20;
      const span = facingSpan(o, j, a, b, g.dirs[k], g.normals[k], depth, 100);
      if (span) out.push({ roomId: o.room.id, wallIndex: j, overlap_mm: span.b - span.a });
    }
  }
  return out.sort((x, y) => y.overlap_mm - x.overlap_mm);
}

/** A gap in a wall, as distance along the inside face. */
export interface Gap {
  a: number;
  b: number;
  sill: number;
  top: number;
  glass: boolean;
  /** The opening that makes it. */
  openingId: string;
  type: Opening['type'];
  /** True for the hole in the wall of the room behind the opening's own room. */
  behind: boolean;
}

/**
 * The gaps in every wall of a floor, keyed "roomId:wallIndex", including the
 * hole a door makes in the wall of the room behind it. Gaps don't overlap.
 */
export function wallGaps(geoms: RoomGeom[], openings: Opening[]): Map<string, Gap[]> {
  const gaps = new Map<string, Gap[]>();
  const push = (roomId: string, k: number, g: Gap) => {
    const key = `${roomId}:${k}`;
    const list = gaps.get(key) ?? [];
    // Overlapping gaps can't be cut twice: keep the first.
    if (list.some((o) => g.a < o.b && o.a < g.b)) return;
    list.push(g);
    gaps.set(key, list);
  };
  for (const op of openings) {
    const g = geoms.find((x) => x.room.id === op.roomId);
    const og = g && openingGeometry(g, op, geoms);
    if (!g || !og || !og.fits) continue;
    const base = g.room.floorLevel_mm ?? 0;
    const hole = holeSize(op);
    const gap = { sill: Math.max(0, hole.sill), top: hole.sill + hole.height, openingId: op.id, type: op.type };
    const glass = op.type === 'window' || (op.type === 'door' && !!op.glass);
    push(g.room.id, op.wallIndex, { a: og.s0, b: og.s1, ...gap, glass, behind: false });
    // The same hole in the wall of the room behind it.
    for (const o of geoms) {
      if (o.room.id === g.room.id) continue;
      const shift = base - (o.room.floorLevel_mm ?? 0);
      for (let j = 0; j < o.inner.length; j++) {
        const span = facingSpan(o, j, og.a, og.b, og.d, og.n, og.depth);
        if (!span) continue;
        push(o.room.id, j, { ...span, ...gap, sill: Math.max(0, gap.sill + shift), top: gap.top + shift, glass: false, behind: true });
      }
    }
  }
  return gaps;
}
