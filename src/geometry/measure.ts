/** The measuring tape on the floor view: snapping, lengths and areas. Pure functions, world mm. */
import type { RoomGeom } from './floor';
import { type Vec, add, dist, dot, scale, signedArea, sub } from './vec';

export type SnapKind = 'corner' | 'wall' | 'free';

/** The closest point to `p` on the segment a–b. */
export function closestOnSegment(p: Vec, a: Vec, b: Vec): Vec {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 < 1e-9) return a;
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return add(a, scale(ab, t));
}

/**
 * Snaps to a wall corner (inside or outside face) within `tol`, else to the
 * nearest wall face, else stays where it is. Corners win over walls.
 */
export function snapMeasure(geoms: RoomGeom[], p: Vec, tol: number): { p: Vec; kind: SnapKind } {
  let best: { p: Vec; d: number } | null = null;
  const rings = geoms.flatMap((g) => [g.inner, g.outer]).filter((r) => r.length > 1);
  for (const ring of rings) {
    for (const c of ring) {
      const d = dist(c, p);
      if (d <= tol && (!best || d < best.d)) best = { p: c, d };
    }
  }
  if (best) return { p: { ...best.p }, kind: 'corner' };
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const q = closestOnSegment(p, ring[i], ring[(i + 1) % ring.length]);
      const d = dist(q, p);
      if (d <= tol * 0.6 && (!best || d < best.d)) best = { p: q, d };
    }
  }
  return best ? { p: best.p, kind: 'wall' } : { p, kind: 'free' };
}

export interface Segment {
  a: Vec;
  b: Vec;
  length_mm: number;
}

/** The segments of the path; a closed path also gets the one back to the start. */
export function segments(pts: Vec[], closed: boolean): Segment[] {
  const out: Segment[] = [];
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    out.push({ a, b, length_mm: dist(a, b) });
  }
  return out;
}

export const totalLength = (pts: Vec[], closed: boolean) => segments(pts, closed).reduce((s, x) => s + x.length_mm, 0);
export const area_m2 = (pts: Vec[]) => Math.abs(signedArea(pts)) / 1e6;
