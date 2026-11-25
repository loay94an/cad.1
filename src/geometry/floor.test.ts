import { describe, expect, it } from 'vite-plus/test';
import { holeSize, newOpening, newRoom, newWall, type Room } from '../model/schema';
import { alignDelta, floorGeometry, grabOffset, nearestWall, openingGeometry, placeOpeningAt, roomGeometry, snapRoom, snapRotation } from './floor';
import { dist, signedArea } from './vec';

function rect(name: string, w: number, h: number, t: number, x = 0, y = 0): Room {
  const r = newRoom(name, t, { x, y });
  r.walls = [w, h, w, h].map((l) => newWall(l, t));
  return r;
}

describe('roomGeometry', () => {
  it('offsets the walls outward by their thickness', () => {
    const g = roomGeometry(rect('A', 4000, 3000, 100));
    expect(g.outer[0].x).toBeCloseTo(-100, 6);
    expect(g.outer[0].y).toBeCloseTo(-100, 6);
    expect(g.outer[2].x).toBeCloseTo(4100, 6);
    expect(g.outer[2].y).toBeCloseTo(3100, 6);
  });
});

describe('snapRoom', () => {
  it('puts a neighbouring room one wall thickness away and lines up the corners', () => {
    const a = rect('A', 4000, 3000, 100);
    // Dropped roughly to the right of A, a bit off.
    const b = rect('B', 3000, 3000, 100, 4250, 60);
    const s = snapRoom([a, b], b.id, b.origin, 0);
    expect(s.guide).not.toBeNull();
    expect(s.origin.x).toBeCloseTo(4100, 6);
    expect(s.origin.y).toBeCloseTo(0, 6);
    expect(s.rotation_deg).toBeCloseTo(0, 6);
  });

  it('straightens a room that is a few degrees off', () => {
    const a = rect('A', 4000, 3000, 100);
    const b = rect('B', 3000, 3000, 100, 4150, 0);
    const s = snapRoom([a, b], b.id, b.origin, 3);
    expect(Math.min(s.rotation_deg, 360 - s.rotation_deg)).toBeLessThan(1e-6);
  });

  it('does not snap a room that is far away', () => {
    const a = rect('A', 4000, 3000, 100);
    const b = rect('B', 3000, 3000, 100, 6000, 0);
    expect(snapRoom([a, b], b.id, b.origin, 0).guide).toBeNull();
  });
});

describe('openingGeometry', () => {
  it('places a door by its distance from the start corner', () => {
    const a = rect('A', 4000, 3000, 100);
    const door = { ...newOpening(a.id, 'door', 0), offset_mm: 500, width_mm: 900 };
    const g = roomGeometry(a);
    const o = openingGeometry(g, door, [g])!;
    expect(o.a).toEqual({ x: 500, y: 0 });
    expect(o.b).toEqual({ x: 1400, y: 0 });
    expect(o.depth).toBe(100);
    expect(o.fits).toBe(true);
  });

  it('cuts a door in a shared wall through to the next room', () => {
    const a = rect('A', 4000, 3000, 100);
    const b = rect('B', 3000, 3000, 100, 4220, 0); // 220 mm wall between them
    const door = { ...newOpening(a.id, 'door', 1), offset_mm: 1000 };
    const all = [roomGeometry(a), roomGeometry(b)];
    const o = openingGeometry(all[0], door, all)!;
    expect(o.depth).toBeCloseTo(220, 6);
    expect(dist(o.ao, { x: 4220, y: 1000 })).toBeLessThan(1e-6);
  });

  it('flags an opening that runs past the end of its wall', () => {
    const a = rect('A', 4000, 3000, 100);
    const g = roomGeometry(a);
    const o = openingGeometry(g, { ...newOpening(a.id, 'window', 1), offset_mm: 2500, width_mm: 1000 }, [g])!;
    expect(o.fits).toBe(false);
  });
});

describe('turning rooms', () => {
  it('snaps a hand-turned room to line up with a neighbour', () => {
    const a = rect('A', 4000, 3000, 100);
    a.rotation_deg = 30;
    const b = rect('B', 3000, 3000, 100, 6000, 0);
    expect(snapRotation([a, b], b.id, 31.7).rotation_deg).toBeCloseTo(30, 6);
    expect(snapRotation([a, b], b.id, 121.2).rotation_deg).toBeCloseTo(120, 6);
    // Far from any match: whole degrees.
    const free = snapRotation([a, b], b.id, 44.4);
    expect(free).toEqual({ rotation_deg: 44, aligned: false });
  });

  it('works out the smallest turn to align with a chosen wall', () => {
    const a = rect('A', 4000, 3000, 100);
    a.rotation_deg = 12;
    const b = rect('B', 3000, 3000, 100, 6000, 0);
    b.rotation_deg = 50;
    // b must turn by -38° (to 12°) — or +52°, but -38 is smaller.
    expect(alignDelta([a, b], b.id, a.id, 0)).toBeCloseTo(-38, 6);
  });

  it('finds the wall nearest to a tap', () => {
    const a = rect('A', 4000, 3000, 100);
    expect(nearestWall([a], { x: 2000, y: -40 }, 200)).toMatchObject({ roomId: a.id, wallIndex: 0 });
    expect(nearestWall([a], { x: 2000, y: 1500 }, 200)).toBeNull();
  });
});

