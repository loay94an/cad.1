import { describe, expect, it } from 'vite-plus/test';
import { FURNITURE_PRESETS, newFurniture } from './furniture';
import { newOpening } from './schema';
import { clipboard, copyToClipboard, freshGroupName, moveInList, pasteFurniture, pasteOpening, turnGroup } from './clipboard';

const chair = (x: number, y: number, group?: string) => ({ ...newFurniture(FURNITURE_PRESETS[6], { x, y }), ...(group ? { group } : {}) });

describe('copy and paste', () => {
  it('pastes copies with new ids, moved, in a group of their own', () => {
    const list = [chair(0, 0, 'Dining'), chair(500, 0, 'Dining')];
    const pasted = pasteFurniture(list, list, { x: 300, y: 300 });
    expect(pasted.map((f) => [f.x_mm, f.y_mm])).toEqual([
      [300, 300],
      [800, 300],
    ]);
    expect(pasted[0].id).not.toBe(list[0].id);
    expect(pasted.map((f) => f.group)).toEqual(['Dining 2', 'Dining 2']);
  });

  it('keeps the group name in a room that has no such group', () => {
    const pasted = pasteFurniture([], [chair(0, 0, 'Dining')], { x: 0, y: 0 });
    expect(pasted[0].group).toBe('Dining');
  });

  it('hands out a copy, so changing the paste leaves the clipboard alone', () => {
    copyToClipboard({ kind: 'furniture', items: [chair(0, 0)] });
    const a = clipboard()!;
    if (a.kind === 'furniture') a.items[0].x_mm = 999;
    expect(clipboard()).toMatchObject({ kind: 'furniture', items: [{ x_mm: 0 }] });
  });

  it('puts a copied door next to the original when it fits', () => {
    const door = { ...newOpening('r', 'door', 1), offset_mm: 500, width_mm: 800 };
    expect(pasteOpening(door, 'r', 1, 4000).offset_mm).toBe(1500);
    expect(pasteOpening(door, 'r', 1, 2000).offset_mm).toBe(500);
    expect(pasteOpening(door, 'other', 0, 4000)).toMatchObject({ roomId: 'other', wallIndex: 0, offset_mm: 500 });
  });

  it('skips past the next window on the wall', () => {
    const a = { ...newOpening('r', 'window', 0), offset_mm: 800, width_mm: 1800 };
    const b = { ...newOpening('r', 'window', 0), offset_mm: 3600, width_mm: 1800 };
    expect(pasteOpening(a, 'r', 0, 9000, [a, b]).offset_mm).toBe(5600);
    // No room after the second one: same place as the original.
    expect(pasteOpening(a, 'r', 0, 6000, [a, b]).offset_mm).toBe(800);
  });

  it('keeps measuring from the end corner', () => {
    const a = { ...newOpening('r', 'door', 0), offset_mm: 300, width_mm: 800, from: 'end' as const };
    // Hole 3400–4200 of a 4500 wall: no room for a copy after it, so it stays put.
    expect(pasteOpening(a, 'r', 0, 4500).offset_mm).toBe(300);
  });
});

describe('groups', () => {
  it('names a new group after the old one', () => {
    expect(freshGroupName([chair(0, 0, 'Dining'), chair(0, 0, 'Dining 2')], 'Dining')).toBe('Dining 3');
  });

  it('turns a group around its middle', () => {
    const g = [chair(0, 0), chair(1000, 0)];
    turnGroup(g, 90);
    expect(g.map((f) => [f.x_mm, f.y_mm, f.rotation_deg])).toEqual([
      [500, -500, 90],
      [500, 500, 90],
    ]);
  });
});

describe('reordering', () => {
  it('swaps with the neighbour and stops at the ends', () => {
    const l = ['a', 'b', 'c'];
    expect(moveInList(l, 1, -1)).toBe(true);
    expect(l).toEqual(['b', 'a', 'c']);
    expect(moveInList(l, 0, -1)).toBe(false);
    expect(moveInList(l, 2, 1)).toBe(false);
  });
});
