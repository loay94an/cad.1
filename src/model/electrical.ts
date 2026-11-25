/**
 * The electrical installation: fuse boxes (boards) with DIN-rail devices, the
 * circuits behind each breaker, and the points (sockets, lights, switches,
 * appliances) on the plan. Each breaker (MCB or RCBO) is one circuit.
 *
 * Belgian AREI terms: eendraadschema = single-line diagram, situatieschema =
 * the plan with the points; circuit codes are the board letter + number (A1).
 */
import { type Id, uid } from './schema';

export type DeviceKind = 'main' | 'rcd' | 'mcb' | 'rcbo' | 'spd' | 'contactor' | 'teleruptor' | 'timer' | 'other';
export type Curve = 'B' | 'C' | 'D';
export type RcdType = 'AC' | 'A' | 'F' | 'B';
export type CircuitUse = 'sockets' | 'lighting' | 'mixed' | 'appliance' | 'subboard' | 'other';

/** Appliances that need a circuit of their own. */
export type Appliance =
  | 'washer'
  | 'dryer'
  | 'dishwasher'
  | 'oven'
  | 'hob'
  | 'boiler'
  | 'heatpump'
  | 'ev'
  | 'fridge'
  | 'other';

export const APPLIANCES: { id: Appliance; label: string; dedicated: boolean; rcd30?: boolean }[] = [
  { id: 'washer', label: 'Washing machine', dedicated: true, rcd30: true },
  { id: 'dryer', label: 'Tumble dryer', dedicated: true, rcd30: true },
  { id: 'dishwasher', label: 'Dishwasher', dedicated: true, rcd30: true },
  { id: 'oven', label: 'Oven', dedicated: true },
  { id: 'hob', label: 'Cooking hob', dedicated: true },
  { id: 'boiler', label: 'Electric water heater', dedicated: true },
  { id: 'heatpump', label: 'Heat pump', dedicated: true },
  { id: 'ev', label: 'EV charger', dedicated: true },
  { id: 'fridge', label: 'Fridge / freezer', dedicated: false },
  { id: 'other', label: 'Other appliance', dedicated: false },
];
export const applianceInfo = (a?: Appliance) => APPLIANCES.find((x) => x.id === a);

export interface Cable {
  /** e.g. XVB, XGB, EXVB, VOB (in conduit). */
  type: string;
  cores: number;
  section_mm2: number;
}

/** What hangs behind a breaker. */
export interface CircuitInfo {
  name: string;
  use: CircuitUse;
  cable: Cable;
}

export interface Device {
  id: Id;
  kind: DeviceKind;
  label: string;
  /** Width on the rail in modules of 17.5 mm. */
  modules: number;
  poles: 1 | 2 | 3 | 4;
  rating_A: number;
  curve?: Curve;
  /** RCD / RCBO. */
  sensitivity_mA?: number;
  rcdType?: RcdType;
  breaking_kA?: number;
  /** The upstream device (main switch or RCD) it's wired after. Unset: straight after the board's supply. */
  feeds?: Id;
  /** MCB / RCBO: the circuit behind it. */
  circuit?: CircuitInfo;
}

export interface DinRow {
  id: Id;
  modules: number;
  devices: Device[];
}

export interface Board {
  id: Id;
  name: string;
  /** Circuit codes start with this letter: A1, A2, … */
  letter: string;
  rows: DinRow[];
  /** A sub-board is fed by a breaker (circuit) of another board. */
  fedBy?: Id;
  /** Where it hangs on the plan. */
  location?: { floorId: Id; x_mm: number; y_mm: number };
}

export type PointKind =
  | 'socket'
  | 'socket2'
  | 'socket3'
  | 'light'
  | 'switch'
  | 'switch2'
  | 'switch_2way'
  | 'dimmer'
  | 'pushbutton'
  | 'appliance'
  | 'junction';

