/**
 * Builds the 3D model of one or more floors: floors, walls with door and
 * window openings, (sloped) ceilings, stairs and furniture as simple blocks.
 *
 * Plan x,y (mm, y down the screen) become x,z in metres; height is y.
 */
import * as THREE from 'three';
import type { Floor, Furniture, Room, Stair, WallStatus } from '../model/schema';
import { DEFAULT_FLOOR_3D, floorCovering } from '../model/finishes';
import { furnitureHeight } from '../model/furniture';
import { type Plane, ceilingCells, ceilingPlanes, wallProfile } from '../geometry/ceiling';
import { type Gap, type RoomGeom, floorGeometry, toWorld, wallGaps } from '../geometry/floor';
import { type Vec, add, dot, rotate, scale, sub } from '../geometry/vec';
import { inPolygon } from '../electrical/rooms';

type P3 = [number, number, number];
const M = 0.001;

/** Collects triangles; one mesh per material. */
class Tris {
  pos: number[] = [];
  tri(a: P3, b: P3, c: P3) {
    this.pos.push(...a, ...b, ...c);
  }
  quad(a: P3, b: P3, c: P3, d: P3) {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }
  /** A flat or tilted polygon: triangulated in 2D (`flat`), placed in 3D (`at`). Holes are cut out. */
  poly(flat: Vec[], at: (p: Vec) => P3, holes: Vec[][] = []) {
    const v2 = (p: Vec) => new THREE.Vector2(p.x, p.y);
    const contour = flat.map(v2);
    const hs = holes.map((h) => h.map(v2));
    const all = [...flat, ...holes.flat()].map(at);
    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(contour, hs)) this.tri(all[a], all[b], all[c]);
  }
  box(c: Vec, w: number, d: number, angle: number, y0: number, y1: number) {
    const corner = (sx: number, sy: number) => add(c, rotate({ x: (sx * w) / 2, y: (sy * d) / 2 }, angle));
    const ring = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
    const lo = ring.map((p): P3 => [p.x * M, y0 * M, p.y * M]);
    const hi = ring.map((p): P3 => [p.x * M, y1 * M, p.y * M]);
    this.quad(hi[0], hi[1], hi[2], hi[3]);
    for (let i = 0; i < 4; i++) this.quad(lo[i], lo[(i + 1) % 4], hi[(i + 1) % 4], hi[i]);
  }
  cylinder(c: Vec, r: number, y0: number, y1: number) {
    const n = 24;
    const ring = Array.from({ length: n }, (_, i) => ({ x: c.x + r * Math.cos((i * 2 * Math.PI) / n), y: c.y + r * Math.sin((i * 2 * Math.PI) / n) }));
    for (let i = 0; i < n; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % n];
      this.quad([a.x * M, y0 * M, a.y * M], [b.x * M, y0 * M, b.y * M], [b.x * M, y1 * M, b.y * M], [a.x * M, y1 * M, a.y * M]);
      this.tri([c.x * M, y1 * M, c.y * M], [a.x * M, y1 * M, a.y * M], [b.x * M, y1 * M, b.y * M]);
    }
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.computeVertexNormals();
    return g;
  }
  get count() {
    return this.pos.length / 9;
  }
}

export interface HouseOptions {
  ceilings: 'hidden' | 'glass' | 'solid';
  furniture: boolean;
  defaultHeight: number;
}

export interface House {
  group: THREE.Group;
  /** Centre and size in metres, for the camera. */
  center: THREE.Vector3;
  size: number;
  triangles: number;
  dispose(): void;
}

/** Furniture without a colour of its own. */
const FURNITURE_3D = 0x9fb3c8;

const roomHeight = (room: Room, fallback: number) => room.height_mm ?? fallback;

/** Height of each floor's own floor above the lowest one: the rooms below plus a slab. */
export function floorBases(floors: Floor[], defaultHeight: number): Map<string, number> {
  const sorted = [...floors].sort((a, b) => a.level - b.level);
  const bases = new Map<string, number>();
  let y = 0;
  for (const f of sorted) {
    bases.set(f.id, y);
    const high = Math.max(0, ...f.rooms.map((r) => roomHeight(r, defaultHeight) + (r.floorLevel_mm ?? 0)));
    y += (high || defaultHeight) + 300;
  }
  return bases;
}

/** Where a room's triangles go: its floor by covering colour, each wall by status. */
interface RoomOut {
  floor: Tris;
  wall: (k: number) => Tris;
  ceiling: Tris;
  glass: Tris;
}

