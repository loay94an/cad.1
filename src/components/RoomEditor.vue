<script setup lang="ts">
/**
 * Edit one room in the mode chosen on the main screen: Layout (walls, corners,
 * diagonals, doors and windows, stairs), Notes & files, Furniture, and
 * Installations (electrical, water, heating; later).
 * The drawing and the form share one selection: tap something in the drawing to
 * jump to its field, or focus a field to highlight it in the drawing.
 */
import { HEADROOM_MM, ceilingPlanes, hasSlope, headroomArea_m2 } from '../geometry/ceiling';
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import {
  type Attachment,
  type Furniture,
  type LengthUnit,
  type Opening,
  type OpeningType,
  type Room,
  type Stair,
  type ViewSettings,
  type Wall,
  type WallKind,
  holeSpan,
  type WallStatus,
  hasWallType,
  fileIdOf,
  isAngleMeasured,
  newOpening,
  newPin,
  newStair,
  newFixed,
  FIXED_KINDS,
  type FixedKind,
  newWall,
  uid,
} from '../model/schema';
import { FURNITURE_PRESETS, furnitureHeight, newFurniture } from '../model/furniture';
import {
  clipboard,
  copyToClipboard,
  groupNames,
  groupOf,
  moveInList,
  pasteFurniture,
  pasteOpening,
  turnGroup,
} from '../model/clipboard';
import { FLOOR_COVERINGS, floorCovering } from '../model/finishes';
import { interiorAngle } from '../geometry/room';
import { matchingWalls, openingGeometry, roomGeometry, wallLength } from '../geometry/floor';
import { centroid, normDeg } from '../geometry/vec';
import type { StorageAdapter } from '../storage/types';
import { deleteUnusedFiles } from '../storage/versions';
import { ctrlOrCmd, isTyping, useKeydown } from '../composables/useShortcuts';
import { useEditHistory } from '../composables/useEditHistory';
import { formatLength, parseLength } from '../units';
import { canRemoveCorner, removeCorner, splitWall } from '../model/walls';
import AttachmentsPanel from './AttachmentsPanel.vue';
import AppIcon from './AppIcon.vue';
import NumField from './NumField.vue';
import RoomPreview from './RoomPreview.vue';
import ShortcutsHelp from './ShortcutsHelp.vue';
import type { EditorMode, Selection, WallType, WallTypePatch } from './editorTypes';

const props = defineProps<{
  room: Room;
  openings: Opening[];
  attachments: Attachment[];
  unit: LengthUnit;
  defaultThickness: number;
  defaultHeight: number;
  /** Usable free height under sloped ceilings (mm). */
  headroom?: number;
  /** The other rooms on this floor, to find the other side of a shared wall. */
  neighbours?: Room[];
  isNew: boolean;
  storage: StorageAdapter;
  /** The plan: files still used by one of its versions are kept. */
  projectId: string;
  view?: ViewSettings;
  initialMode?: EditorMode;
  initialPin?: string;
  accent?: string;
}>();
const emit = defineEmits<{
  /** `walls`: wall types also set on the other side of shared walls. */
  save: [room: Room, openings: Opening[], attachments: Attachment[], walls: WallTypePatch[]];
  cancel: [];
  delete: [];
}>();

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const draft = reactive(clone(props.room)) as Room;
const ops = ref<Opening[]>(clone(props.openings));
const atts = ref<Attachment[]>(clone(props.attachments));

draft.height_mm ??= props.defaultHeight;
const mode = ref<EditorMode>(props.initialMode ?? 'layout');
const modeTitle: Record<EditorMode, string> = {
  layout: '📐 Layout',
  notes: '👁 Notes & files',
  furniture: '🛋 Furniture',
  installations: '⚡ Installations',
};

// ---- the drawing: hidden, small or large (remembered) ----------------------------
type PlanSize = 'hidden' | 'small' | 'large';
const SIZE_KEY = 'fp.editorPlan';
function storedSize(): PlanSize {
  try {
    const v = localStorage.getItem(SIZE_KEY);
    if (v === 'hidden' || v === 'small' || v === 'large') return v;
  } catch {
    // storage unavailable
  }
  return window.matchMedia?.('(min-width: 900px)').matches ? 'large' : 'small';
}
const planSize = ref<PlanSize>(storedSize());
function setPlanSize(v: PlanSize) {
  planSize.value = v;
  try {
    localStorage.setItem(SIZE_KEY, v);
  } catch {
    // storage unavailable
  }
  if (v !== 'hidden') void nextTick(() => preview.value?.fitRoom(false));
}
const nextSize: Record<PlanSize, PlanSize> = { hidden: 'small', small: 'large', large: 'hidden' };
const sizeLabel: Record<PlanSize, string> = { hidden: '▾ Show plan', small: '▾ Larger', large: '▴ Hide plan' };

// ---- collapsible cards (layout) ---------------------------------------------------
type Card = 'room' | 'walls' | 'diagonals' | 'openings' | 'stairs' | 'fixed';
const open = reactive<Record<Card, boolean>>({
  room: props.isNew,
  walls: true,
  diagonals: props.room.diagonals.length > 0,
  openings: props.openings.length > 0,
  stairs: (props.room.stairs?.length ?? 0) > 0,
  fixed: (props.room.fixed?.length ?? 0) > 0,
});
const onToggle = (c: Card, e: Event) => (open[c] = (e.target as HTMLDetailsElement).open);
const sel = ref<Selection | null>(props.initialPin ? { kind: 'pin', id: props.initialPin } : null);
const placing = ref(false);
const showHelp = ref(false);
const preview = ref<InstanceType<typeof RoomPreview>>();
const perWallHeights = ref(draft.walls.some((w) => w.height_mm !== undefined));
const wallTypes = ref(draft.walls.some(hasWallType));
const sloped = ref(hasSlope(draft.walls));

const cardOf = (s: Selection): Card | null =>
  s.kind === 'wall' || s.kind === 'corner'
    ? 'walls'
    : s.kind === 'diagonal'
      ? 'diagonals'
      : s.kind === 'opening'
        ? 'openings'
        : s.kind === 'stair'
          ? 'stairs'
          : s.kind === 'fixed'
            ? 'fixed'
            : null;
watch(sel, (s) => {
  const c = s && cardOf(s);
  if (c) open[c] = true;
});

function setMode(m: EditorMode) {
  mode.value = m;
  sel.value = null;
  placing.value = false;
}

const previewRoom = computed<Room>(() => ({ ...draft, origin: { x: 0, y: 0 }, rotation_deg: 0 }));
const geom = computed(() => roomGeometry(previewRoom.value));
const solved = computed(() => geom.value.solved);
const n = computed(() => draft.walls.length);

const status = computed(() => {
  const s = solved.value;
  if (!s.closed) return { ok: false, text: s.warnings[0] ?? '' };
  const alike = s.measuredAngles === 0 || s.measuredAngles === n.value;
  const close = !alike
    ? 'Closed'
    : s.misclosure_mm < 1
      ? 'Closes exactly'
      : `Closed: the walls missed by ${Math.round(s.misclosure_mm)} mm before correction`;
  return { ok: s.warnings.length === 0, text: `${close} · ${s.area_m2.toFixed(2)} m²` };
});

const residualNote = (mm: number) =>
  Number.isFinite(mm) && Math.abs(mm) >= 5 ? `length fitted ${mm > 0 ? '+' : ''}${Math.round(mm)} mm` : '';

/** What the drawing actually uses at the end corner of wall i, when it differs from the field. */
function angleNote(i: number): string {
  const s = solved.value;
  if (!s.closed || Math.abs(s.angleResiduals_deg[i]) < 0.5) return '';
  const fitted = Math.round(interiorAngle(s.points, (i + 1) % n.value) * 10) / 10;
  return isAngleMeasured(draft.walls[i]) ? `angle fitted to ${fitted}°` : `guessed corner drawn at ${fitted}°`;
}

const rowNote = (i: number) => [residualNote(solved.value.wallResiduals_mm[i]), angleNote(i)].filter(Boolean).join(' · ');

// ---- selection <-> form -------------------------------------------------------

const isActive = (kind: Selection['kind'], key: number | string) => {
  const s = sel.value;
  if (!s || s.kind !== kind) return false;
  return 'index' in s ? s.index === key : s.id === key;
};
const wallRowActive = (i: number) => isActive('wall', i) || isActive('corner', (i + 1) % n.value);

