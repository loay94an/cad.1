/**
 * A first check of an installation against the main rules of the Belgian AREI
 * (Algemeen Reglement op de Elektrische Installaties) for homes. It's a help
 * while designing, NOT a certified inspection: the inspection body decides.
 *
 * All thresholds are in RULES so they're easy to review and adjust.
 */
import {
  type Device,
  type ElecPoint,
  type Electrical,
  applianceInfo,
  circuitCodes,
  devicesOf,
  isBreaker,
  isControl,
  isLight,
  isRcd,
  isSocket,
  upstreamOf,
  usedModules,
} from '../model/electrical';
import type { Id } from '../model/schema';

export const RULES = {
  /** Largest breaker (A) per copper cable section (mm²), for normal home wiring. */
  maxBreakerBySection: [
    [1.5, 16],
    [2.5, 20],
    [4, 25],
    [6, 32],
    [10, 40],
    [16, 63],
    [25, 80],
  ] as [number, number][],
  /** The cable from the meter to the main fuse box: at least this section. */
  meterCableMin_mm2: 10,
  /** Socket circuits: at least this section. */
  socketMinSection_mm2: 2.5,
  /** Socket circuits: at most this many socket points (a double or triple socket counts as one). */
  maxSocketPoints: 8,
  /** The RCD at the head of the installation: at most this sensitivity. */
  mainRcdMax_mA: 300,
  /** Bathrooms and washing machine, dryer, dishwasher circuits: at most this sensitivity. */
  wetRcdMax_mA: 30,
  /** More RCDs than this in series is a warning (selectivity, nuisance trips). */
  maxRcdLevels: 2,
  /** Room names that count as a bathroom or shower room. */
  wetRoom: /bad|douche|bath|shower|salle d'eau|wasplaats/i,
};

export type Level = 'error' | 'warn' | 'info';

export interface Issue {
  level: Level;
  text: string;
  deviceId?: Id;
  pointId?: Id;
  boardId?: Id;
}

export interface CheckContext {
  /** The name of the room a point is in, if any. */
  roomName?: (p: ElecPoint) => string | undefined;
}

const whereFn = (ctx: CheckContext) => (p: ElecPoint) => {
  const n = ctx.roomName?.(p);
  return n ? ` in ${n}` : '';
};

const maxForSection = (mm2: number): number | undefined => {
  let best: number | undefined;
  for (const [s, a] of RULES.maxBreakerBySection) if (mm2 >= s) best = a;
  return best;
};