function buildRoom(g: RoomGeom, gapsOf: (k: number) => Gap[], y0: number, opts: HouseOptions, out: RoomOut) {
  const room = g.room;
  const n = g.inner.length;
  const base = y0 + (room.floorLevel_mm ?? 0);
  const H = roomHeight(room, opts.defaultHeight);
  const planes: Plane[] = ceilingPlanes(g.inner, room.walls, H);
  const up = (p: Vec, h: number): P3 => [p.x * M, (base + h) * M, p.y * M];

  // Stairs going down: an opening in the floor where they are.
  const wells = (room.stairs ?? []).filter((s) => s.down).map((s) => stairOutline(room, s));
  out.floor.poly(
    g.inner,
    (p) => up(p, 0),
    wells.filter((w) => w.every((p) => inPolygon(p, g.inner))),
  );

  if (opts.ceilings !== 'hidden')
    for (const cell of ceilingCells(g.inner, planes))
      out.ceiling.poly(cell.poly, (p) => up(p, cell.plane.a * p.x + cell.plane.b * p.y + cell.plane.c));

  for (let k = 0; k < n; k++) {
    const wallOut = out.wall(k);
    const A = g.inner[k];
    const d = g.dirs[k];
    const nrm = g.normals[k];
    const L = Math.hypot(g.inner[(k + 1) % n].x - A.x, g.inner[(k + 1) % n].y - A.y);
    if (L < 1) continue;
    const own = room.walls[k]?.slope_deg ? undefined : room.walls[k]?.height_mm;
    const prof = wallProfile(g.inner, planes, k, own);
    const hAt = (t: number) => {
      for (let i = 1; i < prof.length; i++)
        if (t <= prof[i].t) {
          const p = prof[i - 1];
          const q = prof[i];
          return p.h + ((q.h - p.h) * (t - p.t)) / (q.t - p.t || 1);
        }
      return prof[prof.length - 1].h;
    };
    // Gaps that fit under the top of the wall.
    const gaps = gapsOf(k)
      .map((x) => {
        const a = Math.max(1, x.a);
        const b = Math.min(L - 1, x.b);
        const room4 = Math.min(hAt(a), hAt(b), ...prof.filter((p) => p.t > a && p.t < b).map((p) => p.h));
        return { ...x, a, b, top: Math.min(x.top, room4 - 40) };
      })
      .filter((x) => x.b - x.a > 20 && x.top - x.sill > 40)
      .sort((x, y) => x.a - y.a);
    const notches = gaps.filter((x) => x.sill <= 0);
    const holes = gaps.filter((x) => x.sill > 0);

    const t = g.thickness[k];
    // Faces as far as this wall goes: through a corner it owns, up to the other wall where it butts.
    const [I, I1] = t > 0 ? g.innerFace[k] : [A, A];
    const [O, O1] = t > 0 ? g.outerFace[k] : [A, A];
    const Li = t > 0 ? Math.hypot(I1.x - I.x, I1.y - I.y) : L;
    const si = t > 0 ? dot(sub(A, I), d) : 0;
    const Lo = Math.hypot(O1.x - O.x, O1.y - O.y);
    const s0 = t > 0 ? dot(sub(A, O), d) : 0;

    /** One face of the wall: `shift` moves the gaps and the profile along it, `len` is its length. */
    const face = (origin: Vec, shift: number, len: number) => {
      const u = (tt: number) => Math.max(1, Math.min(len - 1, tt + shift));
      const contour: Vec[] = [{ x: 0, y: 0 }];
      for (const x of notches) contour.push({ x: u(x.a), y: 0 }, { x: u(x.a), y: x.top }, { x: u(x.b), y: x.top }, { x: u(x.b), y: 0 });
      contour.push({ x: len, y: 0 });
      const top = prof.map((p, i) => ({ x: i === 0 ? 0 : i === prof.length - 1 ? len : u(p.t), y: p.h }));
      for (let i = top.length - 1; i >= 0; i--) contour.push(top[i]);
      const clean = contour.filter((p, i, c) => {
        const q = c[(i + 1) % c.length];
        return Math.abs(p.x - q.x) > 0.01 || Math.abs(p.y - q.y) > 0.01;
      });
      if (clean.length < 3) return top;
      wallOut.poly(
        clean,
        (p) => up(add(origin, scale(d, p.x)), p.y),
        holes.map((x) => [
          { x: u(x.a), y: x.sill },
          { x: u(x.b), y: x.sill },
          { x: u(x.b), y: x.top },
          { x: u(x.a), y: x.top },
        ]),
      );
      return top;
    };

    // A wall without thickness is only a boundary between rooms (open plan): nothing to build.
    if (t <= 0) continue;
    const topIn = face(I, si, Li);
    const topOut = face(O, s0, Lo);
    const pin = (tt: number, h: number) => up(add(A, scale(d, tt)), h);
    const pout = (tt: number, h: number) => up(add(add(A, scale(d, tt)), scale(nrm, t)), h);
    // Top of the wall.
    for (let i = 1; i < topIn.length; i++)
      wallOut.quad(
        up(add(I, scale(d, topIn[i - 1].x)), topIn[i - 1].y),
        up(add(I, scale(d, topIn[i].x)), topIn[i].y),
        up(add(O, scale(d, topOut[i].x)), topOut[i].y),
        up(add(O, scale(d, topOut[i - 1].x)), topOut[i - 1].y),
      );
    // Ends (hidden where the next wall is as high).
    wallOut.quad(up(I, 0), up(O, 0), up(O, prof[0].h), up(I, prof[0].h));
    const hB = prof[prof.length - 1].h;
    wallOut.quad(up(I1, 0), up(O1, 0), up(O1, hB), up(I1, hB));
    // The sides of each gap, and glass in the windows.
    for (const x of gaps) {
      wallOut.quad(pin(x.a, x.sill), pout(x.a, x.sill), pout(x.a, x.top), pin(x.a, x.top));
      wallOut.quad(pin(x.b, x.sill), pout(x.b, x.sill), pout(x.b, x.top), pin(x.b, x.top));
      wallOut.quad(pin(x.a, x.top), pout(x.a, x.top), pout(x.b, x.top), pin(x.b, x.top));
      if (x.sill > 0) wallOut.quad(pin(x.a, x.sill), pout(x.a, x.sill), pout(x.b, x.sill), pin(x.b, x.sill));
      // A door or passage: the floor runs on through the wall, so it isn't a hole down to nothing.
      else out.floor.quad(pin(x.a, 0), pout(x.a, 0), pout(x.b, 0), pin(x.b, 0));
      if (x.glass) {
        const mid = (tt: number, h: number) => up(add(add(A, scale(d, tt)), scale(nrm, t / 2)), h);
        out.glass.quad(mid(x.a, x.sill), mid(x.b, x.sill), mid(x.b, x.top), mid(x.a, x.top));
      }
    }
  }
}

