/**
 * Lining furniture up while you drag it: against walls, edge to edge or flush
 * with other pieces, centre on centre. Also the free distance from a piece to
 * the nearest wall or object on each side.
 *
 * Everything here is in room coordinates (mm).
 */
import { type Vec, add, dot, raySegment, rotate, scale, sub } from './vec';

/** A rectangle in the plan: centre, size and turn. Round pieces use their bounding box. */
export interface Box {
  x: number;
  y: number;
  w: number;
  d: number;
  angle: number;
}

export type Seg = [Vec, Vec];

export interface Snap {
  /** Move the box by this much. */
  delta: Vec;
  /** Lines to draw for the alignment that was used. */
  guides: Seg[];
}

export interface Clearance {
  from: Vec;
  to: Vec;
  length: number;
}

const axes = (angle: number) => [rotate({ x: 1, y: 0 }, angle), rotate({ x: 0, y: 1 }, angle)];

export function corners(b: Box): Vec[] {
  const c = { x: b.x, y: b.y };
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([sx, sy]) => add(c, rotate({ x: (sx * b.w) / 2, y: (sy * b.d) / 2 }, b.angle)));
}

export function edges(b: Box): Seg[] {
  const c = corners(b);
  return c.map((p, i) => [p, c[(i + 1) % 4]] as Seg);
}

const range = (ps: Vec[], u: Vec): [number, number] => {
  const v = ps.map((p) => dot(p, u));
  return [Math.min(...v), Math.max(...v)];
};

/** Turned by a multiple of 90° from each other (within half a degree). */
function parallel(a: number, b: number): boolean {
  const r = (((a - b) % 90) + 90) % 90;
  return r < 0.5 || r > 89.5;
}

interface Candidate {
  delta: number;
  /** Lining up with another piece: the line it lines up on, and that piece's extent across it. */
  at?: number;
  across?: [number, number];
}

/**
 * Where to put `box` so it lines up with something within `tolerance` mm.
 * `walls` are the inside faces of the room's walls. Each of the box's own two
 * directions snaps on its own, so it can sit in a corner.
 */
export function snapBox(box: Box, others: Box[], walls: Seg[], tolerance: number): Snap {
  const uv = axes(box.angle);
  const mine = corners(box);
  const me = [range(mine, uv[0]), range(mine, uv[1])];
  const cand: Candidate[][] = [[], []];
  const near = (a: [number, number], b: [number, number]) => a[0] <= b[1] + tolerance && b[0] <= a[1] + tolerance;

  for (const [A, B] of walls) {
    for (let k = 0; k < 2; k++) {
      const u = uv[k];
      // A wall across this direction: its face is a line at one value of u.
      if (Math.abs(dot(sub(B, A), u)) > 0.01 * Math.hypot(B.x - A.x, B.y - A.y)) continue;
      if (!near(range([A, B], uv[1 - k]), me[1 - k])) continue;
      const at = dot(A, u);
      cand[k].push({ delta: at - me[k][0] }, { delta: at - me[k][1] });
    }
  }

  for (const o of others) {
    if (!parallel(o.angle, box.angle)) continue;
    const theirs = corners(o);
    for (let k = 0; k < 2; k++) {
      const [lo, hi] = range(theirs, uv[k]);
      const [mlo, mhi] = me[k];
      const across = range(theirs, uv[1 - k]);
      // Side by side: edge against edge.
      if (near(across, me[1 - k])) cand[k].push({ delta: lo - mhi, at: lo, across }, { delta: hi - mlo, at: hi, across });
      // Flush with an edge, or centred on it, anywhere in the room.
      const c = (lo + hi) / 2;
      cand[k].push(
        { delta: lo - mlo, at: lo, across },
        { delta: hi - mhi, at: hi, across },
        { delta: c - (mlo + mhi) / 2, at: c, across },
      );
    }
  }

  const chosen = cand.map((list) =>
    list.filter((c) => Math.abs(c.delta) <= tolerance).sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta))[0],
  );
  const shift = chosen.map((c) => c?.delta ?? 0);
  const delta = add(scale(uv[0], shift[0]), scale(uv[1], shift[1]));
  const guides: Seg[] = [];
  chosen.forEach((c, k) => {
    if (c?.at === undefined || !c.across) return;
    // A line across both pieces, where they line up.
    const u = uv[k];
    const v = uv[1 - k];
    const a = Math.min(c.across[0], me[1 - k][0] + shift[1 - k]);
    const b = Math.max(c.across[1], me[1 - k][1] + shift[1 - k]);
    guides.push([add(scale(u, c.at), scale(v, a)), add(scale(u, c.at), scale(v, b))]);
  });
  return { delta, guides };
}

/**
 * Free space from each side of the box to the nearest wall or other piece,
 * measured straight out from the side. Sides with nothing in front are left out.
 */
