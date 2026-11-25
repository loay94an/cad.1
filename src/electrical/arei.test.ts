import { describe, expect, it } from 'vite-plus/test';
import {
  DEVICE_PRESETS,
  type Device,
  type Electrical,
  type ElecPoint,
  type PointKind,
  circuitCodes,
  emptyElectrical,
  newBoard,
  newPoint,
  upstreamOf,
} from '../model/electrical';
import { checkInstallation } from './arei';
import { normalizeElectrical } from '../model/electrical';

const dev = (key: string, over: Partial<Device> = {}): Device => ({
  id: key + Math.random().toString(36).slice(2, 7),
  ...DEVICE_PRESETS.find((p) => p.key === key)!.make(),
  ...over,
});

/** Board A: RCD 300 mA → (RCD 30 mA → MCB wet) + MCB sockets + MCB light. */
function setup() {
  const e: Electrical = emptyElectrical();
  const b = newBoard('A');
  const main = dev('rcd300');
  const rcd30 = dev('rcd30', { feeds: main.id });
  const wet = dev('mcb-appliance', { feeds: rcd30.id });
  const sockets = dev('mcb-sockets', { feeds: main.id });
  const light = dev('mcb-light', { feeds: main.id });
  b.rows[0].devices.push(main, rcd30, wet, sockets, light);
  e.boards.push(b);
  return { e, main, rcd30, wet, sockets, light };
}

const add = (e: Electrical, circuitId: string, kind: PointKind, n = 1, extra: Partial<ElecPoint> = {}) => {
  for (let i = 0; i < n; i++) e.points.push({ ...newPoint('f', kind, i * 100, 0, circuitId), ...extra });
};
const texts = (e: Electrical, ctx = {}) => checkInstallation(e, ctx).filter((i) => i.level !== 'info').map((i) => i.text);

describe('AREI checks', () => {
  it('a sound installation has no errors or warnings', () => {
    const { e, wet, sockets, light } = setup();
    add(e, sockets.id, 'socket2', 8);
    add(e, light.id, 'light', 5);
    add(e, wet.id, 'appliance', 1, { appliance: 'washer' });
    expect(texts(e)).toEqual([]);
  });

  it('numbers circuits per board in rail order', () => {
    const { e, wet, sockets, light } = setup();
    const codes = circuitCodes(e);
    expect([codes.get(wet.id), codes.get(sockets.id), codes.get(light.id)]).toEqual(['A1', 'A2', 'A3']);
  });

  it('finds the RCDs upstream of a breaker', () => {
    const { e, wet, main, rcd30 } = setup();
    expect(upstreamOf(e, wet.id).map((d) => d.id)).toEqual([rcd30.id, main.id]);
  });

  it('warns about 9 socket points on one circuit', () => {
    const { e, sockets } = setup();
    add(e, sockets.id, 'socket', 9);
    expect(texts(e).join()).toMatch(/9 socket points; at most 8/);
  });

  it('warns about a 25 A breaker on 2.5 mm²', () => {
    const { e, sockets } = setup();
    sockets.rating_A = 25;
    add(e, sockets.id, 'socket', 2);
    expect(texts(e).join()).toMatch(/25 A breaker is too big for 2.5 mm² cable \(max 20 A\)/);
  });

  it('sockets on 1.5 mm² are not allowed', () => {
    const { e, light } = setup();
    add(e, light.id, 'socket', 1);
    expect(texts(e).join()).toMatch(/sockets need at least 2.5 mm²/);
  });

  it('a bathroom without 30 mA is an error', () => {
    const { e, sockets } = setup();
    add(e, sockets.id, 'socket', 1);
    const msgs = texts(e, { roomName: () => 'Badkamer' });
    expect(msgs.join()).toMatch(/“Badkamer” needs a 30 mA RCD/);
  });

  it('a washing machine without 30 mA is an error', () => {
    const { e, sockets } = setup();
    add(e, sockets.id, 'appliance', 1, { appliance: 'washer' });
    expect(texts(e).join()).toMatch(/washing machine needs a 30 mA RCD/);
  });

  it('a washing machine must be alone on its circuit', () => {
    const { e, wet } = setup();
    add(e, wet.id, 'appliance', 1, { appliance: 'washer' });
    add(e, wet.id, 'socket', 1);
    expect(texts(e).join()).toMatch(/needs a circuit of its own/);
  });

  it('a circuit without any RCD is an error', () => {
    const { e, sockets } = setup();
    sockets.feeds = undefined;
    add(e, sockets.id, 'socket', 1);
    expect(texts(e).join()).toMatch(/no residual-current device/);
  });

  it('an overfull rail is an error', () => {
    const { e } = setup();
    e.boards[0].rows[0].modules = 4;
    expect(texts(e).join()).toMatch(/modules on a 4-module rail/);
  });

  it('points without a circuit are flagged', () => {
    const { e } = setup();
    e.points.push(newPoint('f', 'light', 0, 0));
    expect(texts(e).join()).toMatch(/not linked to a circuit/);
  });

  it('survives a save and load', () => {
    const { e, sockets } = setup();
    add(e, sockets.id, 'socket2', 2);
    const back = normalizeElectrical(JSON.parse(JSON.stringify(e)));
    expect(back).toEqual(e);
  });
});

describe('switches and lights', () => {
  it('links and unlinks either way round, and cleans up on delete', async () => {
    const { toggleLink, removePoint, controllersOf } = await import('../model/electrical');
    const e = emptyElectrical();
    const sw = newPoint('f', 'pushbutton', 0, 0);
    const l1 = newPoint('f', 'light', 100, 0);
    const s2 = newPoint('f', 'socket', 200, 0);
    e.points.push(sw, l1, s2);
    expect(toggleLink(l1, sw)).toBe(true);
    expect(sw.controls).toEqual([l1.id]);
    expect(controllersOf(e, l1.id)).toEqual([sw]);
    expect(toggleLink(sw, s2)).toBe(false);
    removePoint(e, l1.id);
    expect(sw.controls).toBeUndefined();
  });

  it('the diagram lists the switches of a group first, then its lights', async () => {
    const { orderPoints } = await import('./eendraadschema');
    const { toggleLink } = await import('../model/electrical');
    const mk = (kind: PointKind, label: string) => ({ ...newPoint('f', kind, 0, 0, 'c'), label });
    const [l1, s1, sock, l2, s2, l3] = [
      mk('light', 'L1'),
      mk('switch', 'S1'),
      mk('socket', 'X'),
      mk('light', 'L2'),
      mk('pushbutton', 'S2'),
      mk('light', 'L3'),
    ];
    toggleLink(s1, l1);
    toggleLink(s1, l2);
    toggleLink(s2, l2);
    expect(orderPoints([l1, s1, sock, l2, s2, l3]).map((p) => p.label)).toEqual(['S1', 'S2', 'L1', 'L2', 'X', 'L3']);
  });

  it('checks the cable from the meter', () => {
    const { e } = setup();
    e.supply.meterCable = { type: 'XVB', cores: 2, section_mm2: 6 };
    e.supply.streetCable = { type: 'EXVB', cores: 2, section_mm2: 10 };
    expect(texts(e).join()).toMatch(/meter to the fuse box must be at least 10 mm²/);
    e.supply.meterCable.section_mm2 = 10;
    expect(texts(e)).toEqual([]);
  });

  it('a light without a switch is mentioned', () => {
    const { e, light } = setup();
    add(e, light.id, 'light', 1);
    expect(checkInstallation(e).map((i) => i.text).join()).toMatch(/has no switch linked/);
  });
});