describe('dragging openings', () => {
  it('slides along a wall, stays inside it and can move to another wall', () => {
    const a = rect('A', 4000, 3000, 100);
    const g = roomGeometry(a);
    const d900 = { ...newOpening(a.id, 'door', 0), width_mm: 900 };
    // Along W1 (top wall), grabbed in the middle of a 900 mm door.
    expect(placeOpeningAt(g, d900, { x: 2003, y: 30 }, 450)).toEqual({ wallIndex: 0, offset_mm: 1550 });
    // Past the end: clamped so the door still fits.
    expect(placeOpeningAt(g, d900, { x: 3800, y: 10 }, 450)).toEqual({ wallIndex: 0, offset_mm: 3100 });
    // Near the right wall (W2), which runs downwards from C2.
    expect(placeOpeningAt(g, d900, { x: 3980, y: 1500 }, 450)).toEqual({ wallIndex: 1, offset_mm: 1050 });
  });

  it('keeps the point you grabbed under the pointer', () => {
    const a = rect('A', 4000, 3000, 100);
    const g = roomGeometry(a);
    const door = { ...newOpening(a.id, 'door', 0), offset_mm: 1000, width_mm: 900 };
    expect(grabOffset(g, door, { x: 1300, y: 10 })).toBeCloseTo(300, 6);
  });

  it('keeps a distance from the end corner measured from there', () => {
    const a = rect('A', 4000, 3000, 100);
    const g = roomGeometry(a);
    const door = { ...newOpening(a.id, 'door', 0), width_mm: 900, from: 'end' as const };
    expect(placeOpeningAt(g, door, { x: 2003, y: 30 }, 450)).toEqual({ wallIndex: 0, offset_mm: 1550 });
    expect(placeOpeningAt(g, door, { x: 3000, y: 30 }, 450)).toEqual({ wallIndex: 0, offset_mm: 550 });
  });
});

describe('doors and windows', () => {
  it('is placed from either corner, with or without its frame', () => {
    const a = rect('A', 4000, 3000, 100);
    const g = roomGeometry(a);
    const base = { ...newOpening(a.id, 'window', 0), offset_mm: 500, width_mm: 1000, frame_mm: 70 };
    expect(openingGeometry(g, base, [g])).toMatchObject({ s0: 500, s1: 1500, fits: true });
    expect(openingGeometry(g, { ...base, from: 'end' }, [g])).toMatchObject({ s0: 2500, s1: 3500 });
    // Size inside the frame: the hole is a frame wider on each side.
    expect(openingGeometry(g, { ...base, sizeWithFrame: false }, [g])).toMatchObject({ s0: 500, s1: 1640 });
    expect(holeSize({ ...base, sizeWithFrame: false })).toMatchObject({ width: 1140, height: 1340 });
    expect(holeSize({ ...newOpening(a.id, 'door', 0), height_mm: 2000, frame_mm: 60, sizeWithFrame: false }).height).toBe(2060);
    expect(openingGeometry(g, { ...base, from: 'end', offset_mm: 3500 }, [g])?.fits).toBe(false);
  });
});

describe('wall corners', () => {
  it('lets the exterior wall run through the corner and the other butt against it', () => {
    const a = rect('A', 4000, 3000, 300);
    a.walls[0].kind = 'exterior';
    a.walls[1].thickness_mm = 100;
    const g = roomGeometry(a);
    // Top wall: outside from -300 to 4100; it owns both corner blocks, so its inside face runs on into them.
    expect(g.outerFace[0].map((p) => [Math.round(p.x), Math.round(p.y)])).toEqual([[-300, -300], [4100, -300]]);
    expect(g.innerFace[0].map((p) => [Math.round(p.x), Math.round(p.y)])).toEqual([[-300, 0], [4100, 0]]);
    // Right wall starts at the top wall's inside face.
    expect(g.outerFace[1][0]).toMatchObject({ x: 4100, y: 0 });
    // The pieces still cover the whole wall.
    const area = g.pieces.reduce((s, p) => s + Math.abs(signedArea(p)), 0);
    expect(area).toBeCloseTo(Math.abs(signedArea(g.outer)) - Math.abs(signedArea(g.inner)), 3);
  });

  it('gives way where a wall is shared with the next room', () => {
    const a = rect('A', 4000, 3000, 200);
    const b = rect('B', 3000, 3000, 200, 4200, 0);
    const [ga] = floorGeometry([a, b]);
    // A's top wall goes through its top-right corner; the shared right wall butts.
    expect(ga.outerFace[0][1]).toMatchObject({ x: 4200, y: -200 });
    expect(ga.outerFace[1][0]).toMatchObject({ x: 4200, y: 0 });
    // Alone, equal walls meet on the diagonal.
    expect(roomGeometry(a).outerFace[1][0]).toMatchObject({ x: 4200, y: -200 });
  });
});