export function clearances(box: Box, others: Box[], walls: Seg[]): Clearance[] {
  const segs = [...walls, ...others.flatMap(edges)];
  const [ex, ey] = axes(box.angle);
  const c = { x: box.x, y: box.y };
  const out: Clearance[] = [];
  // Out from each side: direction, along the side, half the depth, half the side.
  const sides: [Vec, Vec, number, number][] = [
    [ex, ey, box.w / 2, box.d / 2],
    [scale(ex, -1), ey, box.w / 2, box.d / 2],
    [ey, ex, box.d / 2, box.w / 2],
    [scale(ey, -1), ex, box.d / 2, box.w / 2],
  ];
  for (const [n, t, half, halfSide] of sides) {
    let best: Clearance | null = null;
    // Look out from both ends and the middle of the side; the nearest hit counts.
    for (const f of [-0.98, 0, 0.98]) {
      const from = add(add(c, scale(n, half)), scale(t, f * halfSide));
      for (const [a, b] of segs) {
        const s = raySegment(from, n, a, b);
        if (s === null || s < 0.5) continue;
        if (!best || s < best.length) best = { from, to: add(from, scale(n, s)), length: s };
      }
    }
    if (best) out.push(best);
  }
  return out;
}

// ---- points: sockets, switches, taps, radiators … -----------------------------------

const clampT = (t: number) => Math.max(0, Math.min(1, t));

/**
 * Where to put a point so it sits on a nearby wall face and lines up (across
 * or up and down) with other points or corners, each within `tolerance` mm.
 * On a wall, it only slides along the wall to line up.
 */
export function snapPoint(p: Vec, others: Vec[], walls: Seg[], tolerance: number): { p: Vec; guides: Seg[] } {
  // The nearest wall face within reach.
  let wall: { at: Vec; dir: Vec; a: Vec; b: Vec } | null = null;
  let best = tolerance;
  for (const [a, b] of walls) {
    const ab = sub(b, a);
    const L2 = dot(ab, ab);
    if (L2 < 1) continue;
    const at = add(a, scale(ab, clampT(dot(sub(p, a), ab) / L2)));
    const d = Math.hypot(p.x - at.x, p.y - at.y);
    if (d <= best) {
      best = d;
      const L = Math.sqrt(L2);
      wall = { at, dir: { x: ab.x / L, y: ab.y / L }, a, b };
    }
  }
  const base = wall ? wall.at : p;
  const guides: Seg[] = [];

  if (wall) {
    // Slide along the wall to the nearest point lined up with something.
    const { dir, a, b } = wall;
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    const s0 = dot(sub(base, a), dir);
    let pick: { s: number; q: Vec } | null = null;
    for (const q of others) {
      for (const k of ['x', 'y'] as const) {
        if (Math.abs(dir[k]) < 0.3) continue;
        const s = (q[k] - a[k]) / dir[k];
        if (s < 0 || s > L || Math.abs(s - s0) > tolerance) continue;
        if (!pick || Math.abs(s - s0) < Math.abs(pick.s - s0)) pick = { s, q };
      }
    }
    if (!pick) return { p: base, guides };
    const at = add(a, scale(dir, pick.s));
    return { p: at, guides: [[pick.q, at]] };
  }

  // Free in the room: line up across and up and down on their own.
  const out = { ...p };
  for (const k of ['x', 'y'] as const) {
    let pick: Vec | null = null;
    for (const q of others) if (Math.abs(q[k] - p[k]) <= tolerance && (!pick || Math.abs(q[k] - p[k]) < Math.abs(pick[k] - p[k]))) pick = q;
    if (!pick) continue;
    out[k] = pick[k];
    guides.push([pick, out]);
  }
  return { p: out, guides };
}

/**
 * Distances from a point to the walls straight across, up and down. On a wall,
 * only along it (to the corners), not through it.
 */
export function pointClearances(p: Vec, walls: Seg[]): Clearance[] {
  const onWall = walls.filter(([a, b]) => {
    const ab = sub(b, a);
    const L2 = dot(ab, ab);
    if (L2 < 1) return false;
    const at = add(a, scale(ab, clampT(dot(sub(p, a), ab) / L2)));
    return Math.hypot(p.x - at.x, p.y - at.y) < 2;
  });
  const out: Clearance[] = [];
  for (const n of [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ]) {
    // Into or out of the wall it's on: not a useful distance.
    if (onWall.some(([a, b]) => Math.abs(dot(n, sub(b, a))) < 0.2 * Math.hypot(b.x - a.x, b.y - a.y))) continue;
    let s: number | null = null;
    for (const [a, b] of walls) {
      const t = raySegment(p, n, a, b);
      if (t !== null && t >= 1 && (s === null || t < s)) s = t;
    }
    if (s !== null) out.push({ from: p, to: add(p, scale(n, s)), length: s });
  }
  return out;
}