function fieldFor(s: Selection): string {
  switch (s.kind) {
    case 'wall':
      return `[data-len="${s.index}"]`;
    case 'corner':
      return `[data-angle="${(s.index - 1 + n.value) % n.value}"]`;
    case 'diagonal':
      return `[data-diag="${s.index}"]`;
    case 'opening':
      return `[data-op="${s.id}"]`;
    case 'furniture':
      return `[data-furn="${s.id}"]`;
    case 'pin':
      return `[data-pin-title="${s.id}"]`;
    case 'stair':
      return `[data-stair-name="${s.id}"]`;
    case 'fixed':
      return `[data-fixed-name="${s.id}"]`;
  }
}

/** From the drawing. A tap focuses the field (opening the keyboard); a furniture drag only scrolls to it. */
async function onPreviewSelect(s: Selection | null, tapped: boolean) {
  sel.value = s;
  if (!s) return;
  await nextTick(); // its card may have just opened
  const el = document.querySelector<HTMLElement>(fieldFor(s));
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  if (tapped && s.kind !== 'furniture' && s.kind !== 'stair' && s.kind !== 'fixed') el.focus({ preventScroll: true });
}

// ---- room levels ----------------------------------------------------------------

function togglePerWallHeights(on: boolean) {
  perWallHeights.value = on;
  if (!on) for (const w of draft.walls) delete w.height_mm;
}

function toggleSloped(on: boolean) {
  sloped.value = on;
  if (on) perWallHeights.value = true;
  else for (const w of draft.walls) delete w.slope_deg;
}

/** A slope needs a wall lower than the room: start with a 1 m knee wall. */
function setWallSlope(i: number, deg: number) {
  const w = draft.walls[i];
  if (!(deg > 0 && deg < 90)) {
    delete w.slope_deg;
    return;
  }
  w.slope_deg = deg;
  if (w.height_mm === undefined) w.height_mm = Math.min(1000, draft.height_mm ?? 1000);
}

/** "14.40 m² with 1.80 m headroom", for a room with sloped ceilings. */
const headroomNote = computed(() => {
  if (!solved.value.closed || !hasSlope(draft.walls)) return '';
  const planes = ceilingPlanes(solved.value.points, draft.walls, draft.height_mm ?? props.defaultHeight);
  const h = props.headroom ?? HEADROOM_MM;
  return `${headroomArea_m2(solved.value.points, planes, h).toFixed(2)} m² of ${solved.value.area_m2.toFixed(2)} m² has ${(h / 1000).toFixed(2)} m headroom or more`;
});

// ---- finishes -----------------------------------------------------------------------

/** The floor select: a covering id, "custom" for free text, or "" for none. */
const floorChoice = computed(() => {
  const f = draft.finish?.floor;
  if (!f) return '';
  return floorCovering(f) ? f : 'custom';
});
const customFloor = ref(floorChoice.value === 'custom');

function setFinish<K extends keyof NonNullable<Room['finish']>>(key: K, value: NonNullable<Room['finish']>[K] | undefined) {
  const f = (draft.finish ??= {});
  if (value === undefined || value === '') delete f[key];
  else f[key] = value;
  if (!Object.keys(f).length) delete draft.finish;
}

function chooseFloor(v: string) {
  customFloor.value = v === 'custom';
  if (v !== 'custom') setFinish('floor', v || undefined);
  else if (floorCovering(draft.finish?.floor)) setFinish('floor', undefined); // keep free text already typed
}

const finishSummary = computed(() => {
  const f = draft.finish?.floor;
  return f ? (floorCovering(f)?.label ?? f) : '';
});

function setWallHeight(i: number, mm: number) {
  const w = draft.walls[i];
  if (!mm || mm === draft.height_mm) delete w.height_mm;
  else w.height_mm = mm;
}

// ---- wall types ------------------------------------------------------------------


function setWallType(w: Wall, t: WallType) {
  if (t.kind === 'exterior') w.kind = 'exterior';
  else delete w.kind;
  if (t.loadBearing) w.loadBearing = true;
  else delete w.loadBearing;
  if (t.status && t.status !== 'existing') w.status = t.status;
  else delete w.status;
}

const typeOf = (w: WallType): Required<WallType> => ({ kind: w.kind ?? 'interior', loadBearing: !!w.loadBearing, status: w.status ?? 'existing' });
const sameType = (a: WallType, b: WallType) => JSON.stringify(typeOf(a)) === JSON.stringify(typeOf(b));

function toggleWallTypes(on: boolean) {
  wallTypes.value = on;
  if (!on) for (const w of draft.walls) setWallType(w, {});
}

function changeWallType(i: number, change: WallType) {
  setWallType(draft.walls[i], { ...typeOf(draft.walls[i]), ...change });
}

/** Wall types set on the neighbours' walls while editing, kept until Save. */
const patches = ref<WallTypePatch[]>([]);
const neighbourType = (roomId: string, k: number): WallType =>
  patches.value.find((p) => p.roomId === roomId && p.wallIndex === k) ?? props.neighbours?.find((r) => r.id === roomId)?.walls[k] ?? {};

/** For each wall: the other room's wall on the same line, if any, and whether its type differs. */
const sharedWalls = computed(() => {
  const others = (props.neighbours ?? []).map(roomGeometry);
  const geoms = [roomGeometry(draft), ...others];
  return draft.walls.map((w, k) => {
    const m = matchingWalls(geoms, draft.id, k)[0];
    if (!m) return null;
    const room = props.neighbours?.find((r) => r.id === m.roomId);
    return room ? { ...m, name: room.name, differs: !sameType(w, neighbourType(m.roomId, m.wallIndex)) } : null;
  });
});

function copyToNeighbour(i: number) {
  const m = sharedWalls.value[i];
  if (!m) return;
  patches.value = patches.value
    .filter((p) => !(p.roomId === m.roomId && p.wallIndex === m.wallIndex))
    .concat({ roomId: m.roomId, wallIndex: m.wallIndex, ...typeOf(draft.walls[i]) });
}

// ---- stairs & slopes --------------------------------------------------------------

function addStair(kind: Stair['kind']) {
  const c = solved.value.closed ? centroid(solved.value.points) : { x: 1500, y: 1000 };
  const s = newStair(kind, Math.round(c.x), Math.round(c.y));
  if (kind === 'stairs') s.rise_mm = draft.height_mm ?? props.defaultHeight;
  (draft.stairs ??= []).push(s);
  sel.value = { kind: 'stair', id: s.id };
}

function moveStair(id: string, x: number, y: number) {
  const s = draft.stairs?.find((item) => item.id === id);
  if (!s) return;
  s.x_mm = Math.round(x);
  s.y_mm = Math.round(y);
}

function removeStair(id: string) {
  draft.stairs = (draft.stairs ?? []).filter((s) => s.id !== id);
  if (isActive('stair', id)) sel.value = null;
}

// ---- chimneys, columns, ducts --------------------------------------------------------

const fixedKind = ref<FixedKind>('chimney');

function addFixed() {
  const c = solved.value.closed ? centroid(solved.value.points) : { x: 1500, y: 1000 };
  const f = newFixed(fixedKind.value, Math.round(c.x), Math.round(c.y));
  (draft.fixed ??= []).push(f);
  sel.value = { kind: 'fixed', id: f.id };
}

function moveFixed(id: string, x: number, y: number) {
  const f = draft.fixed?.find((item) => item.id === id);
  if (!f) return;
  f.x_mm = Math.round(x);
  f.y_mm = Math.round(y);
}

function removeFixed(id: string) {
  draft.fixed = (draft.fixed ?? []).filter((f) => f.id !== id);
  if (isActive('fixed', id)) sel.value = null;
}

const slopeText = (s: Stair) =>
  s.length_mm > 0 ? `${((s.rise_mm / s.length_mm) * 100).toFixed(1)} % · ${((Math.atan2(s.rise_mm, s.length_mm) * 180) / Math.PI).toFixed(1)}°` : '';
/** Ticked: set the flag; unticked: leave it out of the file. */
function setStairFlag(s: Stair, key: 'down' | 'solid', e: Event) {
  if ((e.target as HTMLInputElement).checked) s[key] = true;
  else delete s[key];
}

/** Angle field emptied: back to the 90° guess, which the solver may adjust. */
function resetAngle(w: Wall) {
  w.angle_deg = 90;
  w.angle_measured = false;
}

