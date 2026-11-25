import { describe, expect, it } from 'vite-plus/test';
import type * as THREE from 'three';
import { newOpening, newRoom, newStair, newWall, type Floor, type Stair } from '../model/schema';
import { buildHouse } from './house';

function floorWith(type: 'door' | 'window' | 'opening' | null, stairs: Partial<Stair>[] = [], thickness = 200): Floor {
  const room = newRoom('A', 200);
  room.walls = [4000, 3000, 4000, 3000].map((l) => newWall(l, thickness));
  room.stairs = stairs.map((s) => ({ ...newStair('stairs', 2000, 1500), length_mm: 2000, width_mm: 1000, rise_mm: 2000, steps: 10, ...s }));
  const openings = type ? [{ ...newOpening(room.id, type, 0), offset_mm: 1000, width_mm: 900 }] : [];
  return { id: 'f', name: 'Ground', level: 0, rooms: [room], openings };
}

/** Area (m², seen from above) and heights (m) of the meshes whose name starts with `prefix`. */
function measure(f: Floor, prefix: string) {
  const house = buildHouse([f], new Map(), { ceilings: 'hidden', furniture: false, defaultHeight: 2600 });
  let area = 0;
  let triangles = 0;
  let low = Infinity;
  let high = -Infinity;
  house.group.traverse((o) => {
    if (!o.name.startsWith(prefix) || !(o as THREE.Mesh).isMesh) return;
    const p = (o as THREE.Mesh).geometry.getAttribute('position');
    for (let i = 0; i < p.count; i += 3) {
      const ax = p.getX(i + 1) - p.getX(i);
      const az = p.getZ(i + 1) - p.getZ(i);
      const bx = p.getX(i + 2) - p.getX(i);
      const bz = p.getZ(i + 2) - p.getZ(i);
      area += Math.abs(ax * bz - az * bx) / 2;
      triangles++;
    }
    for (let i = 0; i < p.count; i++) {
      low = Math.min(low, p.getY(i));
      high = Math.max(high, p.getY(i));
    }
  });
  house.dispose();
  return { area, triangles, low, high };
}
const floorArea = (f: Floor) => measure(f, 'floor').area;

describe('the floor in 3D', () => {
  it('runs on through the wall under a door or passage, not under a window', () => {
    const bare = floorArea(floorWith(null));
    expect(bare).toBeCloseTo(12, 6);
    // 0.9 m wide, 0.2 m wall.
    expect(floorArea(floorWith('door')) - bare).toBeCloseTo(0.18, 6);
    expect(floorArea(floorWith('opening')) - bare).toBeCloseTo(0.18, 6);
    expect(floorArea(floorWith('window')) - bare).toBeCloseTo(0, 6);
  });

  it('has an opening where stairs go down', () => {
    expect(floorArea(floorWith(null, [{}]))).toBeCloseTo(12, 6);
    expect(floorArea(floorWith(null, [{ down: true }]))).toBeCloseTo(10, 6);
  });
});

describe('walls in 3D', () => {
  it('builds nothing for a wall without thickness', () => {
    expect(measure(floorWith(null), 'wall').triangles).toBeGreaterThan(0);
    expect(measure(floorWith(null, [], 0), 'wall').triangles).toBe(0);
  });
});

describe('stairs in 3D', () => {
  it('are only the steps, unless solid', () => {
    const steps = measure(floorWith(null, [{}]), 'stairs');
    // First tread: 0.2 m rise, 0.05 m thick.
    expect(steps.low).toBeCloseTo(0.15, 6);
    expect(steps.high).toBeCloseTo(2, 6);
    const solid = measure(floorWith(null, [{ solid: true }]), 'stairs');
    expect(solid.low).toBeCloseTo(0, 6);
    expect(solid.high).toBeCloseTo(2, 6);
  });

  it('go down from the floor', () => {
    const down = measure(floorWith(null, [{ down: true }]), 'stairs');
    expect(down.high).toBeCloseTo(-0.2, 6);
    // The last step down is the floor below itself; the one before it is 0.2 m above that.
    expect(down.low).toBeCloseTo(-1.85, 6);
    const solid = measure(floorWith(null, [{ down: true, solid: true }]), 'stairs');
    expect(solid.high).toBeCloseTo(-0.2, 6);
    expect(solid.low).toBeCloseTo(-2, 6);
  });
});
