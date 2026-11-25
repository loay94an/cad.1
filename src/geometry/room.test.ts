import { describe, expect, it } from 'vite-plus/test';
import { solveRoom } from './room';
import { dist, type Vec } from './vec';

const walls = (spec: [number, number?][]): { length_mm: number; angle_deg: number; angle_measured?: boolean }[] =>
  spec.map(([length_mm, angle_deg = 90]) => ({ length_mm, angle_deg }));

const expectNear = (actual: Vec[], expected: Vec[], tol_mm: number) => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((p, i) => expect(dist(p, expected[i])).toBeLessThan(tol_mm));
};

describe('solveRoom', () => {
  it('closes a perfect rectangle with no error', () => {
    const s = solveRoom({ walls: walls([[4000], [3000], [4000], [3000]]), diagonals: [] });
    expect(s.closed).toBe(true);
    expect(s.misclosure_mm).toBeLessThan(1e-6);
    expect(s.area_m2).toBeCloseTo(12, 6);
    expect(s.warnings).toEqual([]);
    expectNear(
      s.points,
      [
        { x: 0, y: 0 },
        { x: 4000, y: 0 },
        { x: 4000, y: 3000 },
        { x: 0, y: 3000 },
      ],
      0.01,
    );
  });

  it('handles an L-shaped room with an inside corner of 270°', () => {
    const s = solveRoom({
      walls: walls([[6000], [2000], [3000, 270], [2000], [3000], [4000]]),
      diagonals: [],
    });
    expect(s.closed).toBe(true);
    expect(s.misclosure_mm).toBeLessThan(1e-6);
    expect(s.area_m2).toBeCloseTo(18, 6);
    expectNear(
      s.points,
      [
        { x: 0, y: 0 },
        { x: 6000, y: 0 },
        { x: 6000, y: 2000 },
        { x: 3000, y: 2000 },
        { x: 3000, y: 4000 },
        { x: 0, y: 4000 },
      ],
      0.01,
    );
  });

  it('spreads a 2 cm measuring error over the walls', () => {
    const s = solveRoom({ walls: walls([[4000], [3000], [4020], [3000]]), diagonals: [] });
    expect(s.closed).toBe(true);
    expect(s.misclosure_mm).toBeCloseTo(20, 6);
    // 20 mm over a 3 m side wall is a 0.4° lean, which fits better than changing
    // the trusted lengths, so the solver bends the corners slightly instead.
    for (const r of s.wallResiduals_mm) expect(Math.abs(r)).toBeLessThanOrEqual(11);
    for (const a of s.angleResiduals_deg) expect(Math.abs(a)).toBeLessThan(1);
    expect(s.warnings).toEqual([]);
  });

  it('uses diagonals to correct a room that is not quite square', () => {
    // The real room: one corner is 100 mm further out than a rectangle.
    const truth = [
      { x: 0, y: 0 },
      { x: 4000, y: 0 },
      { x: 4100, y: 3000 },
      { x: 0, y: 3000 },
    ];
    const measured = walls([[4000], [dist(truth[1], truth[2])], [4100], [3000]]); // all corners "90°"
    const diagonals = [
      { from: 0, to: 2, length_mm: dist(truth[0], truth[2]) },
      { from: 1, to: 3, length_mm: dist(truth[1], truth[3]) },
    ];
    const withDiagonals = solveRoom({ walls: measured, diagonals });
    expectNear(withDiagonals.points, truth, 10);

    const without = solveRoom({ walls: measured, diagonals: [] });
    expect(dist(without.points[2], truth[2])).toBeGreaterThan(30);
  });

  it('bends the room to a typed-in angle, letting the guessed corners give way', () => {
    const w = walls([[4000], [3000], [4000], [3000]]);
    w[0] = { ...w[0], angle_deg: 120, angle_measured: true };
    const s = solveRoom({ walls: w, diagonals: [] });
    expect(s.closed).toBe(true);
    expect(s.measuredAngles).toBe(1);
    // Opposite walls equal → a parallelogram with 120° at C2 and C4, 60° at C1 and C3.
    expect(Math.abs(s.angleResiduals_deg[0])).toBeLessThan(0.5);
    for (const r of s.wallResiduals_mm) expect(Math.abs(r)).toBeLessThan(1);
    expect(s.area_m2).toBeCloseTo(12 * Math.sin(Math.PI / 3), 1);
    expect(s.warnings).toEqual([]);
  });

  it('treats an angle other than 90° from an older file as typed in', () => {
    const s = solveRoom({ walls: walls([[4000], [3000], [4000], [3000, 80]]), diagonals: [] });
    expect(s.measuredAngles).toBe(1);
  });

  it('warns about a typo that makes the walls miss by a lot', () => {
    const s = solveRoom({ walls: walls([[4000], [3000], [4400], [3000]]), diagonals: [] });
    expect(s.warnings.some((w) => w.includes("don't meet"))).toBe(true);
  });

  it('warns when typed corner angles cannot close a room', () => {
    const w = walls([[4000], [3000], [4000], [3000, 80]]).map((x) => ({ ...x, angle_measured: true }));
    const s = solveRoom({ walls: w, diagonals: [] });
    expect(s.warnings.some((w) => w.includes('add up to'))).toBe(true);
  });

  it('leaves the outline open until every wall has a length', () => {
    const s = solveRoom({ walls: walls([[4000], [3000], [0], [0]]), diagonals: [] });
    expect(s.closed).toBe(false);
    expect(s.points).toHaveLength(3);
    expect(s.warnings[0]).toContain('wall 3');
  });
});