/** Corners of a stair's footprint in plan. */
function stairOutline(room: Room, s: Stair): Vec[] {
  const angle = s.rotation_deg + room.rotation_deg;
  const c = toWorld(room, { x: s.x_mm, y: s.y_mm });
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([x, y]) => add(c, rotate({ x: (x * s.length_mm) / 2, y: (y * s.width_mm) / 2 }, angle)));
}

/** How thick a tread is when only the steps are built. */
export const TREAD_MM = 50;

/**
 * Stairs as their steps (or filled in down to the bottom when `solid`), a slope
 * as a filled block of steps. Going down, the first step is one rise below the floor.
 */
function buildStair(room: Room, s: Stair, base: number, out: Tris) {
  const angle = s.rotation_deg + room.rotation_deg;
  const c = toWorld(room, { x: s.x_mm, y: s.y_mm });
  const steps = s.kind === 'stairs' ? Math.max(1, s.steps) : 16;
  const run = s.length_mm / steps;
  const rise = s.rise_mm / steps;
  const sign = s.down ? -1 : 1;
  const bottom = s.down ? base - s.rise_mm : base;
  const filled = s.kind === 'ramp' || s.solid;
  for (let i = 0; i < steps; i++) {
    const centre = add(c, rotate({ x: -s.length_mm / 2 + (i + 0.5) * run, y: 0 }, angle));
    const top = base + sign * (i + 1) * rise;
    const y0 = filled ? bottom : Math.max(bottom, top - Math.min(TREAD_MM, Math.abs(rise)));
    if (top - y0 > 0.5) out.box(centre, run, s.width_mm, angle, y0, top);
  }
}

function buildFurniture(room: Room, f: Furniture, base: number, out: Tris) {
  const c = toWorld(room, { x: f.x_mm, y: f.y_mm });
  const y0 = base + (f.elevation_mm ?? 0);
  const y1 = y0 + furnitureHeight(f);
  if (f.shape === 'round') out.cylinder(c, Math.min(f.width_mm, f.depth_mm) / 2, y0, y1);
  else out.box(c, f.width_mm, f.depth_mm, f.rotation_deg + room.rotation_deg, y0, y1);
}

/** Wall colours by status: new walls tinted red, walls to demolish see-through yellow (Belgian renovation plans). */
const WALL_LOOK: Record<WallStatus, { color: number; opacity: number }> = {
  existing: { color: 0xf4f2ec, opacity: 1 },
  new: { color: 0xe8a39b, opacity: 1 },
  demolish: { color: 0xf2d33c, opacity: 0.45 },
};

