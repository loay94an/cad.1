import { describe, expect, it } from 'vite-plus/test';
import { type Box, type Seg, clearances, pointClearances, snapBox, snapPoint } from './snap';

// A 4 × 3 m room, inside faces.
const room: Seg[] = [
  [{ x: 0, y: 0 }, { x: 4000, y: 0 }],
  [{ x: 4000, y: 0 }, { x: 4000, y: 3000 }],
  [{ x: 4000, y: 3000 }, { x: 0, y: 3000 }],
  [{ x: 0, y: 3000 }, { x: 0, y: 0 }],
];
const box = (x: number, y: number, w = 1000, d = 600, angle = 0): Box => ({ x, y, w, d, angle });

describe('snapping furniture', () => {
  it('pushes a piece against the nearby walls, into the corner', () => {
    const s = snapBox(box(530, 330), [], room, 50);
    expect(s.delta.x).toBeCloseTo(-30, 6);
    expect(s.delta.y).toBeCloseTo(-30, 6);
  });

  it('leaves it alone when nothing is near', () => {
    const s = snapBox(box(2000, 1500), [], room, 50);
    expect(s.delta).toEqual({ x: 0, y: 0 });
    expect(s.guides).toEqual([]);
  });

  it('puts a piece edge to edge next to another, flush with it', () => {
    // Other: 1000 wide at x 1500–2500, y 1200–1800. Mine starts 20 mm past its right edge, 10 mm lower.
    const s = snapBox(box(3020, 1510), [box(2000, 1500)], [], 50);
    expect(s.delta.x).toBeCloseTo(-20, 6);
    expect(s.delta.y).toBeCloseTo(-10, 6);
    expect(s.guides.length).toBe(2);
  });

  it('works for turned pieces in their own directions', () => {
    const s = snapBox(box(1000, 1000, 1000, 600, 90), [box(1000, 1000 + 1000 + 30, 1000, 600, 90)], [], 50);
    // Turned 90°: the width runs down the screen. Edge to edge leaves no gap.
    expect(s.delta.y).toBeCloseTo(30, 6);
    expect(s.delta.x).toBeCloseTo(0, 6);
  });

  it('ignores pieces at another angle', () => {
    const s = snapBox(box(1000, 1000), [box(2010, 1000, 1000, 600, 30)], [], 50);
    expect(s.delta).toEqual({ x: 0, y: 0 });
  });
});

describe('distances', () => {
  it('measures to the walls and to the nearest piece', () => {
    const d = clearances(box(1000, 1000), [box(2500, 1000)], room);
    const lengths = d.map((c) => Math.round(c.length)).sort((a, b) => a - b);
    // Left wall 500, top wall 700, piece to the right 500, bottom wall 1700.
    expect(lengths).toEqual([500, 500, 700, 1700]);
  });
});

describe('snapping points', () => {
  it('puts a socket on the wall face when it is close', () => {
    const s = snapPoint({ x: 1200, y: 30 }, [], room, 50);
    expect(s.p).toEqual({ x: 1200, y: 0 });
  });

  it('slides along the wall to line up with another point', () => {
    const s = snapPoint({ x: 1220, y: 30 }, [{ x: 1200, y: 2000 }], room, 50);
    expect(s.p.x).toBeCloseTo(1200, 6);
    expect(s.p.y).toBeCloseTo(0, 6);
    expect(s.guides).toHaveLength(1);
  });

  it('lines up across and up and down in the middle of the room', () => {
    const s = snapPoint({ x: 1520, y: 990 }, [{ x: 1500, y: 300 }, { x: 3000, y: 1000 }], room, 50);
    expect(s.p).toEqual({ x: 1500, y: 1000 });
    expect(s.guides).toHaveLength(2);
  });

  it('measures a point on a wall along the wall only', () => {
    const d = pointClearances({ x: 1200, y: 0 }, room);
    expect(d.map((c) => Math.round(c.length)).sort((a, b) => a - b)).toEqual([1200, 2800]);
  });

  it('measures a free point in all four directions', () => {
    const d = pointClearances({ x: 1000, y: 1000 }, room);
    expect(d.map((c) => Math.round(c.length)).sort((a, b) => a - b)).toEqual([1000, 1000, 2000, 3000]);
  });
});