export const POINT_KINDS: { id: PointKind; label: string; icon: string; group: 'socket' | 'light' | 'switch' | 'other' }[] = [
  { id: 'socket', label: 'Socket', icon: '🔌', group: 'socket' },
  { id: 'socket2', label: 'Double socket', icon: '🔌²', group: 'socket' },
  { id: 'socket3', label: 'Triple socket', icon: '🔌³', group: 'socket' },
  { id: 'light', label: 'Light', icon: '💡', group: 'light' },
  { id: 'switch', label: 'Switch', icon: '⏻', group: 'switch' },
  { id: 'switch2', label: 'Double switch', icon: '⏻²', group: 'switch' },
  { id: 'switch_2way', label: 'Two-way switch', icon: '⇄', group: 'switch' },
  { id: 'dimmer', label: 'Dimmer', icon: '◐', group: 'switch' },
  { id: 'pushbutton', label: 'Push button', icon: '⊙', group: 'switch' },
  { id: 'appliance', label: 'Appliance', icon: '▣', group: 'other' },
  { id: 'junction', label: 'Junction box', icon: '◇', group: 'other' },
];
export const pointInfo = (k: PointKind) => POINT_KINDS.find((x) => x.id === k) ?? POINT_KINDS[0];
export const isSocket = (k: PointKind) => k === 'socket' || k === 'socket2' || k === 'socket3';
export const isLight = (k: PointKind) => k === 'light';
/** Switches, dimmers and push buttons: they control lights. */
export const isControl = (k: PointKind) => k.startsWith('switch') || k === 'dimmer' || k === 'pushbutton';

/** Something on the plan, in floor (world) coordinates. */
export interface ElecPoint {
  id: Id;
  floorId: Id;
  x_mm: number;
  y_mm: number;
  kind: PointKind;
  /** The breaker (MCB/RCBO device id) it's on. */
  circuitId?: Id;
  label?: string;
  /** Mounting height above the floor. */
  height_mm?: number;
  appliance?: Appliance;
  /** Switches and push buttons: the lights (point ids) they control. */
  controls?: Id[];
}

export interface Supply {
  phases: 1 | 3;
  /** 230 V single-phase, 3×230 V or 3N×400 V. */
  network: '230' | '3x230' | '3Nx400';
  mainRating_A: number;
  /** Earth electrode resistance, measured. */
  earth_ohm?: number;
  /** The service cable from the street to the meter (aansluitkabel). */
  streetCable?: Cable;
  /** The cable from the meter to the main fuse box. */
  meterCable?: Cable;
}

/** Cable types for circuits inside the house. */
export const CABLE_TYPES = ['XVB', 'XGB', 'EXVB', 'VOB', 'VVB', 'H07V-U'];
/** Cable types for the service cable (street → meter) and the meter → fuse box cable. */
export const STREET_CABLE_TYPES = ['EXVB', 'EAXVB', 'EXAVB', 'EVAVB', 'XVB'];
export const METER_CABLE_TYPES = ['XVB', 'XGB', 'EXVB', 'H07V-R', 'H07V-K'];
export const SUPPLY_SECTIONS = [6, 10, 16, 25, 35];

/** "EXVB 4×10" for supply cables (no earth core counted), "XVB 3G2,5" for circuits. */
export const cableText = (c: Cable, earth = true) =>
  `${c.type} ${c.cores}${earth ? 'G' : '×'}${String(c.section_mm2).replace('.', ',')}`;

export interface Electrical {
  supply: Supply;
  boards: Board[];
  points: ElecPoint[];
}

// ---- factories ---------------------------------------------------------------

export const emptyElectrical = (): Electrical => ({
  supply: { phases: 1, network: '230', mainRating_A: 40 },
  boards: [],
  points: [],
});

export interface DevicePreset {
  key: string;
  label: string;
  make: () => Omit<Device, 'id'>;
}

const cable = (section_mm2: number, cores = 3, type = 'XVB'): Cable => ({ type, cores, section_mm2 });
/** A sensible supply cable for the network: 2 cores single-phase, 4 for three-phase. */
export const defaultSupplyCable = (s: Supply, which: 'street' | 'meter'): Cable =>
  cable(s.mainRating_A > 40 ? 16 : 10, s.network === '230' ? 2 : s.network === '3x230' ? 3 : 4, which === 'street' ? 'EXVB' : 'XVB');

