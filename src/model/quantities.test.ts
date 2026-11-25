import { describe, expect, it } from 'vite-plus/test';
import { type Opening, type Project, type Room, newOpening, newProject, newRoom } from './schema';
import { floorQuantities, houseQuantities, quantitiesCsv } from './quantities';
import { matchingWalls, roomGeometry } from '../geometry/floor';

/** A 6 × 4 m room (W1 along the top, 6 m), 2.5 m high. */
function room46(name: string, x = 0, y = 0): Room {
  const r = newRoom(name, 100, { x, y });
  [6000, 4000, 6000, 4000].forEach((l, i) => (r.walls[i].length_mm = l));
  r.height_mm = 2500;
  return r;
}

function door(roomId: string, wallIndex: number, offset = 200): Opening {
  return { ...newOpening(roomId, 'door', wallIndex), offset_mm: offset, width_mm: 880, height_mm: 2010 };
}

function project(rooms: Room[], openings: Opening[] = []): Project {
  const p = newProject('Test');
  p.floors[0].rooms = rooms;
  p.floors[0].openings = openings;
  return p;
}

describe('quantities', () => {
  it('measures a 4 × 6 m room with one door and one window', () => {
    const r = room46('Living');
    const win: Opening = { ...newOpening(r.id, 'window', 1), offset_mm: 1000, width_mm: 1000, height_mm: 1200, sill_mm: 900 };
    const p = project([r], [door(r.id, 0), win]);
    const room = floorQuantities(p, p.floors[0]).rooms[0];
    expect(room.floorArea_m2).toBeCloseTo(24);
    expect(room.usableArea_m2).toBeCloseTo(24);
    expect(room.perimeter_mm).toBeCloseTo(20000);
    expect(room.skirting_mm).toBeCloseTo(20000 - 880);
    expect(room.wallGross_m2).toBeCloseTo(50);
    expect(room.wallNet_m2).toBeCloseTo(50 - 0.88 * 2.01 - 1.2);
    expect(room.ceiling_m2).toBeCloseTo(24);
    expect(room.doors).toEqual({ count: 1, area_m2: expect.closeTo(1.7688) });
    expect(room.windows).toEqual({ count: 1, area_m2: expect.closeTo(1.2) });
  });

  it('has no skirting when the room says so', () => {
    const r = room46('Bathroom');
    r.finish = { floor: 'tiles', skirting: false };
    const p = project([r]);
    const room = floorQuantities(p, p.floors[0]).rooms[0];
    expect(room.skirting_mm).toBe(0);
    expect(room.covering).toBe('Tiles');
  });

  it('follows two 45° slopes for wall and ceiling area', () => {
    const r = room46('Attic');
    for (const k of [0, 2]) Object.assign(r.walls[k], { height_mm: 1000, slope_deg: 45 });
    const p = project([r]);
    p.settings.headroom_mm = 1800;
    const room = floorQuantities(p, p.floors[0]).rooms[0];
    // Knee walls 6 × 1 m each; gable walls 1 → 2.5 m over 1.5 m, flat 1 m, back down.
    expect(room.wallGross_m2).toBeCloseTo(2 * 6 + 2 * 7.75);
    // Two slopes 6 × 1.5 m on plan, √2 longer when tilted 45°, and a flat strip 6 × 1 m.
    expect(room.ceiling_m2).toBeCloseTo(6 + 2 * 9 * Math.SQRT2);
    // 0.8 m lost along both knee walls.
    expect(room.usableArea_m2).toBeCloseTo(6 * 2.4);
  });

  it('counts a door in a shared wall for both rooms, and once for the house', () => {
    const a = room46('Kitchen');
    const b = room46('Dining', 6100, 0);
    const p = project([a, b], [door(a.id, 1, 1500)]);
    const ga = roomGeometry(a);
    const gb = roomGeometry(b);
    expect(matchingWalls([ga, gb], a.id, 1)).toEqual([{ roomId: b.id, wallIndex: 3, overlap_mm: expect.closeTo(4000) }]);

    const f = floorQuantities(p, p.floors[0]);
    const [qa, qb] = f.rooms;
    expect(qa.doors.count).toBe(1);
    expect(qb.doors.count).toBe(1);
    expect(qb.skirting_mm).toBeCloseTo(20000 - 880);
    expect(qb.wallNet_m2).toBeCloseTo(50 - 0.88 * 2.01);
    expect(f.total.doors.count).toBe(1);
    expect(houseQuantities(p).total.doors.count).toBe(1);
  });

  it('finds the other side of a wall when each room drew half of it', () => {
    const a = room46('Kitchen');
    const b = room46('Dining', 6200, 0);
    expect(matchingWalls([roomGeometry(a), roomGeometry(b)], a.id, 1).map((m) => m.wallIndex)).toEqual([3]);
    // A room across a corridor is not the same wall.
    const c = room46('Bedroom', 7200, 0);
    expect(matchingWalls([roomGeometry(a), roomGeometry(c)], a.id, 1)).toEqual([]);
  });

  it('groups floor area by covering and walls by status, each wall once', () => {
    const a = room46('Kitchen');
    const b = room46('Dining', 6100, 0);
    a.finish = { floor: 'tiles' };
    a.walls[1].status = 'demolish';
    b.walls[3].status = 'demolish';
    b.walls[1].status = 'new';
    const q = houseQuantities(project([a, b]));
    expect(q.grouped.coverings).toEqual([
      { covering: 'Tiles', area_m2: expect.closeTo(24) },
      { covering: '', area_m2: expect.closeTo(24) },
    ]);
    expect(q.grouped.walls).toEqual([
      { status: 'new', length_mm: expect.closeTo(4000), area_m2: expect.closeTo(10) },
      { status: 'demolish', length_mm: expect.closeTo(4000), area_m2: expect.closeTo(10) },
    ]);
  });

  it('writes a CSV with BOM, semicolons and decimal commas', () => {
    const r = room46('Living; dining');
    const csv = quantitiesCsv(houseQuantities(project([r])), 'Test');
    expect(csv.startsWith('﻿Test\r\n')).toBe(true);
    const row = csv.split('\r\n').find((l) => l.includes('Living'))!;
    expect(row).toBe('Ground floor;"Living; dining";;24,00;24,00;20,00;20,00;50,00;50,00;24,00;0;0,00;0;0,00');
  });
});
