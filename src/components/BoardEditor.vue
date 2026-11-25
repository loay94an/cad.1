<script setup lang="ts">
import AppIcon from './AppIcon.vue';
/**
 * Fuse boxes: DIN rails with their devices, what feeds what, and the circuit
 * behind each breaker. Changes go straight into the project (undo works).
 *
 * Tap a free slot to add a device; drag devices to move them (also to
 * another row or board); duplicate, copy and paste from the device panel or
 * with Ctrl+D / Ctrl+C / Ctrl+V.
 */
import { computed, onBeforeUnmount, ref } from 'vue';
import {
  type Board,
  CABLE_TYPES,
  type Cable,
  type CircuitUse,
  METER_CABLE_TYPES,
  STREET_CABLE_TYPES,
  SUPPLY_SECTIONS,
  defaultSupplyCable,
  type DinRow,
  DEVICE_PRESETS,
  type Device,
  type ElecPoint,
  type Electrical,
  circuitCodes,
  circuitColor,
  devicesOf,
  isBreaker,
  isRcd,
  newBoard,
  nextLetter,
  pointInfo,
  usedModules,
} from '../model/electrical';
import { uid } from '../model/schema';
import { checkInstallation } from '../electrical/arei';
import { ctrlOrCmd, isTyping, useKeydown } from '../composables/useShortcuts';

/** Copied device; kept while the app is open, so it can be pasted into another plan too. */
const clipboard = ref<Device | null>(null);

const props = defineProps<{
  electrical: Electrical;
  roomName: (p: ElecPoint) => string | undefined;
}>();
const emit = defineEmits<{ close: []; placeBoard: [id: string]; schema: [] }>();

/** The two supply cables: from the street to the meter, and from the meter to the main fuse box. */
const SUPPLY_CABLES = [
  { key: 'streetCable', which: 'street', label: 'Cable from the street', types: STREET_CABLE_TYPES },
  { key: 'meterCable', which: 'meter', label: 'Cable meter → fuse box', types: METER_CABLE_TYPES },
] as const;
function setSupplyCableType(key: 'streetCable' | 'meterCable', which: 'street' | 'meter', type: string) {
  const s = props.electrical.supply;
  if (!type) delete s[key];
  else if (s[key]) s[key]!.type = type;
  else s[key] = { ...defaultSupplyCable(s, which), type } satisfies Cable;
}

const e = props.electrical;
const selected = ref<string | null>(null);
/** The add dialog: which row, and where in it. */
const adding = ref<{ board: Board; row: DinRow; index: number } | null>(null);
const codes = computed(() => circuitCodes(e));
const issues = computed(() => checkInstallation(e, { roomName: props.roomName }));
const counts = computed(() => ({
  error: issues.value.filter((i) => i.level === 'error').length,
  warn: issues.value.filter((i) => i.level === 'warn').length,
}));

const sel = computed(() => {
  for (const board of e.boards) {
    for (const row of board.rows) {
      const i = row.devices.findIndex((d) => d.id === selected.value);
      if (i >= 0) return { board, row, i, device: row.devices[i] };
    }
  }
  return null;
});

const upstreamChoices = (self: Device) =>
  e.boards.flatMap((b) =>
    devicesOf(b)
      .filter((d) => d.id !== self.id && (d.kind === 'main' || d.kind === 'rcd'))
      .map((d) => ({ id: d.id, label: `${b.letter}: ${d.label || d.kind}${d.sensitivity_mA ? ` ${d.sensitivity_mA} mA` : ''}` })),
  );

const breakerChoices = (exclude: Board) =>
  e.boards
    .filter((b) => b.id !== exclude.id)
    .flatMap((b) => devicesOf(b).filter(isBreaker).map((d) => ({ id: d.id, label: `${codes.value.get(d.id)} ${d.circuit?.name ?? ''}` })));

const pointsOn = (id: string) => e.points.filter((p) => p.circuitId === id);

function addBoard() {
  const b = newBoard(nextLetter(e.boards), e.boards.length ? `Sub-board ${nextLetter(e.boards)}` : 'Main board');
  e.boards.push(b);
}