export const DEVICE_PRESETS: DevicePreset[] = [
  { key: 'main', label: 'Main switch 40 A', make: () => ({ kind: 'main', label: 'Main switch', modules: 2, poles: 2, rating_A: 40 }) },
  {
    key: 'rcd300',
    label: 'RCD 300 mA (main)',
    make: () => ({ kind: 'rcd', label: 'RCD 300 mA', modules: 2, poles: 2, rating_A: 40, sensitivity_mA: 300, rcdType: 'A' }),
  },
  {
    key: 'rcd30',
    label: 'RCD 30 mA',
    make: () => ({ kind: 'rcd', label: 'RCD 30 mA', modules: 2, poles: 2, rating_A: 40, sensitivity_mA: 30, rcdType: 'A' }),
  },
  {
    key: 'mcb-sockets',
    label: 'MCB 20 A – sockets',
    make: () => ({
      kind: 'mcb',
      label: '',
      modules: 1,
      poles: 2,
      rating_A: 20,
      curve: 'C',
      breaking_kA: 3,
      circuit: { name: 'Sockets', use: 'sockets', cable: cable(2.5) },
    }),
  },
  {
    key: 'mcb-light',
    label: 'MCB 16 A – lighting',
    make: () => ({
      kind: 'mcb',
      label: '',
      modules: 1,
      poles: 2,
      rating_A: 16,
      curve: 'C',
      breaking_kA: 3,
      circuit: { name: 'Lighting', use: 'lighting', cable: cable(1.5) },
    }),
  },
  {
    key: 'mcb-appliance',
    label: 'MCB 20 A – appliance',
    make: () => ({
      kind: 'mcb',
      label: '',
      modules: 1,
      poles: 2,
      rating_A: 20,
      curve: 'C',
      breaking_kA: 3,
      circuit: { name: 'Appliance', use: 'appliance', cable: cable(2.5) },
    }),
  },
  {
    key: 'mcb-hob',
    label: 'MCB 32 A – cooking',
    make: () => ({
      kind: 'mcb',
      label: '',
      modules: 2,
      poles: 2,
      rating_A: 32,
      curve: 'C',
      breaking_kA: 6,
      circuit: { name: 'Cooking hob', use: 'appliance', cable: cable(6) },
    }),
  },
  {
    key: 'rcbo',
    label: 'RCBO 16 A 30 mA',
    make: () => ({
      kind: 'rcbo',
      label: '',
      modules: 1,
      poles: 2,
      rating_A: 16,
      curve: 'C',
      sensitivity_mA: 30,
      rcdType: 'A',
      circuit: { name: 'Circuit', use: 'mixed', cable: cable(2.5) },
    }),
  },
  { key: 'spd', label: 'Surge protection', make: () => ({ kind: 'spd', label: 'SPD', modules: 2, poles: 2, rating_A: 0 }) },
  { key: 'contactor', label: 'Contactor (day/night)', make: () => ({ kind: 'contactor', label: 'Contactor', modules: 1, poles: 2, rating_A: 20 }) },
  {
    key: 'teleruptor',
    label: 'Teleruptor (for push buttons)',
    make: () => ({ kind: 'teleruptor', label: 'Teleruptor', modules: 1, poles: 1, rating_A: 16 }),
  },
  { key: 'timer', label: 'Timer', make: () => ({ kind: 'timer', label: 'Timer', modules: 1, poles: 1, rating_A: 16 }) },
  { key: 'other', label: 'Other module', make: () => ({ kind: 'other', label: 'Module', modules: 1, poles: 1, rating_A: 0 }) },
];

export function newBoard(letter: string, name = 'Main board'): Board {
  return { id: uid(), name, letter, rows: [{ id: uid(), modules: 13, devices: [] }] };
}

export const isBreaker = (d: Device) => d.kind === 'mcb' || d.kind === 'rcbo';
export const isRcd = (d: Device) => d.kind === 'rcd' || d.kind === 'rcbo';
export const usedModules = (r: DinRow) => r.devices.reduce((s, d) => s + d.modules, 0);
export const devicesOf = (b: Board) => b.rows.flatMap((r) => r.devices);

/** The next free board letter. */
export function nextLetter(boards: Board[]): string {
  for (let i = 0; i < 26; i++) {
    const l = String.fromCharCode(65 + i);
    if (!boards.some((b) => b.letter === l)) return l;
  }
  return 'Z';
}

/** Breaker id → circuit code ("A3"), numbered in rail order per board. */
export function circuitCodes(e: Electrical): Map<Id, string> {
  const m = new Map<Id, string>();
  for (const b of e.boards) {
    let n = 0;
    for (const d of devicesOf(b)) if (isBreaker(d)) m.set(d.id, `${b.letter}${++n}`);
  }
  return m;
}

