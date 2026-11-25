import type { ElecPoint } from '../model/electrical';
import type { Project, Room } from '../model/schema';
import { roomGeometry } from '../geometry/floor';
import type { Vec } from '../geometry/vec';

/** Even-odd test: is p inside the polygon? */
export function inPolygon(p: Vec, poly: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** The room a point on a floor lies in (inside faces; a point in a wall counts for the nearest room). */
export function roomAt(project: Project, p: ElecPoint): Room | undefined {
  const floor = project.floors.find((f) => f.id === p.floorId);
  if (!floor) return undefined;
  const at = { x: p.x_mm, y: p.y_mm };
  for (const r of floor.rooms) {
    const g = roomGeometry(r);
    if (g.solved.closed && inPolygon(at, g.inner)) return r;
  }
  // Sockets and switches sit in the wall: also try the outer faces.
  for (const r of floor.rooms) {
    const g = roomGeometry(r);
    if (g.outer.length && inPolygon(at, g.outer)) return r;
  }
  return undefined;
}

export const roomNameFn = (project: Project) => (p: ElecPoint) => roomAt(project, p)?.name;