const stepText = (s: Stair) =>
  s.steps > 0 ? `each step ${formatLength(s.rise_mm / s.steps, 'cm')} cm high, ${formatLength(s.length_mm / s.steps, 'cm')} cm deep` : '';

// ---- note dots --------------------------------------------------------------------

const pinIds = computed(() => new Set((draft.pins ?? []).map((p) => p.id)));
const roomFiles = computed(() => atts.value.filter((a) => !a.linkedTo.some((id) => pinIds.value.has(id))));
const pinFiles = (pinId: string) => atts.value.filter((a) => a.linkedTo.includes(pinId));
const selectedPinId = computed(() => (sel.value?.kind === 'pin' ? sel.value.id : null));

function startPlacing() {
  placing.value = !placing.value;
}

async function placePin(x: number, y: number) {
  const p = newPin(x, y);
  (draft.pins ??= []).push(p);
  placing.value = false;
  sel.value = { kind: 'pin', id: p.id };
  await nextTick();
  document.querySelector<HTMLElement>(`[data-pin-title="${p.id}"]`)?.focus();
}

function movePin(id: string, x: number, y: number) {
  const p = draft.pins?.find((item) => item.id === id);
  if (!p) return;
  p.x_mm = Math.round(x);
  p.y_mm = Math.round(y);
}

function removePin(id: string) {
  const files = pinFiles(id).length;
  if (!confirm(`Delete this note${files ? ` and its ${files} photo${files === 1 ? '' : 's'}/file${files === 1 ? '' : 's'}` : ''}?`)) return;
  draft.pins = (draft.pins ?? []).filter((p) => p.id !== id);
  atts.value = atts.value.filter((a) => !a.linkedTo.includes(id));
  if (isActive('pin', id)) sel.value = null;
}

// ---- walls ----------------------------------------------------------------

function addWall() {
  const last = draft.walls[draft.walls.length - 1];
  draft.walls.push(newWall(0, last?.thickness_mm ?? props.defaultThickness));
}

function removeWall(i: number) {
  if (draft.walls.length <= 3) return;
  draft.walls.splice(i, 1);
  const count = draft.walls.length;
  draft.diagonals = draft.diagonals.filter((d) => d.from < count && d.to < count);
  ops.value = ops.value
    .filter((o) => o.wallIndex !== i)
    .map((o) => (o.wallIndex > i ? { ...o, wallIndex: o.wallIndex - 1 } : o));
  sel.value = null;
}

/** Splits wall i with a straight corner, so each part can get its own type. */
function splitAt(i: number) {
  const w = draft.walls[i];
  if (!w || !(w.length_mm > 0)) return;
  const text = prompt(
    `Split W${i + 1} (${formatLength(w.length_mm, props.unit)} ${props.unit}): distance from C${i + 1} to the new corner, in ${props.unit}`,
    formatLength(w.length_mm / 2, props.unit),
  );
  if (text === null) return;
  const at = parseLength(text, props.unit);
  // A focused length field keeps showing what was typed: let it show the new length.
  (document.activeElement as HTMLElement | null)?.blur();
  const next = Number.isFinite(at) ? splitWall(draft, ops.value, i, at) : null;
  if (!next) {
    alert(`That is not inside W${i + 1}: give a distance between 0 and ${formatLength(w.length_mm, props.unit)} ${props.unit}.`);
    return;
  }
  ops.value = next;
  sel.value = { kind: 'wall', index: i + 1 };
}

/** Joins the two walls at straight corner c back into one. */
function joinAt(c: number) {
  (document.activeElement as HTMLElement | null)?.blur();
  const next = removeCorner(draft, ops.value, c);
  if (!next) return;
  ops.value = next;
  sel.value = { kind: 'wall', index: c - 1 };
}

function copyOpposite() {
  if (draft.walls.length !== 4) return;
  draft.walls[2].length_mm = draft.walls[0].length_mm;
  draft.walls[3].length_mm = draft.walls[1].length_mm;
}

async function nextLength(i: number) {
  const find = (k: number) => document.querySelector<HTMLInputElement>(`[data-len="${k}"]`);
  if (!find(i + 1)) {
    addWall();
    await nextTick();
  }
  find(i + 1)?.focus();
}

function setAllThickness(mm: number) {
  for (const w of draft.walls) w.thickness_mm = mm;
}

// ---- diagonals ------------------------------------------------------------

async function addDiagonal() {
  draft.diagonals.push({ id: uid(), from: 0, to: Math.min(2, n.value - 1), length_mm: 0 });
  sel.value = { kind: 'diagonal', index: draft.diagonals.length - 1 };
  await nextTick();
  document.querySelector<HTMLElement>(`[data-diag="${draft.diagonals.length - 1}"]`)?.focus();
}

// ---- openings ---------------------------------------------------------------

function addOpening(type: OpeningType) {
  const wallIndex = sel.value?.kind === 'wall' ? sel.value.index : 0;
  const op = newOpening(draft.id, type, wallIndex);
  ops.value.push(op);
  sel.value = { kind: 'opening', id: op.id };
}

function moveOpening(id: string, wallIndex: number, offset_mm: number) {
  const op = ops.value.find((o) => o.id === id);
  if (!op) return;
  op.wallIndex = wallIndex;
  op.offset_mm = offset_mm;
}

/** Measure from the other corner, keeping the opening where it is. */
function setFrom(op: Opening, from: 'start' | 'end') {
  if ((op.from ?? 'start') === from) return;
  const L = geom.value.solved.closed ? wallLength(geom.value, op.wallIndex) : wallLen(op.wallIndex);
  const span = holeSpan(op, L);
  op.offset_mm = Math.max(0, Math.round(from === 'end' ? L - span.b : span.a));
  op.from = from === 'end' ? 'end' : undefined;
}

const fits = (op: Opening) => openingGeometry(geom.value, op, [geom.value])?.fits ?? true;
const wallLen = (k: number) => draft.walls[k]?.length_mm ?? 0;

// ---- furniture --------------------------------------------------------------

const presetKind = ref(FURNITURE_PRESETS[0].kind);

function addFurniture() {
  const preset = FURNITURE_PRESETS.find((p) => p.kind === presetKind.value) ?? FURNITURE_PRESETS[0];
  const at = solved.value.closed ? centroid(solved.value.points) : { x: 1000, y: 1000 };
  const f = newFurniture(preset, at);
  (draft.furniture ??= []).push(f);
  sel.value = { kind: 'furniture', id: f.id };
}

function moveFurniture(id: string, x: number, y: number) {
  const f = draft.furniture?.find((item) => item.id === id);
  if (!f) return;
  f.x_mm = Math.round(x);
  f.y_mm = Math.round(y);
}

function removeFurniture(id: string) {
  draft.furniture = (draft.furniture ?? []).filter((f) => f.id !== id);
  if (isActive('furniture', id)) sel.value = null;
}

// ---- copy, paste, groups and order ---------------------------------------------------

const wallLenNow = (k: number) => (geom.value.solved.closed ? wallLength(geom.value, k) : wallLen(k));
const furnitureList = () => (draft.furniture ??= []);
const groupList = computed(() => groupNames(draft.furniture ?? []));
const groupCount = (name: string) => (draft.furniture ?? []).filter((f) => f.group === name).length;
const copied = ref('');
let copiedTimer = 0;
function note(text: string) {
  copied.value = text;
  clearTimeout(copiedTimer);
  copiedTimer = window.setTimeout(() => (copied.value = ''), 1800);
}

/** Copies of furniture, 30 cm further on when the originals are in this room. */
function addFurnitureCopies(items: Furniture[]): Furniture[] {
  const list = furnitureList();
  const here = items.some((i) => list.some((f) => f.id === i.id));
  const pasted = pasteFurniture(list, items, here ? { x: 300, y: 300 } : { x: 0, y: 0 });
  list.push(...pasted);
  if (mode.value !== 'furniture') setMode('furniture');
  sel.value = { kind: 'furniture', id: pasted[0].id };
  return pasted;
}

function duplicateOpening(op: Opening) {
  const copy = pasteOpening(op, draft.id, op.wallIndex, wallLenNow(op.wallIndex), ops.value);
  ops.value.splice(ops.value.indexOf(op) + 1, 0, copy);
  sel.value = { kind: 'opening', id: copy.id };
}

