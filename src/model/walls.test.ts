import { describe, expect, it } from 'vite-plus/test';
import { newOpening, newRoom, newWall, type Room } from './schema';
import { canRemoveCorner, removeCorner, splitWall } from './walls';
import { roomGeometry } from '../geometry/floor';

function rect(w: number, h: number): Room {
  const r = newRoom('A', 200);
  r.walls = [w, h, w, h].map((l) => newWall(l, 200));
  return r;
}

describe('splitting a wall', () => {
  it('adds a straight corner and keeps the room the same shape', () => {
    const r = rect(4000, 3000);
    r.diagonals = [{ id: 'd', from: 0, to: 2, length_mm: 5000 }];
    const before = roomGeometry(r).solved.area_m2;
    const door = { ...newOpening(r.id, 'door', 0), offset_mm: 3000, width_mm: 800 };
    const win = { ...newOpening(r.id, 'window', 0), offset_mm: 500, width_mm: 1000 };
    const back = { ...newOpening(r.id, 'door', 2), offset_mm: 100 };
    const ops = splitWall(r, [door, win, back], 0, 2500)!;

    expect(r.walls.map((w) => w.length_mm)).toEqual([2500, 1500, 3000, 4000, 3000]);
    expect(r.walls[0]).toMatchObject({ angle_deg: 180, angle_measured: true });
    expect(r.diagonals[0]).toMatchObject({ from: 0, to: 3 });
    expect(roomGeometry(r).solved.area_m2).toBeCloseTo(before, 6);
    // The door was past the split: same place on the second part.
    expect(ops[0]).toMatchObject({ wallIndex: 1, offset_mm: 500 });
    expect(ops[1]).toMatchObject({ wallIndex: 0, offset_mm: 500 });
    expect(ops[2]).toMatchObject({ wallIndex: 3, offset_mm: 100 });
  });

  it('lets each part have its own type', () => {
    const r = rect(4000, 3000);
    splitWall(r, [], 1, 1000);
    r.walls[2].kind = 'exterior';
    r.walls[2].thickness_mm = 300;
    expect(r.walls[1].kind).toBeUndefined();
    expect(r.walls[1].id).not.toBe(r.walls[2].id);
  });

  it('refuses a split outside the wall', () => {
    expect(splitWall(rect(4000, 3000), [], 0, 4000)).toBeNull();
    expect(splitWall(rect(4000, 3000), [], 0, 0)).toBeNull();
  });

  it('keeps a door measured from the end corner in place', () => {
    const r = rect(4000, 3000);
    const near = { ...newOpening(r.id, 'door', 0), offset_mm: 300, width_mm: 800, from: 'end' as const };
    const far = { ...newOpening(r.id, 'door', 0), offset_mm: 3000, width_mm: 800, from: 'end' as const };
    const [a, b] = splitWall(r, [near, far], 0, 2000)!;
    expect(a).toMatchObject({ wallIndex: 1, offset_mm: 300, from: 'end' });
    // Now on the first part, measured from its start instead.
    expect(b).toMatchObject({ wallIndex: 0, offset_mm: 200 });
    expect(b.from).toBeUndefined();
  });
});

describe('removing a corner', () => {
  it('undoes a split', () => {
    const r = rect(4000, 3000);
    r.diagonals = [{ id: 'd', from: 0, to: 2, length_mm: 5000 }];
    const door = { ...newOpening(r.id, 'door', 0), offset_mm: 3000, width_mm: 800 };
    const back = { ...newOpening(r.id, 'door', 2), offset_mm: 100 };
    const split = splitWall(r, [door, back], 0, 2500)!;
    expect(canRemoveCorner(r, 1)).toBe(true);
    expect(canRemoveCorner(r, 2)).toBe(false); // a real 90° corner
    const ops = removeCorner(r, split, 1)!;
    expect(r.walls.map((w) => w.length_mm)).toEqual([4000, 3000, 4000, 3000]);
    expect(r.walls[0].angle_deg).toBe(90);
    expect(r.diagonals[0]).toMatchObject({ from: 0, to: 2 });
    expect(ops[0]).toMatchObject({ wallIndex: 0, offset_mm: 3000 });
    expect(ops[1]).toMatchObject({ wallIndex: 2, offset_mm: 100 });
  });

  it('keeps C1', () => {
    const r = rect(4000, 3000);
    r.walls[3].angle_deg = 180;
    expect(canRemoveCorner(r, 0)).toBe(false);
    expect(removeCorner(r, [], 0)).toBeNull();
  });
});

describe('a straight corner between two wall types', () => {
  it('steps from one thickness to the other, square', () => {
    const r = rect(4000, 3000);
    splitWall(r, [], 0, 2500);
    r.walls[0].thickness_mm = 300;
    r.walls[0].kind = 'exterior';
    r.walls[1].thickness_mm = 100;
    const g = roomGeometry(r);
    // W1 ends square at x = 2500, 300 deep; W2 starts there, 100 deep.
    expect(g.outerFace[0][1].x).toBeCloseTo(2500, 6);
    expect(g.outerFace[0][1].y).toBeCloseTo(-300, 6);
    expect(g.outerFace[1][0].x).toBeCloseTo(2500, 6);
    expect(g.outerFace[1][0].y).toBeCloseTo(-100, 6);
  });
});
