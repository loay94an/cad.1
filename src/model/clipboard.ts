/**
 * Copy and paste in the room editor, and moving furniture as a group. The
 * clipboard lives in memory, so you can copy in one room and paste in another.
 */
import { type Furniture, type Opening, holeSpan, uid } from './schema';
import type { ElecPoint } from './electrical';
import { type Vec, add, normDeg, rotate, sub } from '../geometry/vec';

export type Clip =
  | { kind: 'furniture'; items: Furniture[] }
  | { kind: 'opening'; items: Opening[] }
  | { kind: 'point'; items: ElecPoint[] };

let clip: Clip | null = null;

/** A plain copy (also of Vue's reactive objects, which structuredClone refuses). */
const copyOf = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

export function copyToClipboard(c: Clip) {
  clip = copyOf(c);
}

export function clipboard(): Clip | null {
  return clip && copyOf(clip);
}

/** The pieces in the same group as `f` (just `f` when it has none). */
export function groupOf(list: Furniture[], f: Furniture): Furniture[] {
  return f.group ? list.filter((x) => x.group === f.group) : [f];
}

export function groupNames(list: Furniture[]): string[] {
  return [...new Set(list.map((f) => f.group).filter((g): g is string => !!g))].sort();
}

/** A group name not used in the room yet: "Dining", "Dining 2", … */
export function freshGroupName(list: Furniture[], base: string): string {
  const used = new Set(groupNames(list));
  const stem = base.replace(/ \d+$/, '');
  if (!used.has(stem)) return stem;
  for (let i = 2; ; i++) if (!used.has(`${stem} ${i}`)) return `${stem} ${i}`;
}

/**
 * New copies of `items` for `list`, moved by `offset`. Copies of a group get a
 * group of their own, so moving them doesn't move the originals.
 */
export function pasteFurniture(list: Furniture[], items: Furniture[], offset: Vec): Furniture[] {
  const renamed = new Map<string, string>();
  const taken = [...list];
  return items.map((f) => {
    const copy: Furniture = { ...copyOf(f), id: uid(), x_mm: Math.round(f.x_mm + offset.x), y_mm: Math.round(f.y_mm + offset.y) };
    if (f.group) {
      if (!renamed.has(f.group)) {
        // Pasting into another room: keep the name if it's free there.
        const name = list.some((x) => x.group === f.group) ? freshGroupName(taken, f.group) : f.group;
        renamed.set(f.group, name);
        taken.push({ ...copy, group: name });
      }
      copy.group = renamed.get(f.group);
    }
    return copy;
  });
}

/** Turns every piece in `group` by `deg` around the middle of the group. */
export function turnGroup(group: Furniture[], deg: number) {
  if (!group.length) return;
  const xs = group.map((f) => f.x_mm);
  const ys = group.map((f) => f.y_mm);
  const c = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  for (const f of group) {
    const p = add(c, rotate(sub({ x: f.x_mm, y: f.y_mm }, c), deg));
    f.x_mm = Math.round(p.x);
    f.y_mm = Math.round(p.y);
    f.rotation_deg = normDeg(f.rotation_deg + deg);
  }
}

/**
 * A copy of a door or window for `roomId` on `wallIndex`. On the original's own
 * wall it goes to the first free place after it (past `others` on that wall),
 * 20 cm on; when there's no room left, or elsewhere, it keeps the original's distance.
 */
export function pasteOpening(op: Opening, roomId: string, wallIndex: number, wallLength: number, others: Opening[] = []): Opening {
  const copy: Opening = { ...copyOf(op), id: uid(), roomId, wallIndex };
  if (op.roomId !== roomId || op.wallIndex !== wallIndex) return copy;
  const w = holeSpan(op, wallLength).b - holeSpan(op, wallLength).a;
  const taken = [op, ...others.filter((o) => o.roomId === roomId && o.wallIndex === wallIndex && o.id !== op.id)]
    .map((o) => holeSpan(o, wallLength))
    .sort((x, y) => x.a - y.a);
  let a = holeSpan(op, wallLength).b + 200;
  for (const t of taken) if (a < t.b + 200 && a + w + 200 > t.a) a = Math.max(a, t.b + 200);
  if (a + w > wallLength) return copy;
  copy.offset_mm = Math.round(op.from === 'end' ? wallLength - a - w : a);
  return copy;
}

/** Moves item `i` of `list` one place up (-1) or down (+1). */
export function moveInList<T>(list: T[], i: number, by: -1 | 1): boolean {
  const j = i + by;
  if (i < 0 || j < 0 || j >= list.length) return false;
  [list[i], list[j]] = [list[j], list[i]];
  return true;
}
