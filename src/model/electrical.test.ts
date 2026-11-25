import { describe, expect, it } from 'vite-plus/test';
import { emptyElectrical, newPoint, pastePoints } from './electrical';

describe('copying electrical points', () => {
  it('pastes a copy moved, with a new id, keeping circuit, height and label', () => {
    const e = emptyElectrical();
    const s = { ...newPoint('f1', 'socket', 1000, 500, 'c1'), label: 'Desk' };
    e.points.push(s);
    const [copy] = pastePoints(e, [s], 'f1', { x: 300, y: 0 });
    expect(copy).toMatchObject({ floorId: 'f1', kind: 'socket', x_mm: 1300, y_mm: 500, circuitId: 'c1', label: 'Desk', height_mm: 300 });
    expect(copy.id).not.toBe(s.id);
    expect(e.points).toHaveLength(2);
  });

  it('keeps the switching: a copied switch controls the same lights, a copied light is on the same switch', () => {
    const e = emptyElectrical();
    const sw = newPoint('f1', 'switch', 0, 0);
    const light = newPoint('f1', 'light', 1000, 1000);
    sw.controls = [light.id];
    e.points.push(sw, light);
    const [sw2] = pastePoints(e, [sw], 'f1', { x: 100, y: 0 });
    expect(sw2.controls).toEqual([light.id]);
    const [light2] = pastePoints(e, [light], 'f1', { x: 500, y: 0 });
    expect(sw.controls).toEqual([light.id, light2.id]);
    expect(sw2.controls).toEqual([light.id, light2.id]);
  });

  it('drops links to lights that are gone, e.g. pasted into another plan', () => {
    const e = emptyElectrical();
    const sw = { ...newPoint('f1', 'switch', 0, 0), controls: ['gone'] };
    const [copy] = pastePoints(e, [sw], 'f2', { x: 0, y: 0 });
    expect(copy.controls).toBeUndefined();
    expect(copy.floorId).toBe('f2');
  });
});
