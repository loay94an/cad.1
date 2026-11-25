import { describe, expect, it } from 'vite-plus/test';
import type { RoomGeom } from './floor';
import { area_m2, closestOnSegment, segments, snapMeasure, totalLength } from './measure';

const sq = [
  { x: 0, y: 0 },
  { x: 4000, y: 0 },
  { x: 4000, y: 3000 },
  { x: 0, y: 3000 },
];
const geom = { inner: sq, outer: [] } as unknown as RoomGeom;

describe('measuring', () => {
  it('measures a path and a closed shape', () => {
    expect(totalLength(sq.slice(0, 3), false)).toBe(7000);
    expect(totalLength(sq, true)).toBe(14000);
    expect(segments(sq, true)).toHaveLength(4);
    expect(area_m2(sq)).toBe(12);
  });

  it('snaps to a corner first, then to a wall', () => {
    expect(snapMeasure([geom], { x: 3950, y: 60 }, 100)).toEqual({ p: { x: 4000, y: 0 }, kind: 'corner' });
    expect(snapMeasure([geom], { x: 2000, y: 40 }, 100)).toEqual({ p: { x: 2000, y: 0 }, kind: 'wall' });
    expect(snapMeasure([geom], { x: 2000, y: 1500 }, 100).kind).toBe('free');
  });

  it('finds the closest point on a segment', () => {
    expect(closestOnSegment({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toEqual({ x: 5, y: 0 });
    expect(closestOnSegment({ x: -5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toEqual({ x: 0, y: 0 });
  });
});
