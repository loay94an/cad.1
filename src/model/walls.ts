/**
 * Splitting a wall in two with a straight (180°) corner, so each part can have
 * its own type (interior / exterior, thickness, status), and merging it back.
 */
import { type Opening, type Room, holeSpan, uid } from './schema';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/**
 * Splits wall `i` at `at_mm` from its start corner. The first part keeps the
 * wall's id, the second is a copy with the rest of the length and the old end
 * corner. Doors and windows past the split move to the second part.
 * Returns the updated openings, or null if `at_mm` isn't inside the wall.
 */
export function splitWall(room: Room, openings: Opening[], i: number, at_mm: number): Opening[] | null {
  const w = room.walls[i];
  if (!w) return null;
  const L = w.length_mm;
  const at = Math.round(at_mm);
  if (!(at > 0 && at < L)) return null;

  const second = { ...clone(w), id: uid(), length_mm: L - at };
  w.length_mm = at;
  w.angle_deg = 180;
  w.angle_measured = true;
  room.walls.splice(i + 1, 0, second);

  // Corner i+1 is new: the corners after it move up one.
  for (const d of room.diagonals) {
    if (d.from >= i + 1) d.from++;
    if (d.to >= i + 1) d.to++;
  }

  return openings.map((o) => {
    if (o.wallIndex > i) return { ...o, wallIndex: o.wallIndex + 1 };
    if (o.wallIndex !== i) return o;
    const span = holeSpan(o, L);
    if (span.a >= at - 1) {
      // Past the split: onto the second part. From the end corner it measures the same.
      return { ...o, wallIndex: i + 1, offset_mm: o.from === 'end' ? o.offset_mm : Math.round(span.a - at) };
    }
    // Stays on the first part, whose end corner is now the split.
    return o.from === 'end' ? { ...o, offset_mm: Math.round(span.a), from: undefined } : o;
  });
}

/** Whether corner `c` can be removed: a straight corner, not C1 (the room is measured from there). */
export function canRemoveCorner(room: Room, c: number): boolean {
  const n = room.walls.length;
  return c > 0 && c < n && n > 3 && Math.abs(room.walls[c - 1].angle_deg - 180) < 1;
}

/**
 * Removes corner `c`: walls c-1 and c become one, with the type of the first.
 * Returns the updated openings, or null if the corner can't be removed.
 */
export function removeCorner(room: Room, openings: Opening[], c: number): Opening[] | null {
  if (!canRemoveCorner(room, c)) return null;
  const j = c - 1;
  const first = room.walls[j];
  const second = room.walls[c];
  const Lj = first.length_mm;
  const Li = second.length_mm;
  first.length_mm = Lj + Li;
  first.angle_deg = second.angle_deg;
  first.angle_measured = second.angle_measured;
  room.walls.splice(c, 1);

  room.diagonals = room.diagonals
    .filter((d) => d.from !== c && d.to !== c)
    .map((d) => ({ ...d, from: d.from > c ? d.from - 1 : d.from, to: d.to > c ? d.to - 1 : d.to }));

  return openings.map((o) => {
    if (o.wallIndex === c) {
      return { ...o, wallIndex: j, offset_mm: o.from === 'end' ? o.offset_mm : o.offset_mm + Lj };
    }
    if (o.wallIndex === j && o.from === 'end') return { ...o, offset_mm: o.offset_mm + Li };
    if (o.wallIndex > c) return { ...o, wallIndex: o.wallIndex - 1 };
    return o;
  });
}
