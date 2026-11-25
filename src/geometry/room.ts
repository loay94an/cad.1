/**
 * Turns measured walls (+ optional diagonals) into a closed room outline.
 *
 * 1. Walk the walls: start at corner 0 heading east (+x), go each wall's
 *    length, turn by 180° − inside angle.
 * 2. Real measurements never close exactly. Spread the gap over the walls in
 *    proportion to their length (the compass rule from land surveying).
 * 3. Least-squares fit (Levenberg–Marquardt) of all corners to every
 *    measurement at once. Wall lengths and diagonals are trusted to ~3 mm.
 *    A corner angle you typed in is trusted to ~0.3°; a corner left at the
 *    default 90° is only a guess (~10°), so it gives way to typed angles and
 *    to measured diagonals.
 */
import { type Diagonal, type Wall, isAngleMeasured } from '../model/schema';
import { type Vec, cross, dot, len, rotate, scale, signedArea, sub, wrapDeg } from './vec';

export const SIGMA = { length_mm: 3, diagonal_mm: 3, measuredAngle_deg: 0.3, guessedAngle_deg: 10 };

export interface SolvedRoom {
  /** Corners in room coordinates (corner 0 at 0,0; wall 0 along +x). Open outline: n+1 points. */
  points: Vec[];
  closed: boolean;
  /** How far the walls missed closing before correction. */
  misclosure_mm: number;
  perimeter_mm: number;
  area_m2: number;
  /** How many corner angles were typed in (the rest are guessed 90° corners). */
  measuredAngles: number;
  /** Fitted minus measured, per wall / angle / diagonal (NaN for an unusable diagonal). */
  wallResiduals_mm: number[];
  angleResiduals_deg: number[];
  diagonalResiduals_mm: number[];
  angleSum_deg: number;
  expectedAngleSum_deg: number;
  warnings: string[];
}

type WallInput = Pick<Wall, 'length_mm' | 'angle_deg' | 'angle_measured'>;
type DiagonalInput = Pick<Diagonal, 'from' | 'to' | 'length_mm'>;

export function traverse(walls: WallInput[]): Vec[] {
  const pts: Vec[] = [{ x: 0, y: 0 }];
  let heading = 0;
  for (const w of walls) {
    const p = pts[pts.length - 1];
    const r = (heading * Math.PI) / 180;
    pts.push({ x: p.x + w.length_mm * Math.cos(r), y: p.y + w.length_mm * Math.sin(r) });
    heading += 180 - w.angle_deg;
  }
  return pts;
}

/** Spreads the closing gap of an n+1 point traverse over its walls. Returns n corners. */
export function compassRule(raw: Vec[], lengths: number[]): Vec[] {
  const n = lengths.length;
  const gap = sub(raw[n], raw[0]);
  const perimeter = lengths.reduce((s, l) => s + l, 0);
  if (perimeter <= 0) return raw.slice(0, n);
  let cum = 0;
  return lengths.map((l, k) => {
    const p = sub(raw[k], scale(gap, cum / perimeter));
    cum += l;
    return p;
  });
}

function alignToFirstWall(pts: Vec[]): Vec[] {
  const a = (Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x) * 180) / Math.PI;
  return pts.map((p) => rotate(sub(p, pts[0]), -a));
}

/** Inside angle at corner i of a closed outline, in the same convention as Wall.angle_deg. */
export function interiorAngle(pts: Vec[], i: number): number {
  const n = pts.length;
  const prev = pts[(i - 1 + n) % n];
  const v = pts[i];
  const next = pts[(i + 1) % n];
  const d1 = sub(v, prev);
  const d2 = sub(next, v);
  return 180 - (Math.atan2(cross(d1, d2), dot(d1, d2)) * 180) / Math.PI;
}

interface Residuals {
  walls: number[];
  angles: number[];
  diagonals: number[];
}

function residuals(pts: Vec[], walls: WallInput[], diags: DiagonalInput[]): Residuals {
  const n = pts.length;
  return {
    walls: walls.map((w, k) => len(sub(pts[(k + 1) % n], pts[k])) - w.length_mm),
    angles: walls.map((w, k) => wrapDeg(interiorAngle(pts, (k + 1) % n) - w.angle_deg)),
    diagonals: diags.map((d) => len(sub(pts[d.to], pts[d.from])) - d.length_mm),
  };
}

