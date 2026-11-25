/** 2D vectors in millimetres. Screen coordinates: x right, y DOWN. */
export interface Vec {
  x: number;
  y: number;
}

export const vec = (x: number, y: number): Vec => ({ x, y });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y;
export const cross = (a: Vec, b: Vec) => a.x * b.y - a.y * b.x;
export const len = (a: Vec) => Math.hypot(a.x, a.y);
export const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
export const mid = (a: Vec, b: Vec): Vec => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export function unit(a: Vec): Vec {
  const l = len(a);
  return l > 0 ? scale(a, 1 / l) : { x: 0, y: 0 };
}

export const DEG = Math.PI / 180;

/** Rotates by `deg` (positive = clockwise on screen, because y points down). */
export function rotate(a: Vec, deg: number): Vec {
  const r = deg * DEG;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
}

export const angleDeg = (a: Vec) => Math.atan2(a.y, a.x) / DEG;

/** Wraps an angle to (-180, 180]. */
export function wrapDeg(d: number): number {
  const w = ((((d + 180) % 360) + 360) % 360) - 180;
  return w === -180 ? 180 : w;
}

export const normDeg = (d: number) => ((d % 360) + 360) % 360;

/** Shoelace area. Positive for corners listed clockwise on screen. */
export function signedArea(pts: Vec[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export function centroid(pts: Vec[]): Vec {
  const A = signedArea(pts);
  if (Math.abs(A) < 1e-6) {
    const s = pts.reduce((acc, p) => add(acc, p), vec(0, 0));
    return pts.length ? scale(s, 1 / pts.length) : s;
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const c = a.x * b.y - b.x * a.y;
    cx += (a.x + b.x) * c;
    cy += (a.y + b.y) * c;
  }
  return { x: cx / (6 * A), y: cy / (6 * A) };
}

/** Intersection of the lines p + d·t and q + e·u, or null if parallel. */
export function lineIntersect(p: Vec, d: Vec, q: Vec, e: Vec): Vec | null {
  const c = cross(d, e);
  if (Math.abs(c) < 1e-9) return null;
  const t = cross(sub(q, p), e) / c;
  return add(p, scale(d, t));
}

/** Distance along the ray p + r·s (r unit) to segment a–b, or null if it misses. */
export function raySegment(p: Vec, r: Vec, a: Vec, b: Vec): number | null {
  const e = sub(b, a);
  const c = cross(r, e);
  if (Math.abs(c) < 1e-9) return null;
  const qp = sub(a, p);
  const s = cross(qp, e) / c;
  const u = cross(qp, r) / c;
  return s > 0 && u >= 0 && u <= 1 ? s : null;
}