/** Finds a device and its board. */
export function findDevice(e: Electrical, id?: Id): { board: Board; device: Device } | null {
  if (!id) return null;
  for (const board of e.boards) {
    const device = devicesOf(board).find((d) => d.id === id);
    if (device) return { board, device };
  }
  return null;
}

/** The chain of protective devices above a device, nearest first (RCDs and main switches, across sub-boards). */
export function upstreamOf(e: Electrical, id: Id): Device[] {
  const out: Device[] = [];
  const seen = new Set<Id>();
  let cur = findDevice(e, id);
  while (cur && !seen.has(cur.device.id)) {
    seen.add(cur.device.id);
    const up: { board: Board; device: Device } | null = cur.device.feeds
      ? findDevice(e, cur.device.feeds)
      : cur.board.fedBy
        ? findDevice(e, cur.board.fedBy)
        : null;
    if (up && up.device.id !== cur.device.id) out.push(up.device);
    cur = up;
  }
  return out;
}

/** The colour of a circuit on the plan (stable per code). */
export function circuitColor(code: string | undefined): string {
  if (!code) return '#9aa0a6';
  const palette = ['#c2410c', '#1d4ed8', '#15803d', '#a21caf', '#b45309', '#0e7490', '#be123c', '#4d7c0f', '#6d28d9', '#0369a1'];
  let h = 0;
  for (const ch of code) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}

export function newPoint(floorId: Id, kind: PointKind, x_mm: number, y_mm: number, circuitId?: Id): ElecPoint {
  const p: ElecPoint = { id: uid(), floorId, kind, x_mm: Math.round(x_mm), y_mm: Math.round(y_mm) };
  if (circuitId) p.circuitId = circuitId;
  if (isSocket(kind)) p.height_mm = 300;
  else if (isControl(kind)) p.height_mm = 1100;
  return p;
}

// ---- reading files ---------------------------------------------------------------

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown, f: number) => (typeof x === 'number' && Number.isFinite(x) ? x : f);
const str = (x: unknown, f: string) => (typeof x === 'string' ? x : f);
const oneOf = <T extends string>(x: unknown, list: readonly T[], f: T): T => (list.includes(x as T) ? (x as T) : f);
const optNum = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);

const DEVICE_KINDS = ['main', 'rcd', 'mcb', 'rcbo', 'spd', 'contactor', 'teleruptor', 'timer', 'other'] as const;
const USES = ['sockets', 'lighting', 'mixed', 'appliance', 'subboard', 'other'] as const;
const KINDS = POINT_KINDS.map((k) => k.id);
const APPL = APPLIANCES.map((a) => a.id);

function clean<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}