function copySelected(): boolean {
  const s = sel.value;
  if (s?.kind === 'furniture') {
    const f = draft.furniture?.find((x) => x.id === s.id);
    if (!f) return false;
    copyToClipboard({ kind: 'furniture', items: [f] });
    note(`Copied ${f.name}`);
    return true;
  }
  if (s?.kind === 'opening') {
    const op = ops.value.find((o) => o.id === s.id);
    if (!op) return false;
    copyToClipboard({ kind: 'opening', items: [op] });
    note(`Copied the ${op.type}`);
    return true;
  }
  return false;
}

function copyGroup(name: string) {
  copyToClipboard({ kind: 'furniture', items: (draft.furniture ?? []).filter((f) => f.group === name) });
  note(`Copied the group ${name}`);
}

/** Pastes what was copied, here or in another room. A door goes on the selected wall. */
function paste(): boolean {
  const c = clipboard();
  if (!c?.items.length) return false;
  if (c.kind === 'furniture') {
    // The next paste lands a step further on.
    copyToClipboard({ kind: 'furniture', items: addFurnitureCopies(c.items) });
    return true;
  }
  if (c.kind !== 'opening' || n.value === 0) return false;
  const s = sel.value;
  const wall = s?.kind === 'wall' ? s.index : Math.min(c.items[0].wallIndex, n.value - 1);
  const copy = pasteOpening(c.items[0], draft.id, wall, wallLenNow(wall), ops.value);
  ops.value.push(copy);
  copyToClipboard({ kind: 'opening', items: [copy] });
  if (mode.value !== 'layout') setMode('layout');
  sel.value = { kind: 'opening', id: copy.id };
  return true;
}

function duplicateSelected(): boolean {
  const s = sel.value;
  if (s?.kind === 'furniture') {
    const f = draft.furniture?.find((x) => x.id === s.id);
    if (f) addFurnitureCopies([f]);
    return !!f;
  }
  if (s?.kind === 'opening') {
    const op = ops.value.find((o) => o.id === s.id);
    if (op) duplicateOpening(op);
    return !!op;
  }
  return false;
}

function setGroup(f: Furniture, name: string) {
  const g = name.trim();
  if (g) f.group = g;
  else delete f.group;
}

function ungroup(name: string) {
  for (const f of draft.furniture ?? []) if (f.group === name) delete f.group;
}

function turnGroupOf(f: Furniture) {
  turnGroup(groupOf(draft.furniture ?? [], f), 90);
}

// ---- notes & files ------------------------------------------------------------

const originalFileIds = new Set(props.attachments.map((a) => fileIdOf(a.uri)).filter((x): x is string => !!x));
const currentFileIds = () => new Set(atts.value.map((a) => fileIdOf(a.uri)).filter((x): x is string => !!x));

function save() {
  // Files removed while editing are deleted now that the change is kept.
  const keep = currentFileIds();
  void deleteUnusedFiles(props.storage, props.projectId, [...originalFileIds].filter((id) => !keep.has(id)));
  leave();
  emit('save', clone(draft), clone(ops.value), clone(atts.value), clone(patches.value));
}

function cancel() {
  // Files added while editing are thrown away with the rest of the changes.
  void props.storage.deleteFiles([...currentFileIds()].filter((id) => !originalFileIds.has(id)));
  leave();
  emit('cancel');
}

// ---- leaving with unsaved changes ----------------------------------------------

/** Asking whether to save, discard or keep editing. */
const askLeave = ref(false);
let left = false;

/** Cancel, Escape and the back button: close, or ask first when something changed. */
function requestClose() {
  if (changed()) askLeave.value = true;
  else cancel();
}

/**
 * The editor has its own history entry, so the phone's back button closes it
 * (and asks first) instead of leaving the plan.
 */
const MARK = 'floorplanRoomEditor';
function onPopState() {
  if (left) return;
  if (changed()) {
    history.pushState({ [MARK]: true }, '');
    askLeave.value = true;
  } else {
    left = true;
    cancel();
  }
}

/** Drops the editor's history entry when it closes some other way. */
function leave() {
  if (left) return;
  left = true;
  removeEventListener('popstate', onPopState);
  if ((history.state as Record<string, unknown> | null)?.[MARK]) history.back();
}

/** Closing or reloading the tab. */
function onBeforeUnload(e: BeforeUnloadEvent) {
  if (!left && changed()) e.preventDefault();
}

onMounted(() => {
  history.pushState({ [MARK]: true }, '');
  addEventListener('popstate', onPopState);
  addEventListener('beforeunload', onBeforeUnload);
});
onBeforeUnmount(() => {
  leave(); // e.g. the room was deleted
  removeEventListener('beforeunload', onBeforeUnload);
});

// ---- undo / redo (this editing session only) ---------------------------------------

const edits = useEditHistory(
  () => JSON.stringify([draft, ops.value, patches.value]),
  (s) => {
    const [d, o, p] = JSON.parse(s) as [Room, Opening[], WallTypePatch[]];
    const target = draft as unknown as Record<string, unknown>;
    for (const k of Object.keys(target)) if (!(k in d)) delete target[k];
    Object.assign(draft, d);
    ops.value = o;
    patches.value = p;
    if (!selectionExists()) sel.value = null;
  },
);
watch(() => [draft, ops.value, patches.value], edits.changed, { deep: true });

/** A drag is one step: nothing is recorded while the mouse or a finger is down. */
const pressDown = () => edits.hold(true);
const pressUp = () => edits.hold(false);
onMounted(() => {
  addEventListener('pointerdown', pressDown, { capture: true });
  addEventListener('pointerup', pressUp, { capture: true });
  addEventListener('pointercancel', pressUp, { capture: true });
});
onBeforeUnmount(() => {
  edits.dispose();
  removeEventListener('pointerdown', pressDown, { capture: true });
  removeEventListener('pointerup', pressUp, { capture: true });
  removeEventListener('pointercancel', pressUp, { capture: true });
});

/** After an undo, the selected thing may not be there any more. */
function selectionExists(): boolean {
  const s = sel.value;
  if (!s) return true;
  switch (s.kind) {
    case 'wall':
    case 'corner':
      return s.index < draft.walls.length;
    case 'diagonal':
      return s.index < draft.diagonals.length;
    case 'opening':
      return ops.value.some((o) => o.id === s.id);
    case 'furniture':
      return !!draft.furniture?.some((f) => f.id === s.id);
    case 'pin':
      return !!draft.pins?.some((p) => p.id === s.id);
    case 'stair':
      return !!draft.stairs?.some((x) => x.id === s.id);
    case 'fixed':
      return !!draft.fixed?.some((x) => x.id === s.id);
  }
}

// ---- keyboard -----------------------------------------------------------------

const startState = JSON.stringify([draft, ops.value, atts.value]);
const changed = () => JSON.stringify([draft, ops.value, atts.value]) !== startState;

function nudgeSelected(dx: number, dy: number): boolean {
  const s = sel.value;
  if (s?.kind === 'furniture') {
    const f = draft.furniture?.find((x) => x.id === s.id);
    if (!f) return false;
    for (const m of groupOf(draft.furniture ?? [], f)) {
      m.x_mm += dx;
      m.y_mm += dy;
    }
    return true;
  }
  const item =
    s?.kind === 'pin'
      ? draft.pins?.find((p) => p.id === s.id)
      : s?.kind === 'stair'
        ? draft.stairs?.find((x) => x.id === s.id)
        : s?.kind === 'fixed'
          ? draft.fixed?.find((x) => x.id === s.id)
          : undefined;
  if (!item) return false;
  item.x_mm += dx;
  item.y_mm += dy;
  return true;
}

function removeSelected(): boolean {
  const s = sel.value;
  if (!s) return false;
  if (s.kind === 'furniture') removeFurniture(s.id);
  else if (s.kind === 'pin') removePin(s.id);
  else if (s.kind === 'stair') removeStair(s.id);
  else if (s.kind === 'fixed') removeFixed(s.id);
  else if (s.kind === 'opening') ops.value = ops.value.filter((o) => o.id !== s.id);
  else if (s.kind === 'diagonal') draft.diagonals.splice(s.index, 1);
  else return false;
  if (s.kind === 'opening' || s.kind === 'diagonal') sel.value = null;
  return true;
}