export function checkInstallation(e: Electrical, ctx: CheckContext = {}): Issue[] {
  const issues: Issue[] = [];
  const where = whereFn(ctx);
  const codes = circuitCodes(e);
  const code = (d: Device) => codes.get(d.id) ?? d.label ?? '?';
  const pointsOf = (id: Id) => e.points.filter((p) => p.circuitId === id);
  const all = e.boards.flatMap((b) => devicesOf(b).map((device) => ({ board: b, device })));

  if (!e.boards.length) {
    issues.push({ level: 'info', text: 'No fuse box yet. Add one to start the single-line diagram.' });
  }

  // The service cable and the cable from the meter to the fuse box.
  for (const [what, c] of [
    ['street', e.supply.streetCable],
    ['meter', e.supply.meterCable],
  ] as const) {
    const name = what === 'street' ? 'The cable from the street' : 'The cable from the meter to the fuse box';
    if (!c) {
      if (e.boards.length) issues.push({ level: 'info', text: `${name} isn't filled in yet (Fuse boxes → Supply).` });
      continue;
    }
    const max = maxForSection(c.section_mm2);
    if (what === 'meter' && c.section_mm2 < RULES.meterCableMin_mm2) {
      issues.push({ level: 'error', text: `${name} must be at least ${RULES.meterCableMin_mm2} mm² (it's ${c.section_mm2} mm²).` });
    } else if (max === undefined || e.supply.mainRating_A > max) {
      issues.push({
        level: 'warn',
        text: `${name}: ${c.section_mm2} mm² is thin for a ${e.supply.mainRating_A} A main fuse${max ? ` (max ${max} A)` : ''}.`,
      });
    }
    const need = e.supply.network === '230' ? 2 : e.supply.network === '3x230' ? 3 : 4;
    if (c.cores < need) {
      issues.push({ level: 'warn', text: `${name} has ${c.cores} cores; this network needs ${need}.` });
    }
  }

  for (const b of e.boards) {
    for (const [i, r] of b.rows.entries()) {
      const used = usedModules(r);
      if (used > r.modules) {
        issues.push({
          level: 'error',
          boardId: b.id,
          text: `${b.name}, row ${i + 1}: ${used} modules on a ${r.modules}-module rail.`,
        });
      }
    }
  }

  // The head of the installation: everything needs an RCD of at most 300 mA upstream.
  for (const { device: d } of all.filter((x) => isBreaker(x.device))) {
    const chain = [d, ...upstreamOf(e, d.id)];
    const rcds = chain.filter(isRcd);
    const c = d.circuit;
    const pts = pointsOf(d.id);
    const name = `${code(d)}${c?.name ? ` (${c.name})` : ''}`;

    if (!rcds.length) {
      issues.push({ level: 'error', deviceId: d.id, text: `${name}: no residual-current device (RCD) upstream.` });
    } else if (Math.min(...rcds.map((r) => r.sensitivity_mA ?? Infinity)) > RULES.mainRcdMax_mA) {
      issues.push({
        level: 'error',
        deviceId: d.id,
        text: `${name}: the RCD upstream is more than ${RULES.mainRcdMax_mA} mA.`,
      });
    }
    if (rcds.length > RULES.maxRcdLevels) {
      issues.push({ level: 'warn', deviceId: d.id, text: `${name}: ${rcds.length} RCDs in series.` });
    }
    const best30 = Math.min(...rcds.map((r) => r.sensitivity_mA ?? Infinity));

    if (!c) continue;
    const section = c.cable.section_mm2;
    const max = maxForSection(section);
    if (max === undefined || d.rating_A > max) {
      issues.push({
        level: 'error',
        deviceId: d.id,
        text: `${name}: a ${d.rating_A} A breaker is too big for ${section} mm² cable${max ? ` (max ${max} A)` : ''}.`,
      });
    }

    const sockets = pts.filter((p) => isSocket(p.kind));
    if (sockets.length && section < RULES.socketMinSection_mm2) {
      issues.push({
        level: 'error',
        deviceId: d.id,
        text: `${name}: sockets need at least ${RULES.socketMinSection_mm2} mm² cable.`,
      });
    }
    if (sockets.length > RULES.maxSocketPoints) {
      issues.push({
        level: 'error',
        deviceId: d.id,
        text: `${name}: ${sockets.length} socket points; at most ${RULES.maxSocketPoints} per circuit (a double socket counts as one).`,
      });
    }

    // Appliances that need their own circuit.
    const dedicated = pts.filter((p) => p.kind === 'appliance' && applianceInfo(p.appliance)?.dedicated);
    if (dedicated.length && pts.length > 1) {
      const a = applianceInfo(dedicated[0].appliance)!;
      issues.push({
        level: 'error',
        deviceId: d.id,
        text: `${name}: the ${a.label.toLowerCase()} needs a circuit of its own, but ${pts.length - 1} other point${pts.length === 2 ? ' is' : 's are'} on it.`,
      });
    }

    // 30 mA where water is around.
    const wetAppliance = pts.find((p) => p.kind === 'appliance' && applianceInfo(p.appliance)?.rcd30);
    const wetRoom = ctx.roomName && pts.map((p) => ctx.roomName!(p)).find((n) => n && RULES.wetRoom.test(n));
    if ((wetAppliance || wetRoom) && best30 > RULES.wetRcdMax_mA) {
      const why = wetAppliance ? applianceInfo(wetAppliance.appliance)!.label.toLowerCase() : `“${wetRoom}”`;
      issues.push({
        level: 'error',
        deviceId: d.id,
        text: `${name}: the ${why} needs a ${RULES.wetRcdMax_mA} mA RCD upstream.`,
      });
    }

    if (!pts.length && c.use !== 'subboard') {
      issues.push({ level: 'info', deviceId: d.id, text: `${name}: nothing on the plan is linked to it yet.` });
    }
    if (c.use === 'lighting' && sockets.length) {
      issues.push({ level: 'warn', deviceId: d.id, text: `${name}: a lighting circuit with sockets on it.` });
    }
    if (c.use === 'sockets' && pts.some((p) => isLight(p.kind))) {
      issues.push({ level: 'info', deviceId: d.id, text: `${name}: lights on a socket circuit (set it to “mixed”).` });
    }
  }

  // RCD ratings: at least the breakers it protects (simple check).
  for (const { device: r } of all.filter((x) => x.device.kind === 'rcd')) {
    const below = all.filter((x) => isBreaker(x.device) && upstreamOf(e, x.device.id).some((u) => u.id === r.id));
    const biggest = Math.max(0, ...below.map((x) => x.device.rating_A));
    if (r.rating_A < biggest) {
      issues.push({
        level: 'warn',
        deviceId: r.id,
        text: `${r.label || 'RCD'}: rated ${r.rating_A} A, below the ${biggest} A breaker after it.`,
      });
    }
    if (r.sensitivity_mA !== undefined && r.sensitivity_mA > RULES.mainRcdMax_mA) {
      issues.push({ level: 'warn', deviceId: r.id, text: `${r.label || 'RCD'}: ${r.sensitivity_mA} mA is more than ${RULES.mainRcdMax_mA} mA.` });
    }
  }
  const mainRcds = all.filter((x) => x.device.kind === 'rcd' && !x.device.feeds && !x.board.fedBy);
  for (const { device: r } of mainRcds) {
    if (r.rating_A < e.supply.mainRating_A) {
      issues.push({
        level: 'warn',
        deviceId: r.id,
        text: `${r.label || 'Main RCD'}: rated ${r.rating_A} A, below the ${e.supply.mainRating_A} A supply.`,
      });
    }
  }

  // Points.
  for (const p of e.points) {
    if (!p.circuitId) {
      issues.push({ level: 'warn', pointId: p.id, text: `${p.label || 'A point'} is not linked to a circuit.` });
    } else if (!codes.has(p.circuitId)) {
      issues.push({ level: 'warn', pointId: p.id, text: `${p.label || 'A point'} is linked to a breaker that no longer exists.` });
    }
  }

  // Switches and lights (help, not AREI rules).
  const switched = new Set(e.points.flatMap((p) => p.controls ?? []));
  for (const p of e.points) {
    if (isLight(p.kind) && !switched.has(p.id)) {
      issues.push({ level: 'info', pointId: p.id, text: `${p.label || 'A light'}${where(p)} has no switch linked to it.` });
    }
    if (isControl(p.kind) && !p.controls?.length) {
      issues.push({ level: 'info', pointId: p.id, text: `${p.label || 'A switch'}${where(p)} doesn't control any light yet.` });
    }
  }
  const pushed = e.points.filter((p) => p.kind === 'pushbutton' && p.controls?.length);
  const hasTeleruptor = e.boards.some((b) => devicesOf(b).some((d) => d.kind === 'teleruptor'));
  if (pushed.length && !hasTeleruptor) {
    issues.push({ level: 'info', text: 'Push buttons need a teleruptor (impulse relay); none in the fuse boxes yet.' });
  }

  const order: Record<Level, number> = { error: 0, warn: 1, info: 2 };
  return issues.sort((a, b) => order[a.level] - order[b.level]);
}
