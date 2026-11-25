/**
 * Sloped ceilings (attic rooms). A wall with a slope carries a ceiling that
 * starts at the wall's height and rises into the room at `slope_deg` from the
 * horizontal, until it meets the room's height or another slope. The ceiling
 * is the lowest of all those planes.
 *
 * Works in any flat coordinate system (room or world), in mm.
 */
import { type Vec, dist, signedArea, sub } from './vec';

/** Free height under which floor area is not counted as usable. */
export const HEADROOM_MM = 1800;

export interface CeilingWall {
  height_mm?: number;
  slope_deg?: number;
}

/** Height h(p) = a·x + b·y + c. `wall` is the wall the slope starts at, −1 for the flat ceiling. */
export interface Plane {
  a: number;
  b: number;
  c: number;
  wall: number;
}

const validSlope = (s?: number): s is number => typeof s === 'number' && s > 0 && s < 90;

export const hasSlope = (walls: CeilingWall[]) => walls.some((w) => validSlope(w.slope_deg));

const at = (pl: Plane, p: Vec) => pl.a * p.x + pl.b * p.y + pl.c;

/** The flat ceiling first, then one plane per sloped wall. `pts` are the room's corners (wall k from k to k+1). */
export function ceilingPlanes(pts: Vec[], walls: CeilingWall[], roomHeight: number): Plane[] {
  const planes: Plane[] = [{ a: 0, b: 0, c: roomHeight, wall: -1 }];
  const n = pts.length;
  const clockwise = signedArea(pts) >= 0;
  for (let k = 0; k < n; k++) {
    const w = walls[k];
    if (!w || !validSlope(w.slope_deg)) continue;
    const p = pts[k];
    const d = sub(pts[(k + 1) % n], p);
    const l = Math.hypot(d.x, d.y);
    if (l <= 0) continue;
    // Unit normal pointing into the room.
    const nx = ((clockwise ? -d.y : d.y) / l) as number;
    const ny = ((clockwise ? d.x : -d.x) / l) as number;
    const t = Math.tan((w.slope_deg * Math.PI) / 180);
    const knee = w.height_mm ?? roomHeight;
    planes.push({ a: t * nx, b: t * ny, c: knee - t * (nx * p.x + ny * p.y), wall: k });
  }
  return planes;
}

export const ceilingAt = (planes: Plane[], p: Vec) => Math.min(...planes.map((pl) => at(pl, p)));

/** Keeps the part of a polygon where f ≥ 0 (f linear). */
export function clip(poly: Vec[], f: (p: Vec) => number): Vec[] {
  const out: Vec[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const fa = f(a);
    const fb = f(b);
    if (fa >= 0) out.push(a);
    if ((fa >= 0) !== (fb >= 0)) {
      const t = fa / (fa - fb);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

const area = (poly: Vec[]) => Math.abs(signedArea(poly));

/** The part of the room where the ceiling is at least `h` high. */
export function headroomPolygon(pts: Vec[], planes: Plane[], h = HEADROOM_MM): Vec[] {
  let poly = pts;
  for (const pl of planes) {
    if (pl.wall < 0) {
      if (pl.c < h) return [];
      continue;
    }
    poly = clip(poly, (p) => at(pl, p) - h);
    if (poly.length < 3) return [];
  }
  return poly;
}

/** The ceiling cut into flat pieces: for each plane, the part of the room where it is the lowest. */
export function ceilingCells(pts: Vec[], planes: Plane[]): { plane: Plane; poly: Vec[] }[] {
  const cells: { plane: Plane; poly: Vec[] }[] = [];
  planes.forEach((pl, i) => {
    let poly = pts;
    for (let j = 0; j < planes.length && poly.length >= 3; j++) {
      if (j === i) continue;
      const o = planes[j];
      // On a tie the earlier plane keeps the piece.
      const eps = j < i ? -1e-6 : 1e-6;
      poly = clip(poly, (p) => at(o, p) - at(pl, p) + eps);
    }
    if (poly.length >= 3 && area(poly) > 100) cells.push({ plane: pl, poly });
  });
  return cells;
}

/**
 * The top edge of wall k, as distance along the wall → height. A wall lower
 * than the ceiling (a half wall) stops at its own height.
 */
export function wallProfile(pts: Vec[], planes: Plane[], k: number, ownHeight?: number): { t: number; h: number }[] {
  const n = pts.length;
  const a = pts[k];
  const b = pts[(k + 1) % n];
  const l = dist(a, b);
  const p = (t: number): Vec => ({ x: a.x + ((b.x - a.x) * t) / l, y: a.y + ((b.y - a.y) * t) / l });
  const ts = new Set<number>([0, l]);
  const all = ownHeight === undefined ? planes : [...planes, { a: 0, b: 0, c: ownHeight, wall: -2 }];
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++) {
      const f0 = at(all[i], a) - at(all[j], a);
      const f1 = at(all[i], b) - at(all[j], b);
      if (f0 * f1 < 0) ts.add((f0 / (f0 - f1)) * l);
    }
  const prof = [...ts]
    .sort((x, y) => x - y)
    .filter((t, i, s) => i === 0 || t - s[i - 1] > 0.5)
    .map((t) => ({ t, h: Math.max(0, ceilingAt(all, p(t))) }));
  // Drop points on a straight stretch (two planes crossing above the ceiling).
  return prof.filter((q, i) => {
    if (i === 0 || i === prof.length - 1) return true;
    const a0 = prof[i - 1];
    const b0 = prof[i + 1];
    return Math.abs(a0.h + ((b0.h - a0.h) * (q.t - a0.t)) / (b0.t - a0.t) - q.h) > 0.5;
  });
}

/** Edges of `poly` that are not on the outline `pts` (the lines drawn inside the room). */
export function innerEdges(poly: Vec[], pts: Vec[], tol = 1): [Vec, Vec][] {
  const onOutline = (p: Vec) =>
    pts.some((a, i) => {
      const b = pts[(i + 1) % pts.length];
      const d = sub(b, a);
      const l2 = d.x * d.x + d.y * d.y;
      if (l2 === 0) return false;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * d.x + (p.y - a.y) * d.y) / l2));
      return Math.hypot(p.x - (a.x + d.x * t), p.y - (a.y + d.y * t)) <= tol;
    });
  const out: [Vec, Vec][] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (dist(a, b) < 1) continue;
    if (!onOutline({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })) out.push([a, b]);
  }
  return out;
}

/** Floor area with at least `h` of free height, in m². */
export const headroomArea_m2 = (pts: Vec[], planes: Plane[], h = HEADROOM_MM) => area(headroomPolygon(pts, planes, h)) / 1e6;