export function buildHouse(floors: Floor[], bases: Map<string, number>, opts: HouseOptions): House {
  const out = { ceiling: new Tris(), glass: new Tris(), stairs: new Tris() };
  const furnitureByColor = new Map<number, Tris>();
  const floorsByColor = new Map<number, Tris>();
  const wallsByStatus = new Map<WallStatus, Tris>();
  const bucket = <K,>(m: Map<K, Tris>, key: K) => {
    let t = m.get(key);
    if (!t) m.set(key, (t = new Tris()));
    return t;
  };
  for (const floor of floors) {
    const y0 = bases.get(floor.id) ?? 0;
    const geoms = floorGeometry(floor.rooms).filter((g) => g.solved.closed);
    const gaps = wallGaps(geoms, floor.openings);
    for (const g of geoms) {
      const color = floorCovering(g.room.finish?.floor)?.three ?? DEFAULT_FLOOR_3D;
      buildRoom(g, (k) => gaps.get(`${g.room.id}:${k}`) ?? [], y0, opts, {
        floor: bucket(floorsByColor, color),
        wall: (k) => bucket(wallsByStatus, g.room.walls[k]?.status ?? 'existing'),
        ceiling: out.ceiling,
        glass: out.glass,
      });
      const base = y0 + (g.room.floorLevel_mm ?? 0);
      for (const s of g.room.stairs ?? []) buildStair(g.room, s, base, out.stairs);
      // Chimneys and columns: solid, like the walls, up to the ceiling unless they have a height.
      for (const f of g.room.fixed ?? []) {
        const c = toWorld(g.room, { x: f.x_mm, y: f.y_mm });
        const top = base + (f.height_mm ?? roomHeight(g.room, opts.defaultHeight));
        const walls = bucket(wallsByStatus, 'existing');
        if (f.shape === 'round') walls.cylinder(c, Math.min(f.width_mm, f.depth_mm) / 2, base, top);
        else walls.box(c, f.width_mm, f.depth_mm, f.rotation_deg + g.room.rotation_deg, base, top);
      }
      if (opts.furniture)
        for (const f of g.room.furniture ?? [])
          buildFurniture(g.room, f, base, bucket(furnitureByColor, f.color ? parseInt(f.color.slice(1), 16) : FURNITURE_3D));
    }
  }

  const side = THREE.DoubleSide;
  const glassy = opts.ceilings === 'glass';
  const parts: { name: string; tris: Tris; material: THREE.Material; edges?: number; order?: number }[] = [
    ...[...floorsByColor].map(([color, tris]) => ({
      name: `floor-${color.toString(16)}`,
      tris,
      material: new THREE.MeshLambertMaterial({ color, side }),
    })),
    ...[...wallsByStatus].map(([status, tris]) => {
      const look = WALL_LOOK[status];
      const seeThrough = look.opacity < 1;
      return {
        name: status === 'existing' ? 'wall' : `wall-${status}`,
        tris,
        material: new THREE.MeshLambertMaterial({
          color: look.color,
          side,
          transparent: seeThrough,
          opacity: look.opacity,
          depthWrite: !seeThrough,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1,
        }),
        edges: 0.45,
        order: seeThrough ? 1 : 0,
      };
    }),
    {
      name: 'ceiling',
      tris: out.ceiling,
      material: new THREE.MeshLambertMaterial({ color: 0xc8d6e5, side, transparent: glassy, opacity: glassy ? 0.4 : 1, depthWrite: !glassy }),
      edges: 0.3,
      order: 2,
    },
    {
      name: 'glass',
      tris: out.glass,
      material: new THREE.MeshLambertMaterial({ color: 0x7fb8e6, side, transparent: true, opacity: 0.45, depthWrite: false }),
      order: 2,
    },
    { name: 'stairs', tris: out.stairs, material: new THREE.MeshLambertMaterial({ color: 0xb08d57, side }), edges: 0.3 },
    ...[...furnitureByColor].map(([color, tris]) => ({
      name: color === FURNITURE_3D ? 'furniture' : `furniture-${color.toString(16)}`,
      tris,
      material: new THREE.MeshLambertMaterial({ color, side }),
      edges: 0.3,
    })),
  ];

  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = parts.map((p) => p.material);
  let triangles = 0;
  for (const part of parts) {
    if (!part.tris.count) continue;
    triangles += part.tris.count;
    const geometry = part.tris.geometry();
    disposables.push(geometry);
    const mesh = new THREE.Mesh(geometry, part.material);
    mesh.name = part.name;
    mesh.renderOrder = part.order ?? 0;
    group.add(mesh);
    if (part.edges) {
      const edges = new THREE.EdgesGeometry(geometry, 25);
      const lineMat = new THREE.LineBasicMaterial({ color: 0x333333, transparent: true, opacity: part.edges });
      disposables.push(edges, lineMat);
      group.add(new THREE.LineSegments(edges, lineMat));
    }
  }

  const box = new THREE.Box3().setFromObject(group);
  const empty = box.isEmpty();
  const center = empty ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
  const size = empty ? 5 : box.getSize(new THREE.Vector3()).length();
  return { group, center, size, triangles, dispose: () => disposables.forEach((x) => x.dispose()) };
}