function removeBoard(b: Board) {
  const linked = devicesOf(b).filter(isBreaker).reduce((n, d) => n + pointsOn(d.id).length, 0);
  if (!confirm(`Delete ${b.name}${linked ? `? ${linked} point(s) on the plan lose their circuit.` : '?'}`)) return;
  const ids = new Set(devicesOf(b).map((d) => d.id));
  for (const p of e.points) if (p.circuitId && ids.has(p.circuitId)) delete p.circuitId;
  e.boards.splice(e.boards.indexOf(b), 1);
}

/** Wired after the nearest RCD (or main switch) to its left on this board. */
function defaultFeed(b: Board, d: Device, before: Device[]): string | undefined {
  if (d.kind === 'rcd' || d.kind === 'main') {
    const head = before.find((x) => x.kind === 'main' || (x.kind === 'rcd' && (x.sensitivity_mA ?? 0) >= 100));
    return d.kind === 'rcd' && (d.sensitivity_mA ?? 300) < 100 ? head?.id : undefined;
  }
  return [...before].reverse().find((x) => x.kind === 'rcd' || x.kind === 'main')?.id;
}

/** Devices on the board to the left of position `index` in `row`. */
function devicesBefore(b: Board, row: DinRow, index: number): Device[] {
  const out: Device[] = [];
  for (const r of b.rows) {
    if (r === row) return out.concat(r.devices.slice(0, index));
    out.push(...r.devices);
  }
  return out;
}

const cloneDevice = (d: Device): Device => ({ ...JSON.parse(JSON.stringify(d)), id: uid() });

function insert(b: Board, row: DinRow, index: number, d: Device) {
  const feed = defaultFeed(b, d, devicesBefore(b, row, index));
  if (feed) d.feeds = feed;
  else delete d.feeds;
  row.devices.splice(index, 0, d);
  selected.value = d.id;
}

function openAdd(b: Board, row: DinRow, index = row.devices.length) {
  adding.value = { board: b, row, index };
}

function addPreset(key: string) {
  const a = adding.value;
  const p = DEVICE_PRESETS.find((x) => x.key === key);
  if (!a || !p) return;
  insert(a.board, a.row, a.index, { id: uid(), ...JSON.parse(JSON.stringify(p.make())) });
  adding.value = null;
}

function pasteInto(b: Board, row: DinRow, index: number) {
  if (!clipboard.value) return;
  insert(b, row, index, cloneDevice(clipboard.value));
  adding.value = null;
}

function copySelected() {
  if (sel.value) clipboard.value = JSON.parse(JSON.stringify(sel.value.device));
}

function duplicateSelected() {
  const s = sel.value;
  if (!s) return;
  // Same wiring as the original: a copy of a breaker sits under the same RCD.
  const d = cloneDevice(s.device);
  s.row.devices.splice(s.i + 1, 0, d);
  selected.value = d.id;
}

/** Paste after the selected device, or at the end of the first board's last row. */
function pasteHere() {
  const s = sel.value;
  if (s) pasteInto(s.board, s.row, s.i + 1);
  else if (e.boards[0]) {
    const row = e.boards[0].rows[e.boards[0].rows.length - 1];
    pasteInto(e.boards[0], row, row.devices.length);
  }
}

// ---- dragging devices ----------------------------------------------------------------

const drag = ref<{ id: string; x: number; y: number; moved: boolean; label: string; w: number } | null>(null);
const dropAt = ref<{ rowId: string; index: number } | null>(null);
let startX = 0;
let startY = 0;

function onDevDown(ev: PointerEvent, d: Device) {
  if (ev.button !== 0) return;
  startX = ev.clientX;
  startY = ev.clientY;
  const w = (ev.currentTarget as HTMLElement).getBoundingClientRect().width;
  drag.value = { id: d.id, x: ev.clientX, y: ev.clientY, moved: false, label: deviceTitle(d), w };
  try {
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
  } catch {
    // synthetic pointer
  }
}

