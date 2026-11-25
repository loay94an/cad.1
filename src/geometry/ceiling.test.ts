import { describe, expect, it } from 'vite-plus/test';
import { ceilingAt, ceilingCells, ceilingPlanes, headroomArea_m2, innerEdges, headroomPolygon, wallProfile } from './ceiling';

// A 4 × 6 m attic room, clockwise on screen. W1 (top) and W3 (bottom) are 1 m high and slope 45°.
const pts = [
  { x: 0, y: 0 },
  { x: 6000, y: 0 },
  { x: 6000, y: 4000 },
  { x: 0, y: 4000 },
];
const slope = { height_mm: 1000, slope_deg: 45 };

describe('sloped ceilings', () => {
  it('rises from the knee wall up to the room height', () => {
    const planes = ceilingPlanes(pts, [slope, {}, {}, {}], 2500);
    expect(ceilingAt(planes, { x: 3000, y: 0 })).toBeCloseTo(1000);
    expect(ceilingAt(planes, { x: 3000, y: 800 })).toBeCloseTo(1800);
    expect(ceilingAt(planes, { x: 3000, y: 3000 })).toBeCloseTo(2500);
  });

  it('counts the floor with enough headroom', () => {
    const planes = ceilingPlanes(pts, [slope, {}, slope, {}], 2500);
    // 0.8 m lost on both sides: 6 × 2.4.
    expect(headroomArea_m2(pts, planes, 1800)).toBeCloseTo(14.4);
    expect(innerEdges(headroomPolygon(pts, planes, 1800), pts)).toHaveLength(2);
    expect(headroomArea_m2(pts, ceilingPlanes(pts, [{}, {}, {}, {}], 2500))).toBeCloseTo(24);
  });

  it('makes a ridge where two slopes meet below the room height', () => {
    const planes = ceilingPlanes(pts, [slope, {}, slope, {}], 5000);
    expect(ceilingAt(planes, { x: 100, y: 2000 })).toBeCloseTo(3000);
    const cells = ceilingCells(pts, planes);
    expect(cells.map((c) => c.plane.wall)).toEqual([0, 2]);
    // The gable wall W2 goes 1 m → 3 m → 1 m.
    expect(wallProfile(pts, planes, 1).map((p) => [Math.round(p.t), Math.round(p.h)])).toEqual([
      [0, 1000],
      [2000, 3000],
      [4000, 1000],
    ]);
  });

  it('cuts the ceiling into a flat part and the slopes', () => {
    const planes = ceilingPlanes(pts, [slope, {}, slope, {}], 2500);
    const cells = ceilingCells(pts, planes);
    expect(cells.map((c) => c.plane.wall)).toEqual([-1, 0, 2]);
    expect(wallProfile(pts, planes, 1).map((p) => Math.round(p.h))).toEqual([1000, 2500, 2500, 1000]);
  });
});