function weighted(r: Residuals, walls: WallInput[]): number[] {
  return [
    ...r.walls.map((x) => x / SIGMA.length_mm),
    ...r.angles.map((x, k) => x / (isAngleMeasured(walls[k]) ? SIGMA.measuredAngle_deg : SIGMA.guessedAngle_deg)),
    ...r.diagonals.map((x) => x / SIGMA.diagonal_mm),
  ];
}

// Unknowns: corner 0 fixed at (0,0), corner 1 fixed on the x axis → 2n − 3 numbers.
function pack(pts: Vec[]): number[] {
  const x = [pts[1].x];
  for (let k = 2; k < pts.length; k++) x.push(pts[k].x, pts[k].y);
  return x;
}

function unpack(x: number[], n: number): Vec[] {
  const pts: Vec[] = [
    { x: 0, y: 0 },
    { x: x[0], y: 0 },
  ];
  for (let k = 2; k < n; k++) pts.push({ x: x[2 * k - 3], y: x[2 * k - 2] });
  return pts;
}

const zeros = (n: number): number[] => Array.from({ length: n }, () => 0);

/** Gaussian elimination with partial pivoting. Returns null for a singular matrix. */
function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      if (f === 0) continue;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = zeros(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

export function leastSquaresFit(initial: Vec[], walls: WallInput[], diags: DiagonalInput[]): Vec[] {
  const n = initial.length;
  const f = (x: number[]) => weighted(residuals(unpack(x, n), walls, diags), walls);
  const cost = (r: number[]) => r.reduce((s, v) => s + v * v, 0);
  let x = pack(initial);
  let r = f(x);
  let c = cost(r);
  let lambda = 1e-3;
  const h = 1e-3;
  const m = x.length;

  for (let iter = 0; iter < 100 && c > 1e-14; iter++) {
    // Numeric Jacobian (central differences); rooms are small, so this is cheap.
    const J: number[][] = r.map(() => zeros(m));
    for (let j = 0; j < m; j++) {
      const xp = x.slice();
      const xm = x.slice();
      xp[j] += h;
      xm[j] -= h;
      const rp = f(xp);
      const rm = f(xm);
      for (let i = 0; i < r.length; i++) J[i][j] = (rp[i] - rm[i]) / (2 * h);
    }
    const A = Array.from({ length: m }, () => zeros(m));
    const g = zeros(m);
    for (let i = 0; i < r.length; i++) {
      const Ji = J[i];
      for (let j = 0; j < m; j++) {
        if (Ji[j] === 0) continue;
        g[j] += Ji[j] * r[i];
        for (let k = j; k < m; k++) A[j][k] += Ji[j] * Ji[k];
      }
    }
    for (let j = 0; j < m; j++) for (let k = 0; k < j; k++) A[j][k] = A[k][j];

    let improved = false;
    while (lambda < 1e12) {
      const M = A.map((row, j) => row.map((v, k) => (j === k ? v + lambda * (v + 1e-9) : v)));
      const delta = solveLinear(
        M,
        g.map((v) => -v),
      );
      if (!delta) {
        lambda *= 10;
        continue;
      }
      const xn = x.map((v, j) => v + delta[j]);
      const rn = f(xn);
      const cn = cost(rn);
      if (cn < c) {
        const step = Math.max(...delta.map(Math.abs));
        const rel = (c - cn) / Math.max(c, 1e-12);
        x = xn;
        r = rn;
        c = cn;
        lambda = Math.max(lambda / 3, 1e-9);
        improved = true;
        if (step < 1e-5 || rel < 1e-12) return unpack(x, n);
        break;
      }
      lambda *= 4;
    }
    if (!improved) break;
  }
  return unpack(x, n);
}

const cache = new Map<string, SolvedRoom>();

export function solveRoom(room: { walls: WallInput[]; diagonals: DiagonalInput[] }): SolvedRoom {
  const key = JSON.stringify([
    room.walls.map((w) => [w.length_mm, w.angle_deg, isAngleMeasured(w)]),
    room.diagonals.map((d) => [d.from, d.to, d.length_mm]),
  ]);
  const hit = cache.get(key);
  if (hit) return hit;
  const solved = solveUncached(room.walls, room.diagonals);
  if (cache.size > 500) cache.clear();
  cache.set(key, solved);
  return solved;
}

function solveUncached(walls: WallInput[], diagonals: DiagonalInput[]): SolvedRoom {
  const n = walls.length;
  const expected = Math.max(0, (n - 2) * 180);
  const angleSum = walls.reduce((s, w) => s + w.angle_deg, 0);
  const measuredAngles = walls.filter(isAngleMeasured).length;
  const warnings: string[] = [];
  const firstMissing = walls.findIndex((w) => !(w.length_mm > 0));

  if (n < 3 || firstMissing !== -1) {
    const entered = firstMissing === -1 ? walls : walls.slice(0, firstMissing);
    warnings.push(n < 3 ? 'A room needs at least 3 walls.' : `Enter the length of wall ${firstMissing + 1}.`);
    return {
      points: traverse(entered),
      closed: false,
      misclosure_mm: 0,
      perimeter_mm: entered.reduce((s, w) => s + w.length_mm, 0),
      area_m2: 0,
      measuredAngles,
      wallResiduals_mm: walls.map(() => 0),
      angleResiduals_deg: walls.map(() => 0),
      diagonalResiduals_mm: diagonals.map(() => NaN),
      angleSum_deg: angleSum,
      expectedAngleSum_deg: expected,
      warnings,
    };
  }

  const usable = (d: DiagonalInput) =>
    d.from !== d.to && d.from >= 0 && d.to >= 0 && d.from < n && d.to < n && d.length_mm > 0;
  const diags = diagonals.filter(usable);
  const lengths = walls.map((w) => w.length_mm);
  const perimeter = lengths.reduce((s, l) => s + l, 0);
  const raw = traverse(walls);
  const misclosure = len(sub(raw[n], raw[0]));
  const pts = leastSquaresFit(alignToFirstWall(compassRule(raw, lengths)), walls, diags);
  const r = residuals(pts, walls, diags);
  const diagonalResiduals = diagonals.map((d) => (usable(d) ? len(sub(pts[d.to], pts[d.from])) - d.length_mm : NaN));

  // With a mix of typed and guessed corners, the guessed ones are expected to change,
  // so the angle sum and the raw gap only mean something when all corners are alike.
  const allAlike = measuredAngles === 0 || measuredAngles === n;
  if (measuredAngles === n && Math.abs(angleSum - expected) > 0.5) {
    warnings.push(
      `The corner angles add up to ${round1(angleSum)}°, but a room with ${n} walls needs ${expected}°. ` +
        'A corner that sticks into the room is 270°.',
    );
  }
  const worstAngle = argMaxAbs(r.angles.map((a, k) => (isAngleMeasured(walls[k]) ? a : 0)));
  if (worstAngle >= 0 && Math.abs(r.angles[worstAngle]) > 2) {
    warnings.push(
      `The angle at C${((worstAngle + 1) % n) + 1} had to change by ${round1(r.angles[worstAngle])}° to fit the walls.`,
    );
  }
  if (allAlike && misclosure > Math.max(50, 0.01 * perimeter)) {
    warnings.push(
      `The walls don't meet: before correction the outline was ${round1(misclosure / 10)} cm off. ` +
        'Check for a typo or a wrong angle.',
    );
  }
  const worstWall = argMaxAbs(r.walls);
  if (worstWall >= 0 && Math.abs(r.walls[worstWall]) > 15) {
    warnings.push(`Wall ${worstWall + 1} had to change by ${Math.round(r.walls[worstWall])} mm to fit the other measurements.`);
  }
  const worstDiag = argMaxAbs(diagonalResiduals);
  if (worstDiag >= 0 && Math.abs(diagonalResiduals[worstDiag]) > 15) {
    const d = diagonals[worstDiag];
    warnings.push(
      `Diagonal C${d.from + 1}–C${d.to + 1} had to change by ${Math.round(diagonalResiduals[worstDiag])} mm to fit.`,
    );
  }

  return {
    points: pts,
    closed: true,
    misclosure_mm: misclosure,
    perimeter_mm: perimeter,
    area_m2: Math.abs(signedArea(pts)) / 1e6,
    measuredAngles,
    wallResiduals_mm: r.walls,
    angleResiduals_deg: r.angles,
    diagonalResiduals_mm: diagonalResiduals,
    angleSum_deg: angleSum,
    expectedAngleSum_deg: expected,
    warnings,
  };
}

const round1 = (x: number) => Math.round(x * 10) / 10;

function argMaxAbs(xs: number[]): number {
  let best = -1;
  for (let i = 0; i < xs.length; i++) {
    if (!Number.isFinite(xs[i])) continue;
    if (best < 0 || Math.abs(xs[i]) > Math.abs(xs[best])) best = i;
  }
  return best;
}