function onDevMove(ev: PointerEvent) {
  const g = drag.value;
  if (!g) return;
  if (!g.moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
  g.moved = true;
  g.x = ev.clientX;
  g.y = ev.clientY;
  dropAt.value = dropTarget(ev.clientX, ev.clientY);
}

/** The rail under the pointer, and the gap between devices nearest to it. */
function dropTarget(x: number, y: number): { rowId: string; index: number } | null {
  const rail = document
    .elementsFromPoint(x, y)
    .map((el) => el.closest<HTMLElement>('[data-row]'))
    .find((el) => !!el);
  if (!rail) return null;
  const devs = [...rail.querySelectorAll<HTMLElement>('[data-dev]')].filter((el) => el.dataset.dev !== drag.value?.id);
  const index = devs.filter((el) => {
    const r = el.getBoundingClientRect();
    return r.left + r.width / 2 < x;
  }).length;
  return { rowId: rail.dataset.row!, index };
}

function onDevUp(ev: PointerEvent, d: Device) {
  const g = drag.value;
  drag.value = null;
  const target = dropAt.value;
  dropAt.value = null;
  if (!g) return;
  if (!g.moved) {
    selected.value = selected.value === d.id ? null : d.id;
    return;
  }
  if (!target) return;
  moveDevice(d.id, target.rowId, target.index);
  void ev;
}

function moveDevice(id: string, rowId: string, index: number) {
  let found: { board: Board; row: DinRow; i: number } | null = null;
  let dest: { board: Board; row: DinRow } | null = null;
  for (const board of e.boards) {
    for (const row of board.rows) {
      const i = row.devices.findIndex((x) => x.id === id);
      if (i >= 0) found = { board, row, i };
      if (row.id === rowId) dest = { board, row };
    }
  }
  if (!found || !dest) return;
  const [d] = found.row.devices.splice(found.i, 1);
  dest.row.devices.splice(Math.min(index, dest.row.devices.length), 0, d);
  // Moved to another board: its "wired after" must be on that board.
  if (dest.board !== found.board && d.feeds && !devicesOf(dest.board).some((x) => x.id === d.feeds)) {
    const feed = defaultFeed(dest.board, d, devicesBefore(dest.board, dest.row, dest.row.devices.indexOf(d)));
    if (feed) d.feeds = feed;
    else delete d.feeds;
  }
  selected.value = d.id;
}

/** Where the drop marker goes in this row (index in row.devices), or -1. */
function markerAt(row: DinRow): number {
  const t = dropAt.value;
  if (!t || t.rowId !== row.id || !drag.value) return -1;
  const j = row.devices.findIndex((d) => d.id === drag.value!.id);
  return j >= 0 && j < t.index + 1 && t.index >= j ? t.index + 1 : t.index;
}

function cancelDrag() {
  drag.value = null;
  dropAt.value = null;
}
onBeforeUnmount(cancelDrag);

useKeydown((ev) => {
  if (adding.value) {
    if (ev.key === 'Escape') {
      adding.value = null;
      ev.preventDefault();
    }
    return;
  }
  if (isTyping(ev)) return;
  const k = ev.key.toLowerCase();
  if (ctrlOrCmd(ev) && k === 'c' && sel.value) copySelected();
  else if (ctrlOrCmd(ev) && k === 'v' && clipboard.value) pasteHere();
  else if (ctrlOrCmd(ev) && k === 'd' && sel.value) duplicateSelected();
  else if ((ev.key === 'Delete' || ev.key === 'Backspace') && sel.value) removeDevice();
  else if (ev.key === 'Escape') {
    if (selected.value) selected.value = null;
    else emit('close');
  } else return;
  ev.preventDefault();
});

function move(dir: -1 | 1) {
  const s = sel.value;
  if (!s) return;
  const j = s.i + dir;
  if (j < 0 || j >= s.row.devices.length) return;
  const [d] = s.row.devices.splice(s.i, 1);
  s.row.devices.splice(j, 0, d);
}

function removeDevice() {
  const s = sel.value;
  if (!s) return;
  const n = pointsOn(s.device.id).length;
  if (n && !confirm(`${n} point(s) on the plan are on this circuit. Remove it anyway?`)) return;
  for (const p of e.points) if (p.circuitId === s.device.id) delete p.circuitId;
  for (const d of e.boards.flatMap(devicesOf)) if (d.feeds === s.device.id) d.feeds = s.device.feeds;
  s.row.devices.splice(s.i, 1);
  selected.value = null;
}

function setKindDefaults(d: Device) {
  if (isBreaker(d)) {
    d.curve ??= 'C';
    d.circuit ??= { name: 'Circuit', use: 'mixed', cable: { type: 'XVB', cores: 3, section_mm2: 2.5 } };
  } else delete d.circuit;
  if (isRcd(d)) {
    d.sensitivity_mA ??= 30;
    d.rcdType ??= 'A';
  } else {
    delete d.sensitivity_mA;
    delete d.rcdType;
  }
}

const USES: { id: CircuitUse; label: string }[] = [
  { id: 'sockets', label: 'Sockets' },
  { id: 'lighting', label: 'Lighting' },
  { id: 'mixed', label: 'Mixed (sockets + lights)' },
  { id: 'appliance', label: 'One appliance' },
  { id: 'subboard', label: 'Sub-board' },
  { id: 'other', label: 'Other' },
];

const deviceTitle = (d: Device) =>
  isBreaker(d)
    ? `${codes.value.get(d.id)}`
    : d.kind === 'rcd'
      ? `${d.sensitivity_mA}mA`
      : d.kind === 'main'
        ? 'Main'
        : d.label || d.kind.toUpperCase();
const deviceSub = (d: Device) =>
  isBreaker(d) ? `${d.curve ?? ''}${d.rating_A}` : d.kind === 'rcd' || d.kind === 'main' ? `${d.rating_A}A` : '';

function jumpTo(i: { deviceId?: string }) {
  if (i.deviceId) selected.value = i.deviceId;
}
</script>

<template>
  <div class="sheet board-editor">
    <header class="topbar">
      <button class="btn ghost" aria-label="Close" @click="emit('close')">‹</button>
      <h1 class="title-block">Fuse boxes</h1>
      <button class="btn" @click="emit('schema')">📄 Diagram</button>
    </header>
    <div class="editor-body">
      <section class="card-flat">
        <h2>Supply</h2>
        <div class="row-actions">
          <label class="field">
            <span class="field-label">Network</span>
            <select v-model="e.supply.network" @change="e.supply.phases = e.supply.network === '230' ? 1 : 3">
              <option value="230">230 V single-phase</option>
              <option value="3x230">3×230 V</option>
              <option value="3Nx400">3N×400 V</option>
            </select>
          </label>
          <label class="field">
            <span class="field-label">Main fuse (A)</span>
            <input v-model.number="e.supply.mainRating_A" type="number" min="10" step="1" />
          </label>
          <label class="field">
            <span class="field-label">Earth resistance (Ω)</span>
            <input v-model.number="e.supply.earth_ohm" type="number" min="0" step="1" placeholder="measured" />
          </label>
        </div>
        <div v-for="sc in SUPPLY_CABLES" :key="sc.key" class="supply-cable">
          <label class="field">
            <span class="field-label">{{ sc.label }}</span>
            <select
              :value="e.supply[sc.key]?.type ?? ''"
              @change="setSupplyCableType(sc.key, sc.which, ($event.target as HTMLSelectElement).value)"
            >
              <option value="">Not filled in</option>
              <option v-for="t in sc.types" :key="t">{{ t }}</option>
            </select>
          </label>
          <template v-if="e.supply[sc.key]">
            <label class="field">
              <span class="field-label">Cores</span>
              <select v-model.number="e.supply[sc.key]!.cores">
                <option v-for="n in [2, 3, 4, 5]" :key="n" :value="n">{{ n }}×</option>
              </select>
            </label>
            <label class="field">
              <span class="field-label">Section</span>
              <select v-model.number="e.supply[sc.key]!.section_mm2">
                <option v-for="m in SUPPLY_SECTIONS" :key="m" :value="m">{{ m }} mm²</option>
              </select>
            </label>
          </template>
        </div>
      </section>

      <section v-for="b in e.boards" :key="b.id" class="card-flat">
        <div class="board-head">
          <input v-model="b.name" class="board-name" aria-label="Board name" />
          <label class="field letter">
            <span class="field-label">Code</span>
            <input v-model="b.letter" maxlength="2" />
          </label>
          <button class="btn small" title="Put it on the plan" @click="emit('placeBoard', b.id)">
            📍 {{ b.location ? 'Move' : 'Place' }}
          </button>
          <button class="btn icon danger" :aria-label="`Delete ${b.name}`" @click="removeBoard(b)"><AppIcon name="trash" /></button>
        </div>
        <label v-if="e.boards.length > 1" class="field">
          <span class="field-label">Fed by</span>
          <select :value="b.fedBy ?? ''" @change="b.fedBy = ($event.target as HTMLSelectElement).value || undefined">
            <option value="">The supply (main board)</option>
            <option v-for="c in breakerChoices(b)" :key="c.id" :value="c.id">{{ c.label }}</option>
          </select>
        </label>

        <div v-for="(row, ri) in b.rows" :key="row.id" class="din-row-wrap">
          <div class="din-row-head">
            <span class="small-check">Row {{ ri + 1 }}: {{ usedModules(row) }}/</span>
            <select v-model.number="row.modules" class="mod-select" aria-label="Modules on this rail">
              <option v-for="m in [8, 12, 13, 18, 24]" :key="m" :value="m">{{ m }}</option>
            </select>
            <span class="field-label">modules</span>
            <button
              v-if="b.rows.length > 1 && !row.devices.length"
              class="btn icon small danger"
              aria-label="Remove row"
              @click="b.rows.splice(ri, 1)"
            >
              ✕
            </button>
          </div>
          <div
            class="din-rail"
            :class="{ 'drop-here': dropAt?.rowId === row.id }"
            :data-row="row.id"
            :style="{ '--mods': Math.max(row.modules, usedModules(row)) }"
          >
            <template v-for="(d, i) in row.devices" :key="d.id">
              <span v-if="markerAt(row) === i" class="din-drop" aria-hidden="true"></span>
              <button
                class="din-dev"
                :class="[`k-${d.kind}`, { on: d.id === selected, dragging: drag?.moved && drag.id === d.id }]"
                :data-dev="d.id"
                :style="{ '--w': d.modules, '--c': isBreaker(d) ? circuitColor(codes.get(d.id)) : undefined }"
                :title="`${d.circuit?.name || d.label || ''} · drag to move`"
                @pointerdown="onDevDown($event, d)"
                @pointermove="onDevMove"
                @pointerup="onDevUp($event, d)"
                @pointercancel="cancelDrag"
              >
                <strong>{{ deviceTitle(d) }}</strong>
                <small>{{ deviceSub(d) }}</small>
              </button>
            </template>
            <span v-if="markerAt(row) === row.devices.length" class="din-drop" aria-hidden="true"></span>
            <button
              v-for="k in Math.max(0, row.modules - usedModules(row))"
              :key="'free' + k"
              class="din-free"
              :aria-label="`Add a device to row ${ri + 1}`"
              title="Add a device here"
              @click="openAdd(b, row)"
            >
              <span v-if="k === 1">+</span>
            </button>
            <button
              v-if="usedModules(row) >= row.modules"
              class="din-free din-add"
              :aria-label="`Add a device to row ${ri + 1}`"
              title="Add a device (the rail is full)"
              @click="openAdd(b, row)"
            >
              +
            </button>
          </div>
          <p v-if="usedModules(row) > row.modules" class="residual bad-text">Too many modules for this rail.</p>
        </div>
        <p v-if="!devicesOf(b).length" class="hint">Tap a free slot on the rail to add a device.</p>
        <div class="row-actions">
          <button class="btn" @click="b.rows.push({ id: uid(), modules: b.rows[0]?.modules ?? 13, devices: [] })">+ Row</button>
        </div>

        <!-- the selected device on this board -->
        <div v-if="sel && sel.board.id === b.id" class="device-form">
          <div class="row-actions">
            <label class="field">
              <span class="field-label">Type</span>
              <select v-model="sel.device.kind" @change="setKindDefaults(sel.device)">
                <option value="main">Main switch</option>
                <option value="rcd">RCD (differential)</option>
                <option value="mcb">MCB (circuit breaker)</option>
                <option value="rcbo">RCBO (breaker + RCD)</option>
                <option value="spd">Surge protection</option>
                <option value="contactor">Contactor</option>
                <option value="teleruptor">Teleruptor</option>
                <option value="timer">Timer</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label class="field">
              <span class="field-label">Label</span>
              <input v-model="sel.device.label" />
            </label>
            <label class="field">
              <span class="field-label">Modules</span>
              <input v-model.number="sel.device.modules" type="number" min="1" max="12" />
            </label>
            <label class="field">
              <span class="field-label">Poles</span>
              <select v-model.number="sel.device.poles">
                <option v-for="n in [1, 2, 3, 4]" :key="n" :value="n">{{ n }}P</option>
              </select>
            </label>
            <label v-if="sel.device.kind !== 'spd' && sel.device.kind !== 'other'" class="field">
              <span class="field-label">Rating (A)</span>
              <select v-model.number="sel.device.rating_A">
                <option v-for="a in [6, 10, 13, 16, 20, 25, 32, 40, 50, 63, 80, 100]" :key="a" :value="a">{{ a }} A</option>
              </select>
            </label>
            <label v-if="isBreaker(sel.device)" class="field">
              <span class="field-label">Curve</span>
              <select v-model="sel.device.curve">
                <option>B</option>
                <option>C</option>
                <option>D</option>
              </select>
            </label>
            <label v-if="isBreaker(sel.device)" class="field">
              <span class="field-label">Breaking (kA)</span>
              <select v-model.number="sel.device.breaking_kA">
                <option v-for="k in [3, 4.5, 6, 10]" :key="k" :value="k">{{ k }} kA</option>
              </select>
            </label>
            <template v-if="isRcd(sel.device)">
              <label class="field">
                <span class="field-label">Sensitivity</span>
                <select v-model.number="sel.device.sensitivity_mA">
                  <option v-for="m in [10, 30, 100, 300, 500]" :key="m" :value="m">{{ m }} mA</option>
                </select>
              </label>
              <label class="field">
                <span class="field-label">RCD type</span>
                <select v-model="sel.device.rcdType">
                  <option>AC</option>
                  <option>A</option>
                  <option>F</option>
                  <option>B</option>
                </select>
              </label>
            </template>
            <label v-if="sel.device.kind !== 'main' || upstreamChoices(sel.device).length" class="field wide-field">
              <span class="field-label">Wired after</span>
              <select :value="sel.device.feeds ?? ''" @change="sel.device.feeds = ($event.target as HTMLSelectElement).value || undefined">
                <option value="">{{ b.fedBy ? 'The sub-board supply' : 'The supply' }}</option>
                <option v-for="c in upstreamChoices(sel.device)" :key="c.id" :value="c.id">{{ c.label }}</option>
              </select>
            </label>
          </div>
          <template v-if="sel.device.circuit">
            <h3>Circuit {{ codes.get(sel.device.id) }}</h3>
            <div class="row-actions">
              <label class="field wide-field">
                <span class="field-label">Name</span>
                <input v-model="sel.device.circuit.name" placeholder="e.g. Kitchen sockets" />
              </label>
              <label class="field">
                <span class="field-label">Used for</span>
                <select v-model="sel.device.circuit.use">
                  <option v-for="u in USES" :key="u.id" :value="u.id">{{ u.label }}</option>
                </select>
              </label>
              <label class="field">
                <span class="field-label">Cable</span>
                <select v-model="sel.device.circuit.cable.type">
                  <option v-for="t in CABLE_TYPES" :key="t">{{ t }}</option>
                </select>
              </label>
              <label class="field">
                <span class="field-label">Cores</span>
                <select v-model.number="sel.device.circuit.cable.cores">
                  <option v-for="n in [2, 3, 4, 5]" :key="n" :value="n">{{ n }}G</option>
                </select>
              </label>
              <label class="field">
                <span class="field-label">Section</span>
                <select v-model.number="sel.device.circuit.cable.section_mm2">
                  <option v-for="m in [1.5, 2.5, 4, 6, 10, 16, 25]" :key="m" :value="m">{{ m }} mm²</option>
                </select>
              </label>
            </div>
            <p class="hint">
              On the plan: {{ pointsOn(sel.device.id).length }} point(s){{
                pointsOn(sel.device.id).length
                  ? ' – ' + pointsOn(sel.device.id).map((p) => p.label || pointInfo(p.kind).label).join(', ')
                  : '. In Electrical mode, pick this circuit and tap on the plan to add points.'
              }}
            </p>
          </template>
          <div class="row-actions">
            <button class="btn" aria-label="Move left" @click="move(-1)">◀</button>
            <button class="btn" aria-label="Move right" @click="move(1)">▶</button>
            <button class="btn" title="Duplicate (Ctrl+D)" @click="duplicateSelected"><AppIcon name="copy" /> Duplicate</button>
            <button class="btn" title="Copy (Ctrl+C)" @click="copySelected">Copy</button>
            <button class="btn" :disabled="!clipboard" title="Paste after this one (Ctrl+V)" @click="pasteHere">Paste</button>
            <span class="spacer"></span>
            <button class="btn danger" @click="removeDevice">Remove</button>
            <button class="btn" @click="selected = null">Done</button>
          </div>
        </div>
      </section>

      <div class="row-actions">
        <button class="btn" :class="{ primary: !e.boards.length }" @click="addBoard">
          + {{ e.boards.length ? 'Sub-board' : 'Fuse box' }}
        </button>
      </div>

      <section class="card-flat">
        <h2>
          AREI check
          <small class="hint">{{ counts.error }} error(s), {{ counts.warn }} warning(s)</small>
        </h2>
        <p class="hint">A help while designing, not a certified inspection.</p>
        <ul class="issues">
          <li v-for="(i, k) in issues" :key="k" :class="i.level" @click="jumpTo(i)">{{ i.text }}</li>
        </ul>
        <p v-if="!issues.length" class="status ok">No problems found.</p>
      </section>
    </div>
    <!-- add a device -->
    <div v-if="adding" class="backdrop" @click.self="adding = null">
      <div class="dialog add-device">
        <h2>Add to {{ adding.board.name }}, row {{ adding.board.rows.indexOf(adding.row) + 1 }}</h2>
        <button v-if="clipboard" class="btn wide paste-btn" @click="pasteInto(adding.board, adding.row, adding.index)">
          📋 Paste {{ clipboard.circuit?.name || clipboard.label || clipboard.kind }}
          <small>{{ clipboard.modules }} module{{ clipboard.modules === 1 ? '' : 's' }}</small>
        </button>
        <div class="preset-grid">
          <button v-for="p in DEVICE_PRESETS" :key="p.key" class="preset-btn" @click="addPreset(p.key)">
            <strong>{{ p.label }}</strong>
            <small>{{ p.make().modules }} module{{ p.make().modules === 1 ? '' : 's' }}</small>
          </button>
        </div>
        <div class="row-actions end">
          <button class="btn" @click="adding = null">Cancel</button>
        </div>
      </div>
    </div>

    <div
      v-if="drag?.moved"
      class="din-ghost"
      :style="{ left: `${drag.x - drag.w / 2}px`, top: `${drag.y - 30}px`, width: `${drag.w}px` }"
      aria-hidden="true"
    >
      {{ drag.label }}
    </div>
  </div>
</template>