useKeydown((e) => {
  if (askLeave.value) {
    if (e.key === 'Escape') {
      askLeave.value = false;
      e.preventDefault();
    }
    return;
  }
  if (showHelp.value) {
    if (e.key === 'Escape' || e.key === '?') {
      showHelp.value = false;
      e.preventDefault();
    }
    return;
  }
  if (ctrlOrCmd(e) && (e.key === 's' || e.key === 'Enter')) {
    e.preventDefault();
    save();
    return;
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    if (isTyping(e)) (e.target as HTMLElement).blur();
    else if (placing.value) placing.value = false;
    else if (sel.value) sel.value = null;
    else requestClose();
    return;
  }
  if (!isTyping(e) && ctrlOrCmd(e) && !e.altKey) {
    const k = e.key.toLowerCase();
    if (k === 'z' || k === 'y') {
      e.preventDefault();
      if (k === 'z' && !e.shiftKey) edits.undo();
      else edits.redo();
      return;
    }
  }
  if (!isTyping(e) && ctrlOrCmd(e) && !e.altKey && !e.shiftKey) {
    const k = e.key.toLowerCase();
    const done = k === 'c' ? copySelected() : k === 'v' ? paste() : k === 'd' ? duplicateSelected() : false;
    if (done) e.preventDefault();
    if (k === 'c' || k === 'v' || k === 'd') return;
  }
  if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
  const step = e.shiftKey ? 100 : 10;
  const arrows: Record<string, [number, number]> = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step],
  };
  let handled = true;
  if (arrows[e.key]) handled = nudgeSelected(...arrows[e.key]);
  else if (e.key === 'Delete' || e.key === 'Backspace') handled = removeSelected();
  else if (e.key === '?') showHelp.value = true;
  else if (e.key === '+' || e.key === '=') preview.value?.zoomIn();
  else if (e.key === '-' || e.key === '_') preview.value?.zoomOut();
  else if (e.key === 'f' || e.key === '0') preview.value?.fitRoom();
  else if (e.key === 'v') preview.value?.toggleView();
  else if (e.key === 'p') setPlanSize(nextSize[planSize.value]);
  else if (e.key === 'n' && mode.value === 'notes') startPlacing();
  else if (e.key === 'n' && mode.value === 'furniture') addFurniture();
  else if (e.key === 'r' && sel.value?.kind === 'furniture') {
    const id = sel.value.id;
    const f = draft.furniture?.find((x) => x.id === id);
    if (f) f.rotation_deg = normDeg(f.rotation_deg + 90);
  } else if (e.key === 'r' && sel.value?.kind === 'fixed') {
    const id = sel.value.id;
    const f = draft.fixed?.find((x) => x.id === id);
    if (f) f.rotation_deg = normDeg(f.rotation_deg + 90);
  } else if (e.key === 'r' && sel.value?.kind === 'stair') {
    const id = sel.value.id;
    const s = draft.stairs?.find((x) => x.id === id);
    if (s) s.rotation_deg = normDeg(s.rotation_deg + 90);
  } else handled = false;
  if (handled) e.preventDefault();
});
</script>

