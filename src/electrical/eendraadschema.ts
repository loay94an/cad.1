/**
 * Lays out the single-line diagram (eendraadschema) as a tree: the supply at
 * the top, each protective device with a horizontal bus under it, and every
 * circuit dropping down with its points listed in order.
 */
import {
  type Board,
  type Device,
  type ElecPoint,
  type Electrical,
  circuitCodes,
  devicesOf,
  isBreaker,
  isControl,
  isLight,
} from '../model/electrical';
import type { Id } from '../model/schema';

export const COL = 92;
/** A circuit with points needs room for their labels. */
export const COL_WIDE = 190;
export const LEVEL = 120;
export const POINT_GAP = 54;
/** Distance between symbols on one line (a switch and its lights). */
export const SYM_GAP = 40;
/** Where the first symbol of a line sits, right of the circuit's line. */
export const SYM_FIRST = 34;
export const TOP = 80;
export const LEFT = 30;

export interface SchemaNode {
  device: Device;
  board: Board;
  code?: string;
  x: number;
  y: number;
  /** The horizontal bus under it: from x to busTo (non-leaves). */
  busTo?: number;
  children: SchemaNode[];
  points: ElecPoint[];
  /** The lines of the circuit: one point, or the switches and the lights they control. */
  rows: ElecPoint[][];
  /** Room for this node's own column. */
  width: number;
  /** A sub-board starts under this breaker. */
  subBoard?: Board;
}

export interface SchemaLayout {
  roots: SchemaNode[];
  width: number;
  height: number;
  /** Where the supply's bus runs. */
  supply: { x: number; y: number; busTo: number };
  /** Devices that couldn't be placed (e.g. a loop in "wired after"). */
  orphans: Device[];
}

/**
 * The order of the points on one circuit. Switches and the lights they control
 * stay together as a group: first all the switches, then all the lights.
 * Everything else keeps its place (by room when `cmp` sorts by room).
 */
export const orderPoints = (points: ElecPoint[], cmp?: (a: ElecPoint, b: ElecPoint) => number): ElecPoint[] =>
  groupPoints(points, cmp).flat();

/** The same, kept per line: every switch group is one line of the diagram, every other point its own line. */
export function groupPoints(points: ElecPoint[], cmp?: (a: ElecPoint, b: ElecPoint) => number): ElecPoint[][] {
  const sorted = cmp ? [...points].sort(cmp) : [...points];
  const byId = new Map(sorted.map((p) => [p.id, p]));
  // Linked neighbours, both ways, within this circuit.
  const near = new Map<Id, Set<Id>>();
  const link = (a: Id, b: Id) => (near.get(a) ?? near.set(a, new Set()).get(a)!).add(b);
  for (const p of sorted) {
    for (const id of p.controls ?? []) {
      if (!byId.has(id)) continue;
      link(p.id, id);
      link(id, p.id);
    }
  }
  const done = new Set<Id>();
  const out: ElecPoint[][] = [];
  for (const p of sorted) {
    if (done.has(p.id)) continue;
    // The whole group this point is linked into (a light with two switches, a switch with three lights, …).
    const group: ElecPoint[] = [];
    const todo = [p.id];
    while (todo.length) {
      const id = todo.pop()!;
      if (done.has(id)) continue;
      done.add(id);
      group.push(byId.get(id)!);
      todo.push(...(near.get(id) ?? []));
    }
    if (group.length > 1) group.sort((a, b) => sorted.indexOf(a) - sorted.indexOf(b));
    out.push([...group.filter((q) => isControl(q.kind)), ...group.filter((q) => !isControl(q.kind) && !isLight(q.kind)), ...group.filter((q) => isLight(q.kind))]);
  }
  return out;
}

export function layoutSchema(e: Electrical, pointOrder?: (a: ElecPoint, b: ElecPoint) => number): SchemaLayout {
  const codes = circuitCodes(e);
  const all = e.boards.flatMap((board) => devicesOf(board).map((device) => ({ board, device })));
  const placed = new Set<Id>();

  /** Devices directly after `parent` (or at the head of `board` when parent is a breaker feeding it). */
  function childrenOf(parent: Device | null, board: Board | null): { board: Board; device: Device }[] {
    if (parent) return all.filter((x) => x.device.feeds === parent.id);
    // Head of the supply: devices with no "wired after" on boards that aren't fed by a breaker.
    return all.filter((x) => !x.device.feeds && !x.board.fedBy && (!board || x.board.id === board.id));
  }

  let height = 0;
  let cursor = LEFT;

  function build(board: Board, device: Device, depth: number): SchemaNode {
    placed.add(device.id);
    const node: SchemaNode = { device, board, code: codes.get(device.id), x: 0, y: TOP + LEVEL * (depth + 1), children: [], points: [], rows: [], width: COL };
    const kids = childrenOf(device, null).filter((k) => !placed.has(k.device.id));
    if (isBreaker(device)) {
      const sub = e.boards.find((b) => b.fedBy === device.id);
      if (sub) {
        node.subBoard = sub;
        const heads = all.filter((x) => x.board.id === sub.id && !x.device.feeds && !placed.has(x.device.id));
        for (const h of heads) node.children.push(build(h.board, h.device, depth + 1));
      }
    }
    for (const k of kids) node.children.push(build(k.board, k.device, depth + 1));
    if (!node.children.length) {
      // A leaf takes one column; its points hang below it.
      node.rows = groupPoints(
        e.points.filter((p) => p.circuitId === device.id),
        pointOrder,
      );
      node.points = node.rows.flat();
      const longest = Math.max(0, ...node.rows.map((r) => r.length));
      node.width = node.rows.length ? Math.max(COL_WIDE, COL / 2 + SYM_FIRST + (longest - 1) * SYM_GAP + 30) : COL;
      node.x = cursor + COL / 2;
      cursor += node.width;
      height = Math.max(height, node.y + 150 + node.rows.length * POINT_GAP);
    } else {
      node.x = node.children[0].x;
      node.busTo = node.children[node.children.length - 1].x;
      height = Math.max(height, node.y + 60);
    }
    return node;
  }

  const roots = childrenOf(null, null).map((x) => build(x.board, x.device, 0));
  const orphans = all.filter((x) => !placed.has(x.device.id)).map((x) => x.device);
  const width = Math.max(cursor + LEFT, LEFT * 2 + COL * 2) + 140;
  return {
    roots,
    width,
    height: Math.max(height + 30, 320),
    supply: { x: roots[0]?.x ?? LEFT + COL / 2, y: TOP + 40, busTo: roots.at(-1)?.x ?? LEFT + COL / 2 },
    orphans,
  };
}
