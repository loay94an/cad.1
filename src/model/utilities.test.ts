import { describe, expect, it } from 'vite-plus/test';
import {
  emptyUtilities,
  newUtilPoint,
  newUtilRun,
  normalizeUtilities,
  runLength_mm,
  runTotals,
  snapRunPoint,
} from './utilities';

describe('utilities', () => {
  it('adds up the pipe per kind', () => {
    const u = emptyUtilities();
    u.runs.push(
      newUtilRun('f', 'water', 'cold', [
        { x: 0, y: 0 },
        { x: 3000, y: 0 },
        { x: 3000, y: 4000 },
      ]),
      newUtilRun('f', 'water', 'hot', [
        { x: 0, y: 0 },
        { x: 0, y: 1500 },
      ]),
      newUtilRun('g', 'water', 'cold', [
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
      ]),
    );
    expect(runLength_mm(u.runs[0])).toBe(7000);
    expect(runTotals(u, 'water').map((t) => [t.kind.id, t.length_mm])).toEqual([
      ['cold', 8000],
      ['hot', 1500],
    ]);
    expect(runTotals(u, 'water', 'f')[0].length_mm).toBe(7000);
    expect(runTotals(u, 'gas')).toEqual([]);
  });

  it('snaps a pipe corner to a point of the same utility, else straight from the last corner', () => {
    const u = emptyUtilities();
    u.points.push(newUtilPoint('f', 'water', 'tap', 1000, 1000), newUtilPoint('f', 'gas', 'point', 2000, 2000));
    expect(snapRunPoint(u, 'water', 'f', { x: 1040, y: 980 }, undefined, 100)).toEqual({ x: 1000, y: 1000 });
    // The gas point is not for water pipes.
    expect(snapRunPoint(u, 'water', 'f', { x: 2040, y: 2010 }, undefined, 100)).toEqual({ x: 2040, y: 2010 });
    expect(snapRunPoint(u, 'water', 'f', { x: 5030, y: 3000 }, { x: 5000, y: 0 }, 100)).toEqual({ x: 5000, y: 3000 });
    expect(snapRunPoint(u, 'water', 'f', { x: 8000, y: 40 }, { x: 5000, y: 0 }, 100)).toEqual({ x: 8000, y: 0 });
  });

  it('survives a save and load, and drops what it does not know', () => {
    const u = emptyUtilities();
    u.points.push({ ...newUtilPoint('f', 'heating', 'radiator', 10, 20), label: 'Living' });
    u.runs.push(
      newUtilRun('f', 'heating', 'supply', [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ]),
    );
    expect(normalizeUtilities(JSON.parse(JSON.stringify(u)))).toEqual(u);
    const odd = normalizeUtilities({
      points: [{ utility: 'steam', kind: 'x' }, { utility: 'gas', kind: 'nope', x_mm: 1, y_mm: 2, floorId: 'f', id: 'a' }],
      runs: [{ utility: 'gas', kind: 'gas', path: [{ x: 0, y: 0 }] }],
    })!;
    expect(odd.points).toEqual([{ id: 'a', floorId: 'f', utility: 'gas', kind: 'meter', x_mm: 1, y_mm: 2 }]);
    expect(odd.runs).toEqual([]);
  });
});