<template>
  <div class="sheet editor" :style="accent ? { '--plan-accent': accent } : undefined">
    <header class="topbar">
      <button class="btn ghost" @click="requestClose">Cancel</button>
      <input v-model="draft.name" class="title-input" aria-label="Room name" />
      <span class="mode-chip" :title="`Editing: ${modeTitle[mode]}`">{{ modeTitle[mode] }}</span>
      <button class="btn ghost" aria-label="Undo (Ctrl+Z)" title="Undo (Ctrl+Z)" :disabled="!edits.canUndo.value" @click="edits.undo()">↶</button>
      <button class="btn ghost" aria-label="Redo (Ctrl+Y)" title="Redo (Ctrl+Y)" :disabled="!edits.canRedo.value" @click="edits.redo()">↷</button>
      <button class="btn ghost kbd-only" aria-label="Keyboard shortcuts (?)" title="Keyboard shortcuts (?)" @click="showHelp = true">⌨</button>
      <button class="btn primary" title="Save (Ctrl+S)" @click="save">Save</button>
    </header>
    <ShortcutsHelp v-if="showHelp" context="room" @close="showHelp = false" />
    <div v-if="askLeave" class="backdrop" @click.self="askLeave = false">
      <div class="dialog leave-dialog" role="alertdialog" aria-labelledby="leave-title">
        <h2 id="leave-title">Save the changes to {{ draft.name || 'this room' }}?</h2>
        <p>You changed this room. If you leave without saving, the changes are lost.</p>
        <div class="row-actions end">
          <button class="btn" @click="askLeave = false">Keep editing</button>
          <button class="btn danger" @click="cancel">Discard</button>
          <button class="btn primary" @click="save">Save</button>
        </div>
      </div>
    </div>

    <div class="editor-main" :class="`plan-${planSize}`">
      <div v-show="planSize !== 'hidden'" class="preview">
        <RoomPreview
          ref="preview"
          :room="previewRoom"
          :openings="ops"
          :unit="unit"
          :mode="mode"
          :selection="sel"
          :view="view"
          :headroom="headroom"
          :placing="placing"
          :accent="accent"
          @select="onPreviewSelect"
          @move-furniture="moveFurniture"
          @move-pin="movePin"
          @move-stair="moveStair"
          @move-fixed="moveFixed"
          @move-opening="moveOpening"
          @place="placePin"
        />
      </div>
      <div class="plan-strip">
        <p class="status" :class="{ ok: status.ok }">{{ copied || status.text }}</p>
        <button class="btn small" title="Hide or resize the plan (P)" @click="setPlanSize(nextSize[planSize])">
          {{ sizeLabel[planSize] }}
        </button>
      </div>

      <div class="editor-body">
      <!-- ================= LAYOUT ================= -->
      <template v-if="mode === 'layout'">
        <p v-for="w in solved.warnings.slice(solved.closed ? 0 : 1)" :key="w" class="warn">{{ w }}</p>

        <details class="card" :open="open.room" @toggle="onToggle('room', $event)">
          <summary><h2>Room</h2><small>{{ formatLength(draft.height_mm ?? 0, unit) }} {{ unit }} high{{ draft.floorLevel_mm ? ` · floor ${formatLength(draft.floorLevel_mm, unit)} ${unit}` : '' }}{{ finishSummary ? ` · ${finishSummary}` : '' }}</small></summary>
          <div class="row-actions">
            <NumField v-model="draft.height_mm!" :kind="unit" :label="`Wall height (${unit})`" />
            <NumField
              :model-value="draft.floorLevel_mm ?? 0"
              :kind="unit"
              :label="`Floor level (${unit})`"
              placeholder="0"
              @update:model-value="(v: number) => (draft.floorLevel_mm = v || undefined)"
            />
          </div>
          <p class="hint">
            Floor level is relative to this floor, e.g. −0.20 m for a room 20 cm lower (type a minus sign).
          </p>
          <label class="check">
            <input type="checkbox" :checked="perWallHeights" @change="togglePerWallHeights(($event.target as HTMLInputElement).checked)" />
            <span>Some walls have a different height</span>
          </label>
          <label class="check">
            <input type="checkbox" :checked="sloped" @change="toggleSloped(($event.target as HTMLInputElement).checked)" />
            <span>Sloped ceilings (attic)</span>
          </label>
          <label class="check">
            <input type="checkbox" :checked="wallTypes" @change="toggleWallTypes(($event.target as HTMLInputElement).checked)" />
            <span>Wall types (exterior, load-bearing, new, to demolish)</span>
          </label>
          <p v-if="sloped" class="hint">
            Under Walls, give each wall under the roof its own height (the low wall where the slope starts) and the
            roof pitch in degrees. The ceiling rises from there up to the wall height above, which is then the flat
            ceiling or higher than the ridge.
            <strong v-if="headroomNote"><br />{{ headroomNote }}.</strong>
          </p>
          <h3 class="card-sub">Finishes</h3>
          <div class="row-actions finishes">
            <label class="field">
              <span class="field-label">Floor covering</span>
              <select :value="customFloor ? 'custom' : floorChoice" @change="chooseFloor(($event.target as HTMLSelectElement).value)">
                <option value="">– not set –</option>
                <option v-for="c in FLOOR_COVERINGS" :key="c.id" :value="c.id">{{ c.label }}</option>
                <option value="custom">Something else…</option>
              </select>
            </label>
            <label v-if="customFloor" class="field">
              <span class="field-label">Floor (describe)</span>
              <input :value="draft.finish?.floor ?? ''" placeholder="e.g. natural stone" @change="setFinish('floor', ($event.target as HTMLInputElement).value.trim() || undefined)" />
            </label>
            <label class="field">
              <span class="field-label">Walls</span>
              <input :value="draft.finish?.walls ?? ''" placeholder="e.g. paint white, tiles to 1.2 m" @change="setFinish('walls', ($event.target as HTMLInputElement).value.trim() || undefined)" />
            </label>
            <label class="field">
              <span class="field-label">Ceiling</span>
              <input :value="draft.finish?.ceiling ?? ''" placeholder="e.g. plaster, paint" @change="setFinish('ceiling', ($event.target as HTMLInputElement).value.trim() || undefined)" />
            </label>
          </div>
          <label class="check">
            <input type="checkbox" :checked="draft.finish?.skirting !== false" @change="setFinish('skirting', ($event.target as HTMLInputElement).checked ? undefined : false)" />
            <span>Skirting boards</span>
          </label>
        </details>

        <details class="card" :open="open.walls" @toggle="onToggle('walls', $event)">
          <summary><h2>Walls</h2><small>{{ n }} walls</small></summary>
          <p class="hint">
            Measure the inside faces, going clockwise from corner C1. Corners you leave alone are a 90° guess that
            adjusts to fit. Type an angle to fix it; a corner that sticks into the room is 270°. Where one wall
            changes type halfway (interior to exterior, another thickness), select it and split it: that adds a
            straight 180° corner.
          </p>
          <div
            v-for="(w, i) in draft.walls"
            :key="w.id"
            class="wall-row"
            :class="{ active: wallRowActive(i), heights: perWallHeights && !sloped, slopes: sloped }"
            @focusin="sel = { kind: 'wall', index: i }"
          >
            <div class="wall-tag">
              W{{ i + 1 }}
              <small>C{{ i + 1 }}→C{{ ((i + 1) % n) + 1 }}</small>
            </div>
            <NumField
              v-model="w.length_mm"
              :kind="unit"
              :label="`Length (${unit})`"
              :data-len="i"
              enterkeyhint="next"
              @keydown.enter.prevent="nextLength(i)"
            />
            <NumField
              v-model="w.angle_deg"
              kind="deg"
              :class="{ guessed: !isAngleMeasured(w) }"
              :label="`Angle at C${((i + 1) % n) + 1}${isAngleMeasured(w) ? '' : ' (guess)'}`"
              :data-angle="i"
              clearable
              title="Leave empty to go back to the 90° guess"
              @focusin.stop="sel = { kind: 'corner', index: (i + 1) % n }"
              @update:model-value="w.angle_measured = true"
              @clear="resetAngle(w)"
            />
            <NumField v-model="w.thickness_mm" kind="cm" label="Wall (cm)" />
            <NumField
              v-if="perWallHeights && !sloped"
              :model-value="w.height_mm ?? draft.height_mm ?? 0"
              :kind="unit"
              :class="{ guessed: w.height_mm === undefined }"
              label="Height"
              @update:model-value="(v: number) => setWallHeight(i, v)"
            />
            <button class="btn icon" :disabled="n <= 3" aria-label="Remove wall" @click="removeWall(i)">✕</button>
            <div v-if="sloped" class="wall-extra">
              <NumField
                :model-value="w.height_mm ?? draft.height_mm ?? 0"
                :kind="unit"
                :class="{ guessed: w.height_mm === undefined }"
                :label="`Wall height (${unit})`"
                @update:model-value="(v: number) => setWallHeight(i, v)"
              />
              <NumField
                :model-value="w.slope_deg ?? 0"
                kind="deg"
                :class="{ guessed: !w.slope_deg }"
                label="Ceiling slope (°, 0 = none)"
                placeholder="none"
                @update:model-value="(v: number) => setWallSlope(i, v)"
              />
            </div>
            <div v-if="wallTypes" class="wall-types">
              <label class="field">
                <span class="field-label">Kind</span>
                <select :value="w.kind ?? 'interior'" @change="changeWallType(i, { kind: ($event.target as HTMLSelectElement).value as WallKind })">
                  <option value="interior">Interior</option>
                  <option value="exterior">Exterior</option>
                </select>
              </label>
              <label class="field">
                <span class="field-label">Status</span>
                <select :value="w.status ?? 'existing'" @change="changeWallType(i, { status: ($event.target as HTMLSelectElement).value as WallStatus })">
                  <option value="existing">Existing</option>
                  <option value="new">New</option>
                  <option value="demolish">To demolish</option>
                </select>
              </label>
              <label class="check">
                <input type="checkbox" :checked="!!w.loadBearing" @change="changeWallType(i, { loadBearing: ($event.target as HTMLInputElement).checked })" />
                <span>Load-bearing</span>
              </label>
              <span v-if="sharedWalls[i]?.differs" class="also">
                Shared with {{ sharedWalls[i]!.name }}:
                <button class="btn small" @click="copyToNeighbour(i)">Also set on the wall of {{ sharedWalls[i]!.name }}</button>
              </span>
            </div>
            <small v-if="rowNote(i)" class="residual">{{ rowNote(i) }}</small>
            <div v-if="wallRowActive(i)" class="wall-actions">
              <button class="btn small" :disabled="!(w.length_mm > 0)" @click="splitAt(i)">✂ Split W{{ i + 1 }}</button>
              <button v-if="canRemoveCorner(draft, (i + 1) % n)" class="btn small" @click="joinAt(i + 1)">
                Remove corner C{{ i + 2 }} (join W{{ i + 1 }} and W{{ i + 2 }})
              </button>
            </div>
          </div>
          <div class="row-actions">
            <button class="btn" @click="addWall">+ Wall</button>
            <button v-if="n === 4" class="btn" @click="copyOpposite">Copy W1, W2 to W3, W4</button>
            <button class="btn" @click="setAllThickness(draft.walls[0]?.thickness_mm ?? defaultThickness)">
              Same thickness for all
            </button>
          </div>
        </details>

        <details class="card" :open="open.diagonals" @toggle="onToggle('diagonals', $event)">
          <summary><h2>Diagonals</h2><small>{{ draft.diagonals.length || 'none' }}</small></summary>
          <p class="hint">
            Optional. Measure from one corner to another across the room; this tells the app the real corner angles.
            They're drawn as dashed lines.
          </p>
          <div
            v-for="(d, i) in draft.diagonals"
            :key="d.id"
            class="diag-row"
            :class="{ active: isActive('diagonal', i) }"
            @focusin="sel = { kind: 'diagonal', index: i }"
          >
            <label class="field">
              <span class="field-label">From</span>
              <select v-model.number="d.from">
                <option v-for="k in n" :key="k" :value="k - 1">C{{ k }}</option>
              </select>
            </label>
            <label class="field">
              <span class="field-label">To</span>
              <select v-model.number="d.to">
                <option v-for="k in n" :key="k" :value="k - 1">C{{ k }}</option>
              </select>
            </label>
            <NumField v-model="d.length_mm" :kind="unit" :label="`Length (${unit})`" :data-diag="i" />
            <button class="btn icon" aria-label="Remove diagonal" @click="draft.diagonals.splice(i, 1), (sel = null)">
              ✕
            </button>
            <small v-if="residualNote(solved.diagonalResiduals_mm[i])" class="residual">
              {{ residualNote(solved.diagonalResiduals_mm[i]) }}
            </small>
          </div>
          <div class="row-actions">
            <button class="btn" @click="addDiagonal">+ Diagonal</button>
          </div>
        </details>

        <details class="card" :open="open.openings" @toggle="onToggle('openings', $event)">
          <summary><h2>Doors &amp; windows</h2><small>{{ ops.length || 'none' }}</small></summary>
          <p class="hint">
            The distance runs from the corner you choose to the near edge of the hole in the wall (the outside of
            the frame). Width and height can be the outside of the frame or the clear opening inside it. Select a
            wall first to add it there.
          </p>
          <div
            v-for="(o, i) in ops"
            :key="o.id"
            class="opening-row"
            :class="{ bad: !fits(o), active: isActive('opening', o.id) }"
            @focusin="sel = { kind: 'opening', id: o.id }"
          >
            <label class="field">
              <span class="field-label">Type</span>
              <select
                v-model="o.type"
                @change="o.type === 'door' && !o.swing && (o.swing = { hinge: 'start', side: 'in' })"
              >
                <option value="door">Door</option>
                <option value="window">Window</option>
                <option value="opening">Opening</option>
              </select>
            </label>
            <label class="field">
              <span class="field-label">Wall</span>
              <select v-model.number="o.wallIndex">
                <option v-for="k in n" :key="k" :value="k - 1">W{{ k }}</option>
              </select>
            </label>
            <label class="field">
              <span class="field-label">Measured from</span>
              <select :value="o.from ?? 'start'" @change="setFrom(o, ($event.target as HTMLSelectElement).value as 'start' | 'end')">
                <option value="start">C{{ o.wallIndex + 1 }}</option>
                <option value="end">C{{ ((o.wallIndex + 1) % n) + 1 }}</option>
              </select>
            </label>
            <NumField
              v-model="o.offset_mm"
              :kind="unit"
              :label="`Distance from C${o.from === 'end' ? ((o.wallIndex + 1) % n) + 1 : o.wallIndex + 1}`"
              :data-op="o.id"
            />
            <NumField v-model="o.width_mm" :kind="unit" label="Width" />
            <NumField v-model="o.height_mm" :kind="unit" label="Height" />
            <NumField v-if="o.type === 'window'" v-model="o.sill_mm" :kind="unit" label="Sill" />
            <template v-if="o.type !== 'opening'">
              <NumField
                :model-value="o.frame_mm ?? 0"
                kind="mm"
                label="Frame (mm)"
                @update:model-value="(v: number) => (o.frame_mm = v > 0 ? v : undefined)"
              />
              <label class="field">
                <span class="field-label">Size is</span>
                <select
                  :value="o.sizeWithFrame === false ? 'clear' : 'frame'"
                  @change="o.sizeWithFrame = ($event.target as HTMLSelectElement).value === 'clear' ? false : undefined"
                >
                  <option value="frame">With frame</option>
                  <option value="clear">Inside frame</option>
                </select>
              </label>
            </template>
            <template v-if="o.type === 'door' && o.swing">
              <label class="field">
                <span class="field-label">Door</span>
                <select
                  :value="o.operation ?? 'hinged'"
                  @change="o.operation = ($event.target as HTMLSelectElement).value === 'sliding' ? 'sliding' : undefined"
                >
                  <option value="hinged">Hinged</option>
                  <option value="sliding">Sliding</option>
                </select>
              </label>
              <label class="field">
                <span class="field-label">{{ o.operation === 'sliding' ? 'Slides open to' : 'Hinge' }}</span>
                <select v-model="o.swing.hinge">
                  <option value="start">C{{ o.wallIndex + 1 }} side</option>
                  <option value="end">C{{ ((o.wallIndex + 1) % n) + 1 }} side</option>
                </select>
              </label>
              <label v-if="o.operation !== 'sliding'" class="field">
                <span class="field-label">Opens</span>
                <select v-model="o.swing.side">
                  <option value="in">Into room</option>
                  <option value="out">Out of room</option>
                </select>
              </label>
              <label class="check opening-check">
                <input type="checkbox" :checked="!!o.glass" @change="o.glass = ($event.target as HTMLInputElement).checked || undefined" />
                Glass
              </label>
            </template>
            <button class="btn icon" aria-label="Duplicate" title="Duplicate (Ctrl+D)" @click="duplicateOpening(o)"><AppIcon name="copy" /></button>
            <span class="order-buttons">
              <button class="btn icon" aria-label="Move up the list" :disabled="i === 0" @click="moveInList(ops, i, -1)">↑</button>
              <button class="btn icon" aria-label="Move down the list" :disabled="i === ops.length - 1" @click="moveInList(ops, i, 1)">↓</button>
            </span>
            <button class="btn icon" aria-label="Remove" title="Remove" @click="ops.splice(i, 1), (sel = null)"><AppIcon name="trash" /></button>
            <small v-if="!fits(o)" class="residual bad-text">
              Runs past the end of W{{ o.wallIndex + 1 }} ({{ formatLength(wallLen(o.wallIndex), unit) }} {{ unit }})
            </small>
          </div>
          <div class="row-actions">
            <button class="btn" @click="addOpening('door')">+ Door</button>
            <button class="btn" @click="addOpening('window')">+ Window</button>
            <button class="btn" @click="addOpening('opening')">+ Opening</button>
          </div>
        </details>

        <details class="card" :open="open.stairs" @toggle="onToggle('stairs', $event)">
          <summary><h2>Stairs &amp; slopes</h2><small>{{ draft.stairs?.length || 'none' }}</small></summary>
          <p class="hint">
            The arrow points the way it goes, up or down. Drag it in the drawing; Turn changes its direction. Rise is
            the total height it climbs. Going down starts at this room's floor and leaves an opening in it. In 3D,
            stairs are just the steps unless you tick Solid.
          </p>
          <div
            v-for="s in draft.stairs ?? []"
            :key="s.id"
            class="furniture-row"
            :class="{ active: isActive('stair', s.id) }"
            @focusin="sel = { kind: 'stair', id: s.id }"
          >
            <label class="field name">
              <span class="field-label">{{ s.kind === 'stairs' ? 'Stairs' : 'Slope' }}</span>
              <input v-model="s.name" :data-stair-name="s.id" />
            </label>
            <NumField v-model="s.length_mm" :kind="unit" label="Length" />
            <NumField v-model="s.width_mm" :kind="unit" label="Width" />
            <NumField v-model="s.rise_mm" :kind="unit" label="Rise" />
            <NumField v-if="s.kind === 'stairs'" v-model="s.steps" kind="deg" label="Steps" />
            <NumField v-model="s.rotation_deg" kind="deg" label="Turn °" />
            <button class="btn icon" aria-label="Turn 90°" @click="s.rotation_deg = normDeg(s.rotation_deg + 90)">⟳</button>
            <button class="btn icon danger" aria-label="Remove" title="Remove" @click="removeStair(s.id)"><AppIcon name="trash" /></button>
            <div class="row-extra">
              <label class="check">
                <input type="checkbox" :checked="!!s.down" @change="setStairFlag(s, 'down', $event)" />
                Goes down
              </label>
              <label v-if="s.kind === 'stairs'" class="check">
                <input type="checkbox" :checked="!!s.solid" @change="setStairFlag(s, 'solid', $event)" />
                Solid (filled in below the steps)
              </label>
            </div>
            <small class="residual">{{ s.kind === 'stairs' ? stepText(s) : slopeText(s) }}</small>
          </div>
          <div class="row-actions">
            <button class="btn" @click="addStair('stairs')">+ Stairs</button>
            <button class="btn" @click="addStair('ramp')">+ Slope</button>
          </div>
        </details>

        <details class="card" :open="open.fixed" @toggle="onToggle('fixed', $event)">
          <summary><h2>Chimneys &amp; columns</h2><small>{{ draft.fixed?.length || 'none' }}</small></summary>
          <p class="hint">
            Solid parts of the building in the room: a chimney breast, a column, a duct, a block of masonry. X and Y
            are its centre from C1, along W1 and into the room. Drag it in the drawing. Height empty: up to the
            ceiling.
          </p>
          <div
            v-for="f in draft.fixed ?? []"
            :key="f.id"
            class="furniture-row"
            :class="{ active: isActive('fixed', f.id) }"
            @focusin="sel = { kind: 'fixed', id: f.id }"
          >
            <label class="field name">
              <span class="field-label">Name</span>
              <input v-model="f.name" :data-fixed-name="f.id" />
            </label>
            <label class="field">
              <span class="field-label">Kind</span>
              <select v-model="f.kind">
                <option v-for="k in FIXED_KINDS" :key="k.kind" :value="k.kind">{{ k.name }}</option>
              </select>
            </label>
            <label class="field">
              <span class="field-label">Shape</span>
              <select v-model="f.shape">
                <option value="rect">Rectangle</option>
                <option value="round">Round</option>
              </select>
            </label>
            <NumField v-model="f.width_mm" :kind="unit" label="Width" />
            <NumField v-model="f.depth_mm" :kind="unit" label="Depth" />
            <NumField v-model="f.x_mm" :kind="unit" label="X" />
            <NumField v-model="f.y_mm" :kind="unit" label="Y" />
            <NumField
              :model-value="f.height_mm ?? 0"
              :kind="unit"
              label="Height"
              @update:model-value="(v: number) => (f.height_mm = v > 0 ? v : undefined)"
            />
            <NumField v-model="f.rotation_deg" kind="deg" label="Turn °" />
            <button class="btn icon" aria-label="Turn 90°" @click="f.rotation_deg = normDeg(f.rotation_deg + 90)">⟳</button>
            <button class="btn icon danger" aria-label="Remove" title="Remove" @click="removeFixed(f.id)"><AppIcon name="trash" /></button>
          </div>
          <div class="row-actions">
            <select v-model="fixedKind" aria-label="Kind to add">
              <option v-for="k in FIXED_KINDS" :key="k.kind" :value="k.kind">{{ k.name }}</option>
            </select>
            <button class="btn" @click="addFixed">+ Add</button>
          </div>
        </details>

        <div v-if="!isNew" class="row-actions">
          <button class="btn danger" @click="emit('delete')">Delete room</button>
        </div>
      </template>

      <!-- ================= NOTES & FILES ================= -->
      <template v-else-if="mode === 'notes'">
        <section>
          <h2>Notes on the plan</h2>
          <p class="hint">A note is a numbered dot at a spot in the room, with text and photos of its own.</p>
          <div class="row-actions">
            <button class="btn" :class="{ primary: !placing, on: placing }" @click="startPlacing">
              {{ placing ? 'Tap the drawing… (cancel)' : '+ Add note' }}
            </button>
          </div>
          <div
            v-for="(p, i) in draft.pins ?? []"
            :key="p.id"
            class="pin-row"
            :class="{ active: isActive('pin', p.id) }"
            @focusin="sel = { kind: 'pin', id: p.id }"
            @click="sel = { kind: 'pin', id: p.id }"
          >
            <div class="pin-head">
              <span class="pin-dot">{{ i + 1 }}</span>
              <input v-model="p.title" :data-pin-title="p.id" placeholder="Title, e.g. Fuse box" />
              <button class="btn icon danger" aria-label="Delete note" title="Delete note" @click.stop="removePin(p.id)"><AppIcon name="trash" /></button>
            </div>
            <textarea v-model="p.text" rows="2" placeholder="What's here, how it was built…"></textarea>
            <AttachmentsPanel
              v-if="selectedPinId === p.id"
              compact
              :items="pinFiles(p.id)"
              :linked-to="[draft.id, p.id]"
              :storage="storage"
              @add="(a) => atts.push(a)"
              @remove="(id) => (atts = atts.filter((a) => a.id !== id))"
            />
            <small v-else-if="pinFiles(p.id).length" class="residual">📎 {{ pinFiles(p.id).length }} — tap to show</small>
          </div>
        </section>
        <section>
          <h2>About the whole room</h2>
          <textarea
            v-model="draft.notes"
            rows="4"
            placeholder="Paint colours, flooring, renovation history, anything for the whole room"
          ></textarea>
          <h3>Photos &amp; documents</h3>
          <AttachmentsPanel
            :items="roomFiles"
            :linked-to="[draft.id]"
            :storage="storage"
            @add="(a) => atts.push(a)"
            @remove="(id) => (atts = atts.filter((a) => a.id !== id))"
          />
        </section>
      </template>

      <!-- ================= FURNITURE ================= -->
      <template v-else-if="mode === 'furniture'">
        <section>
          <h2>Furniture</h2>
          <p class="hint">Add an item, then drag it in the drawing. Position is its centre, measured from C1 along W1.</p>
          <div class="row-actions">
            <label class="field">
              <span class="field-label">Item</span>
              <select v-model="presetKind">
                <option v-for="p in FURNITURE_PRESETS" :key="p.kind" :value="p.kind">
                  {{ p.name }} ({{ formatLength(p.width_mm, 'cm') }} × {{ formatLength(p.depth_mm, 'cm') }} cm)
                </option>
              </select>
            </label>
            <button class="btn primary" @click="addFurniture">+ Add</button>
          </div>
          <p v-if="!draft.furniture?.length" class="hint">No furniture in this room yet.</p>
          <div
            v-for="(f, i) in draft.furniture ?? []"
            :key="f.id"
            class="furniture-row"
            :class="{ active: isActive('furniture', f.id) }"
            @focusin="sel = { kind: 'furniture', id: f.id }"
          >
            <label class="field name">
              <span class="field-label">Name</span>
              <input v-model="f.name" :data-furn="f.id" />
            </label>
            <label class="field">
              <span class="field-label">Group</span>
              <input
                :value="f.group ?? ''"
                list="fp-furniture-groups"
                placeholder="none"
                @change="setGroup(f, ($event.target as HTMLInputElement).value)"
              />
            </label>
            <label class="field">
              <span class="field-label">Colour</span>
              <span class="color-field">
                <input
                  type="color"
                  :value="f.color ?? '#ffffff'"
                  :aria-label="`Colour of ${f.name}`"
                  @input="f.color = ($event.target as HTMLInputElement).value"
                />
                <button v-if="f.color" class="btn icon small" aria-label="No colour" title="No colour" @click="delete f.color">✕</button>
              </span>
            </label>
            <NumField v-model="f.width_mm" :kind="unit" label="Width" />
            <NumField v-model="f.depth_mm" :kind="unit" label="Depth" />
            <NumField
              :model-value="furnitureHeight(f)"
              :kind="unit"
              label="Height"
              @update:model-value="(v: number) => (f.height_mm = v > 0 ? v : undefined)"
            />
            <NumField
              :model-value="f.elevation_mm ?? 0"
              :kind="unit"
              label="Above floor"
              @update:model-value="(v: number) => (f.elevation_mm = v ? v : undefined)"
            />
            <NumField v-model="f.x_mm" :kind="unit" label="X" />
            <NumField v-model="f.y_mm" :kind="unit" label="Y" />
            <NumField v-model="f.rotation_deg" kind="deg" label="Turn °" />
            <button class="btn icon" aria-label="Turn 90°" title="Turn 90° (R)" @click="f.rotation_deg = normDeg(f.rotation_deg + 90)">
              ⟳
            </button>
            <button class="btn icon" aria-label="Duplicate" title="Duplicate (Ctrl+D)" @click="addFurnitureCopies([f])"><AppIcon name="copy" /></button>
            <span class="order-buttons">
              <button class="btn icon" aria-label="Move up the list" title="Up the list (drawn below)" :disabled="i === 0" @click="moveInList(draft.furniture!, i, -1)">↑</button>
              <button
                class="btn icon"
                aria-label="Move down the list"
                title="Down the list (drawn on top)"
                :disabled="i === (draft.furniture?.length ?? 0) - 1"
                @click="moveInList(draft.furniture!, i, 1)"
              >
                ↓
              </button>
            </span>
            <button class="btn icon danger" aria-label="Remove" title="Remove" @click="removeFurniture(f.id)"><AppIcon name="trash" /></button>
            <div v-if="f.group && isActive('furniture', f.id)" class="row-extra">
              <small>Group {{ f.group }}: {{ groupCount(f.group) }} pieces, they move together</small>
              <button class="btn small" @click="turnGroupOf(f)">⟳ Turn group</button>
              <button class="btn small" @click="addFurnitureCopies(groupOf(draft.furniture ?? [], f))"><AppIcon name="copy" /> Duplicate group</button>
              <button class="btn small" @click="copyGroup(f.group)">Copy group</button>
              <button class="btn small" @click="ungroup(f.group)">Ungroup</button>
            </div>
          </div>
          <datalist id="fp-furniture-groups">
            <option v-for="g in groupList" :key="g" :value="g" />
          </datalist>
        </section>
      </template>

      <!-- ================= INSTALLATIONS (later) ================= -->
      <template v-else>
        <section class="coming">
          <h2>Electrical, water &amp; heating</h2>
          <p>
            Coming later: sockets, switches, lights and circuits; water and drain pipes; radiators and heating
            pipes. Each will be its own layer that you can show or hide on the plan, with heights and photos.
          </p>
          <p class="hint">For now, use Notes &amp; files to keep photos of the electrical panel or pipes.</p>
          <button class="btn" @click="setMode('notes')">Go to Notes &amp; files</button>
        </section>
      </template>
      </div>
    </div>
  </div>
</template>