export function normalizeElectrical(x: unknown): Electrical | undefined {
  if (!isObj(x)) return undefined;
  const s = isObj(x.supply) ? x.supply : {};
  const boards = (Array.isArray(x.boards) ? x.boards : []).filter(isObj).map(
    (b): Board =>
      clean({
        id: str(b.id, uid()),
        name: str(b.name, 'Board'),
        letter: str(b.letter, 'A').slice(0, 2).toUpperCase(),
        fedBy: typeof b.fedBy === 'string' ? b.fedBy : undefined,
        location: isObj(b.location)
          ? { floorId: str(b.location.floorId, ''), x_mm: num(b.location.x_mm, 0), y_mm: num(b.location.y_mm, 0) }
          : undefined,
        rows: (Array.isArray(b.rows) ? b.rows : []).filter(isObj).map((r) => ({
          id: str(r.id, uid()),
          modules: Math.max(1, Math.round(num(r.modules, 13))),
          devices: (Array.isArray(r.devices) ? r.devices : []).filter(isObj).map((d): Device => {
            const c = isObj(d.circuit) ? d.circuit : null;
            const cab = c && isObj(c.cable) ? c.cable : {};
            return clean({
              id: str(d.id, uid()),
              kind: oneOf(d.kind, DEVICE_KINDS, 'other'),
              label: str(d.label, ''),
              modules: Math.max(1, Math.round(num(d.modules, 1))),
              poles: ([1, 2, 3, 4] as const).find((n) => n === d.poles) ?? 2,
              rating_A: num(d.rating_A, 0),
              curve: d.curve === 'B' || d.curve === 'C' || d.curve === 'D' ? d.curve : undefined,
              sensitivity_mA: optNum(d.sensitivity_mA),
              rcdType: d.rcdType === undefined ? undefined : oneOf(d.rcdType, ['AC', 'A', 'F', 'B'] as const, 'A'),
              breaking_kA: optNum(d.breaking_kA),
              feeds: typeof d.feeds === 'string' ? d.feeds : undefined,
              circuit: c
                ? {
                    name: str(c.name, ''),
                    use: oneOf(c.use, USES, 'other'),
                    cable: { type: str(cab.type, 'XVB'), cores: num(cab.cores, 3), section_mm2: num(cab.section_mm2, 2.5) },
                  }
                : undefined,
            });
          }),
        })),
      }),
  );
  const points = (Array.isArray(x.points) ? x.points : []).filter(isObj).map(
    (p): ElecPoint =>
      clean({
        id: str(p.id, uid()),
        floorId: str(p.floorId, ''),
        x_mm: num(p.x_mm, 0),
        y_mm: num(p.y_mm, 0),
        kind: oneOf(p.kind, KINDS, 'socket'),
        circuitId: typeof p.circuitId === 'string' ? p.circuitId : undefined,
        label: typeof p.label === 'string' ? p.label : undefined,
        height_mm: optNum(p.height_mm),
        appliance: p.appliance === undefined ? undefined : oneOf(p.appliance, APPL, 'other'),
        controls: Array.isArray(p.controls) ? p.controls.filter((x): x is string => typeof x === 'string') : undefined,
      }),
  );
  const supplyCable = (c: unknown): Cable | undefined =>
    isObj(c) ? { type: str(c.type, 'XVB'), cores: num(c.cores, 2), section_mm2: num(c.section_mm2, 10) } : undefined;
  return {
    supply: clean({
      phases: s.phases === 3 ? 3 : 1,
      network: oneOf(s.network, ['230', '3x230', '3Nx400'] as const, '230'),
      mainRating_A: num(s.mainRating_A, 40),
      earth_ohm: optNum(s.earth_ohm),
      streetCable: supplyCable(s.streetCable),
      meterCable: supplyCable(s.meterCable),
    }),
    boards,
    points,
  };
}

/** The switches and push buttons that control a light. */
export const controllersOf = (e: Electrical, lightId: Id) => e.points.filter((p) => p.controls?.includes(lightId));

/**
 * Links or unlinks a switch (or push button) and a light; either can be `a`.
 * Returns false when the two can't be linked (e.g. two sockets).
 */
export function toggleLink(a: ElecPoint, b: ElecPoint): boolean {
  const [ctl, light] = isControl(a.kind) && isLight(b.kind) ? [a, b] : isControl(b.kind) && isLight(a.kind) ? [b, a] : [null, null];
  if (!ctl || !light) return false;
  const list = ctl.controls ?? [];
  ctl.controls = list.includes(light.id) ? list.filter((x) => x !== light.id) : [...list, light.id];
  if (!ctl.controls.length) delete ctl.controls;
  return true;
}

/** Removes a point and every link to it. */
/**
 * Copies of `points` on `floorId`, moved by `offset` mm, added to the
 * installation. A copied switch controls the same lights, a copied light is on
 * the same switches (both only when those are still there).
 */
export function pastePoints(e: Electrical, points: ElecPoint[], floorId: Id, offset: { x: number; y: number }): ElecPoint[] {
  const out: ElecPoint[] = [];
  for (const src of points) {
    const p: ElecPoint = { ...JSON.parse(JSON.stringify(src)), id: uid(), floorId };
    p.x_mm = Math.round(src.x_mm + offset.x);
    p.y_mm = Math.round(src.y_mm + offset.y);
    const exists = (id: Id) => e.points.some((q) => q.id === id);
    if (p.controls) {
      p.controls = p.controls.filter(exists);
      if (!p.controls.length) delete p.controls;
    }
    for (const q of e.points) if (q.controls?.includes(src.id)) q.controls.push(p.id);
    e.points.push(p);
    out.push(p);
  }
  return out;
}

export function removePoint(e: Electrical, id: Id) {
  e.points = e.points.filter((p) => p.id !== id);
  for (const p of e.points) {
    if (p.controls?.includes(id)) {
      p.controls = p.controls.filter((x) => x !== id);
      if (!p.controls.length) delete p.controls;
    }
  }
}
