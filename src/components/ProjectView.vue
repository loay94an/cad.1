<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, toRaw, watch } from 'vue';
import {
  DEFAULT_VIEW,
  GHOST_COLOR,
  neighbourFloor,
  type Attachment,
  type Floor,
  type Opening,
  type Project,
  type Room,
  fileIdOf,
  newFloor,
  newRoom,
} from '../model/schema';
import { ConflictError, type Role, type StorageAdapter, type VersionSummary } from '../storage/types';
import { RestAdapter } from '../storage/rest';
import { deleteUnusedFiles } from '../storage/versions';
import { type Draft, deleteDraft, getDraft, putDraft, samePlan } from '../storage/drafts';
import { auth } from '../auth/session';
import { alignDelta, boundsOf, rotateRoomAbout, roomGeometry, snapRoom } from '../geometry/floor';
import { centroid, normDeg, type Vec } from '../geometry/vec';
import { HEADROOM_MM } from '../geometry/ceiling';
import { formatInput, parseLength } from '../units';
import { ctrlOrCmd, hasFinePointer, isTyping, useKeydown } from '../composables/useShortcuts';
import ExportDialog from './ExportDialog.vue';
import FloorCanvas from './FloorCanvas.vue';
import RoomEditor from './RoomEditor.vue';
import ShortcutsHelp from './ShortcutsHelp.vue';
import FloatingDock from './FloatingDock.vue';
import ModeBar from './ModeBar.vue';
import NotePopup from './NotePopup.vue';
import ShareDialog from './ShareDialog.vue';
import BoardEditor from './BoardEditor.vue';
import EendraadschemaView from './EendraadschemaView.vue';
import QuantitiesView from './QuantitiesView.vue';
import VersionsDialog from './VersionsDialog.vue';
import ElecSymbol from './ElecSymbol.vue';
import UtilityTools from './UtilityTools.vue';
import { type UtilSel, type UtilTool, type UtilityId, emptyUtilities, newUtilPoint, newUtilRun } from '../model/utilities';
import {
  APPLIANCES,
  POINT_KINDS,
  type PointKind,
  circuitCodes,
  circuitColor,
  devicesOf,
  emptyElectrical,
  controllersOf,
  isBreaker,
  isControl,
  isLight,
  newPoint,
  pointInfo,
  removePoint,
  type ElecPoint,
  pastePoints,
  toggleLink,
} from '../model/electrical';
import { checkInstallation } from '../electrical/arei';
import { roomNameFn } from '../electrical/rooms';
import { clipboard, copyToClipboard } from '../model/clipboard';
import AppIcon from './AppIcon.vue';
import type { EditorMode, WallTypePatch } from './editorTypes';
import { MODES, type AppMode, modeInfo } from './modes';

const props = defineProps<{ id: string; storage: StorageAdapter }>();
const emit = defineEmits<{ back: [] }>();

const project = ref<Project | null>(null);
const floorId = ref('');
const selectedId = ref<string | null>(null);
const editing = ref<{ room: Room; isNew: boolean; mode?: EditorMode; pin?: string } | null>(null);
const showMenu = ref(false); // ☰: plans, floors, rooms
const showOptions = ref(false); // ⋯: this home's settings and export
const showDock = ref(false);
const roomMenu = ref(false);
const mode = ref<AppMode>('view');
const note = ref<{ roomId: string; pinId: string; at: { x: number; y: number } } | null>(null);
const wrap = ref<HTMLElement>();
const showExport = ref(false);
const showHelp = ref(false);
const aligning = ref(false);
/** The measuring tape is out (floor view). */
const measuring = ref(false);
const fitToken = ref(0);
const saveState = ref<'saved' | 'saving' | 'error'>('saved');
const canvas = ref<InstanceType<typeof FloorCanvas>>();
const pc = hasFinePointer();
const accent = computed(() => modeInfo(mode.value).plan);
const hint = computed(() => {
  const tail = pc ? ' · ? for shortcuts' : '';
  if (mode.value === 'layout') return `Drag rooms to move them, ⟳ to turn · drag doors and windows along the walls${tail}`;
  if (mode.value === 'electrical')
    return placingBoard.value
      ? 'Tap where the fuse box hangs'
      : placingKind.value
        ? 'Tap the plan to place it · tap the button again to stop'
        : `Pick a symbol, then tap the plan · drag points to move them (they line up; Ctrl: free, Shift: straight, Alt: distances)${tail}`;
  if (mode.value === 'utilities')
    return utilTool.value?.type === 'point'
      ? 'Tap the plan to place it · tap the button again to stop'
      : utilTool.value
        ? ''
        : `Pick a symbol or a pipe, then tap the plan · drag points to move them (they line up; Ctrl: free, Shift: straight, Alt: distances)${tail}`;
  if (mode.value === 'furniture') return `Double-tap a room to place its furniture${tail}`;
  return `Tap a note dot to read it · double-tap a room to open its notes${tail}`;
});
watch(selectedId, () => (roomMenu.value = false));
// One popup at a time.
watch(showDock, (on) => {
  if (on) roomMenu.value = false;
  if (on) note.value = null;
});
const editModes = MODES.filter((m) => !m.soon && m.id !== 'electrical' && m.id !== 'utilities');

// ---- utilities (water, drainage, heating, ventilation, gas) ------------------------
const utility = ref<UtilityId>('water');
const utilTool = ref<UtilTool | null>(null);
const utilSel = ref<UtilSel | null>(null);
const utils = computed(() => project.value?.utilities);

function utilPlace(x: number, y: number) {
  const u = utils.value;
  if (!u || readonly.value || utilTool.value?.type !== 'point') return;
  u.points.push(newUtilPoint(floorId.value, utility.value, utilTool.value.kind, x, y));
}
function utilMovePoint(id: string, x: number, y: number) {
  const p = utils.value?.points.find((q) => q.id === id);
  if (p && !readonly.value) Object.assign(p, { x_mm: x, y_mm: y });
}
function utilAddRun(kind: string, path: Vec[]) {
  if (utils.value && !readonly.value) utils.value.runs.push(newUtilRun(floorId.value, utility.value, kind, path));
}
function utilMoveCorner(runId: string, index: number, x: number, y: number) {
  const r = utils.value?.runs.find((q) => q.id === runId);
  if (r?.path[index] && !readonly.value) r.path[index] = { x: Math.round(x), y: Math.round(y) };
}
function deleteUtilSel() {
  const u = utils.value;
  const s = utilSel.value;
  if (!u || !s || readonly.value) return;
  if (s.type === 'point') u.points = u.points.filter((p) => p.id !== s.id);
  else u.runs = u.runs.filter((r) => r.id !== s.id);
  utilSel.value = null;
}

// ---- electrical ------------------------------------------------------------------
const placingKind = ref<PointKind | null>(null);
const placingBoard = ref<string | null>(null);
const pointId = ref<string | null>(null);
/** New points go on this circuit. */
const activeCircuit = ref<string | null>(null);
const showBoards = ref(false);
const showSchema = ref(false);
const show3d = ref(false);
const showQuantities = ref(false);

/** The floor below and/or above as outlines, when switched on under Show. */
const ghosts = computed(() => {
  const p = project.value;
  const f = floor.value;
  if (!p || !f) return [];
  const view = p.settings.view;
  return ([['below', -1], ['above', 1]] as const).flatMap(([key, step]) => {
    const other = view?.[key] ? neighbourFloor(p.floors, f, step) : undefined;
    return other ? [{ key, rooms: other.rooms, color: GHOST_COLOR[key], label: other.name }] : [];
  });
});
/** three.js is large: fetched the first time the 3D view opens. */
const Plan3D = defineAsyncComponent(() => import('./Plan3D.vue'));

const elec = computed(() => project.value?.electrical);
const codes = computed(() => (elec.value ? circuitCodes(elec.value) : new Map<string, string>()));
const circuits = computed(() =>
  (elec.value?.boards ?? []).flatMap((b) =>
    devicesOf(b)
      .filter(isBreaker)
      .map((d) => ({ id: d.id, code: codes.value.get(d.id)!, name: d.circuit?.name ?? '', color: circuitColor(codes.value.get(d.id)) })),
  ),
);
const selectedPoint = computed(() => elec.value?.points.find((p) => p.id === pointId.value));
const roomName = computed(() => (project.value ? roomNameFn(project.value) : () => undefined));
const elecErrors = computed(() =>
  elec.value ? checkInstallation(elec.value, { roomName: roomName.value }).filter((i) => i.level === 'error').length : 0,
);

function togglePlacing(k: PointKind) {
  placingBoard.value = null;
  placingKind.value = placingKind.value === k ? null : k;
  pointId.value = null;
}

function placePoint(x: number, y: number) {
  const e = elec.value;
  if (!e || readonly.value) return;
  if (placingBoard.value) {
    const b = e.boards.find((x) => x.id === placingBoard.value);
    if (b) b.location = { floorId: floorId.value, x_mm: Math.round(x), y_mm: Math.round(y) };
    placingBoard.value = null;
    placingKind.value = null;
    return;
  }
  if (!placingKind.value) return;
  const p = newPoint(floorId.value, placingKind.value, x, y, activeCircuit.value ?? undefined);
  if (p.kind === 'appliance') p.appliance = 'other';
  e.points.push(p);
}

function movePoint(id: string, x: number, y: number) {
  const p = elec.value?.points.find((q) => q.id === id);
  if (p && !readonly.value) Object.assign(p, { x_mm: x, y_mm: y });
}

function moveBoard(id: string, x: number, y: number) {
  const b = elec.value?.boards.find((q) => q.id === id);
  if (b?.location && !readonly.value) Object.assign(b.location, { x_mm: x, y_mm: y });
}

function deletePoint() {
  const e = elec.value;
  if (!e || !pointId.value) return;
  removePoint(e, pointId.value);
  pointId.value = null;
  linking.value = null;
}

/** Copies of points, 30 cm to the right when the originals are on this floor. */
function addPointCopies(points: ElecPoint[]): ElecPoint[] {
  const e = elec.value;
  if (!e || readonly.value || !points.length) return [];
  const here = points.some((p) => p.floorId === floorId.value && e.points.some((q) => q.id === p.id));
  const copies = pastePoints(e, points, floorId.value, here ? { x: 300, y: 0 } : { x: 0, y: 0 });
  linking.value = null;
  pointId.value = copies[0]?.id ?? null;
  return copies;
}

function duplicatePoint() {
  if (selectedPoint.value) addPointCopies([selectedPoint.value]);
}

function copyPoint(): boolean {
  if (!selectedPoint.value) return false;
  copyToClipboard({ kind: 'point', items: [selectedPoint.value] });
  return true;
}

function pastePoint(): boolean {
  const c = clipboard();
  if (c?.kind !== 'point' || readonly.value) return false;
  // The next paste lands a step further on.
  copyToClipboard({ kind: 'point', items: addPointCopies(c.items) });
  return true;
}

// ---- switches ↔ lights ----
/** The switch or light whose links are being edited: tapping lights (or switches) toggles a link. */
const linking = ref<string | null>(null);

function onSelectPoint(id: string | null) {
  const e = elec.value;
  if (linking.value && e) {
    const src = e.points.find((p) => p.id === linking.value);
    const target = id ? e.points.find((p) => p.id === id) : undefined;
    if (src && target && target.id !== src.id) {
      if (!readonly.value) toggleLink(src, target);
      return;
    }
    if (!id) {
      linking.value = null; // tap on empty space: done linking
      return;
    }
    if (target?.id === src?.id) return;
  }
  pointId.value = id;
}

/** "Bediend door 2 schakelaars" / "Switches 3 lights" for the selected point. */
const linkInfo = computed(() => {
  const p = selectedPoint.value;
  const e = elec.value;
  if (!p || !e) return null;
  const name = (q: { kind: PointKind; label?: string }) => q.label || pointInfo(q.kind).label;
  if (isControl(p.kind)) {
    const lights = (p.controls ?? []).map((id) => e.points.find((q) => q.id === id)).filter((q) => !!q);
    return { what: 'lights', text: lights.length ? `Switches: ${lights.map(name).join(', ')}` : 'Switches no lights yet' };
  }
  if (isLight(p.kind)) {
    const sw = controllersOf(e, p.id);
    return { what: 'switches', text: sw.length ? `Switched by: ${sw.map(name).join(', ')}` : 'No switch yet' };
  }
  return null;
});
watch(pointId, (id) => {
  if (id !== linking.value) linking.value = null;
});

function placeBoardOnPlan(id: string) {
  showBoards.value = false;
  placingKind.value = null;
  placingBoard.value = id;
}

watch(mode, (m) => {
  // Working on the electrical plan: show it.
  if (m === 'electrical' && project.value?.settings.view) project.value.settings.view.installations = true;
  if (m === 'utilities' && project.value) {
    if (!readonly.value) project.value.utilities ??= emptyUtilities();
    if (project.value.settings.view) project.value.settings.view.utilities = true;
  } else {
    utilTool.value = null;
    utilSel.value = null;
  }
  if (m !== 'electrical') {
    placingKind.value = null;
    placingBoard.value = null;
    pointId.value = null;
  }
});

function onSelect(id: string | null) {
  selectedId.value = id;
  note.value = null;
}

function openRoom(id: string) {
  const r = floor.value?.rooms.find((x) => x.id === id);
  if (r) editRoom(r);
}

function areaText(r: Room) {
  const s = roomGeometry(r).solved;
  return s.closed ? `${s.area_m2.toFixed(2)} m²` : 'not closed';
}

/** Fills in what the screens expect (also for versions opened or restored). */
function prepare(p: Project) {
  p.settings.view = { ...DEFAULT_VIEW, ...p.settings.view };
  p.settings.defaultHeight_mm ??= 2600;
  p.electrical ??= emptyElectrical();
  return p;
}

onMounted(async () => {
  let p: Project | undefined;
  try {
    p = await props.storage.get(props.id);
  } catch (e) {
    alert(e instanceof Error ? e.message : String(e));
  }
  if (!p) {
    alert('This plan could not be found, or it is no longer shared with you.');
    emit('back');
    return;
  }
  prepare(p);
  role.value = props.storage.roleOf?.(p.id);
  project.value = p;
  floorId.value = p.floors[0]?.id ?? '';
  snapshot();
  await checkDraft(p);
});

// ---- changes kept on this device ---------------------------------------------------

/** Plans in your account: who the drafts on this device belong to. */
const draftUser = props.storage instanceof RestAdapter ? auth.me?.id : undefined;
/** Changes on this device that never reached the server: you choose which version to keep. */
const draftChoice = ref<{ draft: Draft; server: Project } | null>(null);
const draftBusy = ref(false);
let draftTimer: ReturnType<typeof setTimeout> | undefined;
/** Counts edits, so a save that finished does not drop a draft with newer edits. */
let edits = 0;

async function checkDraft(server: Project) {
  if (!draftUser || viewOnly.value) return;
  const d = await getDraft(draftUser, server.id).catch(() => undefined);
  if (!d) return;
  prepare(d.project);
  if (samePlan(d.project, server)) void deleteDraft(draftUser, server.id).catch(() => undefined);
  else draftChoice.value = { draft: d, server: JSON.parse(JSON.stringify(server)) as Project };
}

function writeDraft() {
  clearTimeout(draftTimer);
  draftTimer = undefined;
  if (!draftUser || !project.value || readonly.value) return Promise.resolve();
  return putDraft(draftUser, toRaw(project.value)).catch((e) => console.warn('Could not keep the changes on this device', e));
}

const when = (iso: string) => new Date(iso).toLocaleString('ar');

/** Keep the version from this device. The one in your account is kept as an automatic version. */
async function useDraft() {
  const c = draftChoice.value;
  if (!c || !draftUser) return;
  draftBusy.value = true;
  try {
    await props.storage.putVersion(c.server.id, 'In your account, before the changes from this device', c.server, true);
    showPlan(prepare({ ...c.draft.project, id: c.server.id, createdAt: c.server.createdAt }));
    resetHistory();
    draftChoice.value = null;
    clearTimeout(timer);
    saveState.value = 'saving';
    await saveNow();
  } catch (e) {
    alert(e instanceof Error ? e.message : String(e));
  } finally {
    draftBusy.value = false;
  }
}

/** Keep the version in your account. The one from this device is kept as an automatic version. */
async function useServer() {
  const c = draftChoice.value;
  if (!c || !draftUser) return;
  draftBusy.value = true;
  try {
    await props.storage.putVersion(c.server.id, 'Changes from this device that were not saved', c.draft.project, true);
    await deleteDraft(draftUser, c.server.id);
    draftChoice.value = null;
  } catch (e) {
    alert(e instanceof Error ? e.message : String(e));
  } finally {
    draftBusy.value = false;
  }
}

// A page that is closed or reloaded may not run the save timer: keep the changes first.
const onPageHide = () => {
  if (draftTimer) void writeDraft();
};
addEventListener('pagehide', onPageHide);
onBeforeUnmount(() => removeEventListener('pagehide', onPageHide));

/** Shared with you as "view only": nothing can be changed or saved. */
const role = ref<Role | undefined>();
/** Shared with you as "view only". */
const viewOnly = computed(() => role.value === 'viewer');
/** Nothing can be changed: view only, or looking at an older version. */
const readonly = computed(() => viewOnly.value || !!looking.value);
const isOwner = computed(() => props.storage instanceof RestAdapter && role.value === 'owner');
const showShare = ref(false);
const saveError = ref('');
const saveText = computed(() => {
  if (looking.value) return `version “${looking.value.version.name}”`;
  if (readonly.value) return 'view only';
  if (saveState.value === 'saving') return 'saving…';
  if (saveState.value === 'error') return saveError.value || 'could not save!';
  return `saved to ${props.storage.label}`;
});

// ---- undo / redo ----------------------------------------------------------------
// Snapshots of the whole project, taken shortly after each change.

const history: string[] = [];
let hIndex = -1;
let restoring = false;
let historyTimer: ReturnType<typeof setTimeout> | undefined;
const canUndo = ref(false);
const canRedo = ref(false);

function snapshot() {
  if (!project.value) return;
  const s = JSON.stringify(project.value);
  if (history[hIndex] !== s) {
    history.splice(hIndex + 1);
    history.push(s);
    if (history.length > 100) history.shift();
    hIndex = history.length - 1;
  }
  canUndo.value = hIndex > 0;
  canRedo.value = hIndex < history.length - 1;
}

function restore(i: number) {
  restoring = true;
  hIndex = i;
  const p = JSON.parse(history[i]) as Project;
  project.value = p;
  if (!p.floors.some((f) => f.id === floorId.value)) floorId.value = p.floors[0]?.id ?? '';
  canUndo.value = hIndex > 0;
  canRedo.value = hIndex < history.length - 1;
  void nextTick(() => (restoring = false));
}

function undo() {
  if (readonly.value) return;
  clearTimeout(historyTimer);
  snapshot();
  if (hIndex > 0) restore(hIndex - 1);
}

function redo() {
  if (readonly.value) return;
  clearTimeout(historyTimer);
  snapshot();
  if (hIndex < history.length - 1) restore(hIndex + 1);
}

// ---- versions -------------------------------------------------------------------

const showVersions = ref(false);
/** Looking at an older version (read-only); `latest` is the plan to go back to. */
const looking = ref<{ version: VersionSummary; latest: string } | null>(null);

function resetHistory() {
  clearTimeout(historyTimer);
  history.length = 0;
  hIndex = -1;
  snapshot();
}

/** Replaces the plan on screen without it counting as an edit (no undo step). */
function showPlan(p: Project) {
  restoring = true;
  project.value = p;
  if (!p.floors.some((f) => f.id === floorId.value)) floorId.value = p.floors[0]?.id ?? '';
  selectedId.value = null;
  editing.value = null;
  note.value = null;
  void nextTick(() => (restoring = false));
}

async function flushSave() {
  if (saveState.value !== 'saving') return;
  clearTimeout(timer);
  await saveNow();
}

async function lookAt(v: VersionSummary) {
  const p = project.value;
  if (!p) return;
  try {
    await flushSave();
    const doc = await props.storage.getVersion(p.id, v.id);
    if (!doc) throw new Error('This version could not be found.');
    const latest = looking.value?.latest ?? JSON.stringify(toRaw(p));
    looking.value = { version: v, latest };
    showVersions.value = false;
    setMode('view');
    showPlan(prepare({ ...doc, id: p.id }));
  } catch (e) {
    alert(e instanceof Error ? e.message : String(e));
  }
}

function backToLatest() {
  const l = looking.value;
  if (!l) return;
  showPlan(JSON.parse(l.latest) as Project);
  looking.value = null;
  // The plan on screen is the saved one again: nothing to save.
  void nextTick(() => {
    clearTimeout(timer);
    saveState.value = 'saved';
  });
}

async function restoreVersion(v: VersionSummary) {
  const p = project.value;
  if (!p || viewOnly.value) return;
  const label = `“${v.name}” (${new Date(v.createdAt).toLocaleString('ar')})`;
  if (!confirm(`Restore ${label}?

The plan as it is now is saved first as an automatic version “Before restore”, so you can go back to it.`)) return;
  try {
    const latest = looking.value ? (JSON.parse(looking.value.latest) as Project) : JSON.parse(JSON.stringify(toRaw(p)));
    await flushSave();
    const doc = await props.storage.getVersion(p.id, v.id);
    if (!doc) throw new Error('This version could not be found.');
    await props.storage.putVersion(p.id, `قبل الاستعادة ${new Date().toLocaleString('ar')}`, latest, true);
    looking.value = null;
    showVersions.value = false;
    showPlan(prepare({ ...doc, id: p.id, createdAt: latest.createdAt }));
    resetHistory();
    // Save the restored plan as the latest.
    clearTimeout(timer);
    saveState.value = 'saving';
    timer = setTimeout(saveNow, 0);
  } catch (e) {
    alert(e instanceof Error ? e.message : String(e));
  }
}

// Save shortly after every change.
let timer: ReturnType<typeof setTimeout> | undefined;
async function saveNow() {
  if (!project.value || readonly.value || draftChoice.value) return;
  const n = edits;
  try {
    if (draftUser) await writeDraft();
    await props.storage.put({ ...toRaw(project.value), updatedAt: new Date().toISOString() });
    saveState.value = 'saved';
    saveError.value = '';
    // The server has it now; newer edits keep their draft.
    if (draftUser && n === edits && !draftTimer) await deleteDraft(draftUser, project.value.id).catch(() => undefined);
  } catch (e) {
    saveState.value = 'error';
    saveError.value = e instanceof ConflictError ? 'changed elsewhere: reload!' : 'could not save!';
    if (e instanceof ConflictError) alert(e.message);
  }
}
watch(
  project,
  (_now, before) => {
    if (!before || readonly.value) return;
    edits++;
    saveState.value = 'saving';
    clearTimeout(timer);
    timer = setTimeout(saveNow, 400);
    if (draftUser) {
      clearTimeout(draftTimer);
      draftTimer = setTimeout(writeDraft, 150);
    }
    if (!restoring) {
      clearTimeout(historyTimer);
      historyTimer = setTimeout(snapshot, 350);
    }
  },
  { deep: true },
);
onBeforeUnmount(() => {
  if (saveState.value === 'saving') {
    clearTimeout(timer);
    void saveNow();
  }
});

const floor = computed<Floor | undefined>(() => project.value?.floors.find((f) => f.id === floorId.value));
const unit = computed(() => project.value?.settings.unit ?? 'm');
const selectedRoom = computed(() => floor.value?.rooms.find((r) => r.id === selectedId.value));

// ---- rooms ------------------------------------------------------------------

function addRoom() {
  showDock.value = false;
  if (readonly.value) return;
  const p = project.value;
  const f = floor.value;
  if (!p || !f) return;
  const t = p.settings.defaultThickness_mm;
  const b = boundsOf(f.rooms.map(roomGeometry));
  const origin = b ? { x: b.maxX + 1000 + t, y: b.minY + t } : { x: 0, y: 0 };
  editing.value = { room: newRoom(`Room ${f.rooms.length + 1}`, t, origin), isNew: true, mode: 'layout' };
}

function editRoom(room: Room, editorMode?: EditorMode, pin?: string) {
  showMenu.value = false;
  roomMenu.value = false;
  aligning.value = false;
  note.value = null;
  if (readonly.value) return;
  editing.value = { room, isNew: false, mode: editorMode ?? modeInfo(mode.value).editor, pin };
}

function setMode(m: AppMode) {
  if (modeInfo(m).soon || (readonly.value && m !== 'view')) return;
  mode.value = m;
  measuring.value = false;
  aligning.value = false;
  roomMenu.value = false;
}

/** A tap on a note dot shows it in a popup; Edit opens the room's notes. */
function openPin(roomId: string, pinId: string, at: { x: number; y: number }) {
  note.value = { roomId, pinId, at };
  selectedId.value = roomId;
}

const notePopup = computed(() => {
  const n = note.value;
  const room = n && floor.value?.rooms.find((r) => r.id === n.roomId);
  const i = room?.pins?.findIndex((p) => p.id === n!.pinId) ?? -1;
  if (!n || !room || i < 0) return null;
  const pin = room.pins![i];
  const box = wrap.value?.getBoundingClientRect();
  return {
    room,
    pin,
    number: i + 1,
    at: n.at,
    box: { w: box?.width ?? 360, h: box?.height ?? 600 },
    files: project.value?.attachments.filter((a) => a.linkedTo.includes(pin.id)) ?? [],
  };
});

// ---- turning & lining up ------------------------------------------------------

function turnSelected(deg: number) {
  const room = selectedRoom.value;
  if (!room || room.locked || mode.value !== 'layout') return;
  const g = roomGeometry(room);
  const pivot = g.solved.closed ? centroid(g.inner) : room.origin;
  Object.assign(room, rotateRoomAbout(room, deg, pivot));
}

function typeAngle() {
  const room = selectedRoom.value;
  if (!room || room.locked) return;
  const v = prompt('Turn the room to (degrees, clockwise)', String(Math.round(room.rotation_deg * 10) / 10));
  const deg = v === null ? NaN : parseFloat(v.replace(',', '.'));
  if (Number.isFinite(deg)) turnSelected(normDeg(deg) - room.rotation_deg);
}

function startAlign() {
  if (mode.value !== 'layout') return;
  if (selectedRoom.value && !selectedRoom.value.locked && (floor.value?.rooms.length ?? 0) > 1) aligning.value = true;
}

function alignTo(targetId: string, wallIndex: number) {
  const f = floor.value;
  const room = selectedRoom.value;
  aligning.value = false;
  if (!f || !room) return;
  const delta = alignDelta(f.rooms, room.id, targetId, wallIndex);
  if (delta === null) return;
  turnSelected(delta);
  // Close enough to a wall now? Slide it into place too.
  const s = snapRoom(f.rooms, room.id, room.origin, room.rotation_deg);
  if (s.guide) Object.assign(room, { origin: s.origin, rotation_deg: s.rotation_deg });
}

function nudgeSelected(dx: number, dy: number) {
  const room = selectedRoom.value;
  if (!room || room.locked || mode.value !== 'layout') return;
  room.origin = { x: room.origin.x + dx, y: room.origin.y + dy };
}

function selectNextRoom(dir: 1 | -1) {
  const rooms = floor.value?.rooms ?? [];
  if (!rooms.length) return;
  const i = rooms.findIndex((r) => r.id === selectedId.value);
  selectedId.value = rooms[(i + dir + rooms.length) % rooms.length].id;
}

function switchFloor(dir: 1 | -1) {
  const floors = project.value?.floors ?? [];
  const i = floors.findIndex((f) => f.id === floorId.value);
  const next = floors[i + dir];
  if (!next) return;
  selectFloor(next.id);
}

// ---- keyboard ------------------------------------------------------------------

useKeydown((e) => {
  if (editing.value || showBoards.value) return; // the room and fuse box editors have their own keys
  if (showSchema.value) {
    if (e.key === 'Escape') showSchema.value = false;
    return;
  }
  if (show3d.value || showQuantities.value) {
    if (e.key === 'Escape') show3d.value = showQuantities.value = false;
    return;
  }
  if (showHelp.value || showMenu.value || showOptions.value || showExport.value) {
    if (e.key === 'Escape' || (showHelp.value && e.key === '?')) {
      showHelp.value = showMenu.value = showOptions.value = showExport.value = false;
      e.preventDefault();
    }
    return;
  }
  if (ctrlOrCmd(e)) {
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey && !isTyping(e)) undo();
    else if ((k === 'y' || (k === 'z' && e.shiftKey)) && !isTyping(e)) redo();
    else if (mode.value === 'electrical' && (k === 'c' || k === 'v' || k === 'd') && !isTyping(e)) {
      const done = k === 'c' ? copyPoint() : k === 'v' ? pastePoint() : (duplicatePoint(), !!pointId.value);
      if (!done) return;
    } else if (k === 'e') showExport.value = true;
    else if (k === 's') void saveNow(); // already saved automatically; just don't open the browser's dialog
    else return;
    e.preventDefault();
    return;
  }
  if (isTyping(e) || e.altKey) return;
  const room = selectedRoom.value;
  const step = e.shiftKey ? 100 : 10;
  const turn = e.shiftKey ? 15 : 1;
  let handled = true;
  switch (e.key) {
    case '1':
    case '2':
    case '3':
    case '4':
    case '5':
      setMode(MODES[Number(e.key) - 1].id);
      break;
    case ' ':
      showDock.value = !showDock.value;
      break;
    case 'm':
    case 'M':
      measuring.value = !measuring.value;
      break;
    case 'Escape':
      if (measuring.value) measuring.value = false;
      else if (utilTool.value) utilTool.value = null;
      else if (utilSel.value) utilSel.value = null;
      else if (linking.value) linking.value = null;
      else if (placingKind.value || placingBoard.value) placingKind.value = placingBoard.value = null;
      else if (pointId.value) pointId.value = null;
      else if (note.value) note.value = null;
      else if (roomMenu.value) roomMenu.value = false;
      else if (showDock.value) showDock.value = false;
      else if (aligning.value) aligning.value = false;
      else selectedId.value = null;
      break;
    case 'n':
    case 'N':
      addRoom();
      break;
    case 'Enter':
    case 'e':
      if (room) editRoom(room);
      else handled = false;
      break;
    case 'Delete':
    case 'Backspace':
      if (utilSel.value && mode.value === 'utilities') deleteUtilSel();
      else if (pointId.value && mode.value === 'electrical') deletePoint();
      else if (room && mode.value === 'layout') deleteRoom(room);
      else handled = false;
      break;
    case 'ArrowLeft':
      nudgeSelected(-step, 0);
      break;
    case 'ArrowRight':
      nudgeSelected(step, 0);
      break;
    case 'ArrowUp':
      nudgeSelected(0, -step);
      break;
    case 'ArrowDown':
      nudgeSelected(0, step);
      break;
    case 'r':
      turnSelected(90);
      break;
    case 'R':
      turnSelected(-90);
      break;
    case ',':
    case '<':
      turnSelected(-turn);
      break;
    case '.':
    case '>':
      turnSelected(turn);
      break;
    case 'a':
      startAlign();
      break;
    case 't':
      typeAngle();
      break;
    case 'l':
      if (room) toggleLock(room);
      break;
    case 'Tab':
      selectNextRoom(e.shiftKey ? -1 : 1);
      break;
    case 'PageUp':
      switchFloor(-1);
      break;
    case 'PageDown':
      switchFloor(1);
      break;
    case '+':
    case '=':
      canvas.value?.zoomIn();
      break;
    case '-':
    case '_':
      canvas.value?.zoomOut();
      break;
    case 'f':
    case '0':
      fitToken.value++;
      break;
    case 'v':
      canvas.value?.toggleView();
      break;
    case '?':
      showHelp.value = true;
      break;
    default:
      handled = false;
  }
  if (handled) e.preventDefault();
});

const attachmentsOf = (roomId: string) =>
  project.value?.attachments.filter((a) => a.linkedTo.includes(roomId)) ?? [];

function saveRoom(room: Room, openings: Opening[], attachments: Attachment[], walls: WallTypePatch[] = []) {
  const p = project.value;
  const f = floor.value;
  if (!p || !f || !editing.value) return;
  for (const w of walls) {
    const target = f.rooms.find((r) => r.id === w.roomId)?.walls[w.wallIndex];
    if (!target) continue;
    if (w.kind === 'exterior') target.kind = 'exterior';
    else delete target.kind;
    if (w.loadBearing) target.loadBearing = true;
    else delete target.loadBearing;
    if (w.status && w.status !== 'existing') target.status = w.status;
    else delete target.status;
  }
  const i = f.rooms.findIndex((r) => r.id === room.id);
  if (i >= 0) f.rooms[i] = room;
  else f.rooms.push(room);
  f.openings = f.openings.filter((o) => o.roomId !== room.id).concat(openings);
  p.attachments = p.attachments.filter((a) => !a.linkedTo.includes(room.id)).concat(attachments);
  const wasNew = editing.value.isNew;
  editing.value = null;
  selectedId.value = room.id;
  if (wasNew) {
    fitToken.value++;
    setMode('layout'); // a new room usually needs placing next to the others
  }
}

/** Removes rooms with their doors, windows, photos and documents. */
function removeRooms(f: Floor, ids: string[]) {
  const p = project.value;
  if (!p) return;
  const gone = p.attachments.filter((a) => a.linkedTo.some((id) => ids.includes(id)));
  void deleteUnusedFiles(props.storage, p.id, gone.map((a) => fileIdOf(a.uri)).filter((x): x is string => !!x));
  p.attachments = p.attachments.filter((a) => !gone.includes(a));
  f.rooms = f.rooms.filter((r) => !ids.includes(r.id));
  f.openings = f.openings.filter((o) => !ids.includes(o.roomId));
}

function deleteRoom(room: Room) {
  const f = floor.value;
  const files = attachmentsOf(room.id).length;
  const extra = files ? ` and its ${files} photo${files === 1 ? '' : 's'}/document${files === 1 ? '' : 's'}` : '';
  if (!f || !confirm(`Delete "${room.name}", its doors and windows${extra}?`)) return;
  removeRooms(f, [room.id]);
  selectedId.value = null;
  editing.value = null;
}

function moveRoom(id: string, origin: Vec, rotation_deg: number) {
  const room = floor.value?.rooms.find((r) => r.id === id);
  if (!room || room.locked) return;
  room.origin = origin;
  room.rotation_deg = rotation_deg;
}

function moveOpening(id: string, wallIndex: number, offset_mm: number) {
  const op = floor.value?.openings.find((o) => o.id === id);
  if (!op) return;
  op.wallIndex = wallIndex;
  op.offset_mm = offset_mm;
}

function toggleLock(room: Room) {
  room.locked = !room.locked;
}

function selectFloor(id: string) {
  floorId.value = id;
  selectedId.value = null;
  note.value = null;
  fitToken.value++;
}

/** "📝 · 2 files" under the room name on the floor view. */
const badges = computed(() => {
  const out: Record<string, string> = {};
  for (const r of floor.value?.rooms ?? []) {
    const files = attachmentsOf(r.id).length;
    const parts = [r.locked ? '🔒' : '', r.notes?.trim() ? '📝' : '', files ? `📎 ${files}` : ''].filter(Boolean);
    if (parts.length) out[r.id] = parts.join('  ');
  }
  return out;
});

// ---- project & floors ---------------------------------------------------------

function renameProject() {
  if (readonly.value) return;
  const p = project.value;
  const name = p && prompt('Plan name', p.name);
  if (p && name?.trim()) p.name = name.trim();
}

function addFloor() {
  const p = project.value;
  if (!p) return;
  const name = prompt('Name of the new floor', `Floor ${p.floors.length}`);
  if (!name?.trim()) return;
  const f = newFloor(name.trim(), Math.max(...p.floors.map((x) => x.level), -1) + 1);
  p.floors.push(f);
  floorId.value = f.id;
  selectedId.value = null;
  fitToken.value++;
}

function renameFloor() {
  const f = floor.value;
  const name = f && prompt('Floor name', f.name);
  if (f && name?.trim()) f.name = name.trim();
}

function deleteFloor() {
  const p = project.value;
  const f = floor.value;
  if (!p || !f) return;
  if (p.floors.length === 1) {
    alert('A plan needs at least one floor.');
    return;
  }
  if (!confirm(`Delete "${f.name}" with all its rooms?`)) return;
  removeRooms(
    f,
    f.rooms.map((r) => r.id),
  );
  p.floors = p.floors.filter((x) => x.id !== f.id);
  floorId.value = p.floors[0].id;
  showMenu.value = false;
  fitToken.value++;
}


function setThickness(e: Event) {
  const p = project.value;
  const mm = parseLength((e.target as HTMLInputElement).value, 'cm');
  if (p && Number.isFinite(mm) && mm > 0) p.settings.defaultThickness_mm = mm;
}

function setHeadroom(e: Event) {
  const p = project.value;
  const mm = parseLength((e.target as HTMLInputElement).value, unit.value);
  if (p && Number.isFinite(mm) && mm > 0) p.settings.headroom_mm = mm;
}

function setHeight(e: Event) {
  const p = project.value;
  const mm = parseLength((e.target as HTMLInputElement).value, unit.value);
  if (p && Number.isFinite(mm) && mm > 0) p.settings.defaultHeight_mm = mm;
}
</script>

<template>
  <div v-if="project && floor" class="app-screen" :data-mode="mode">
    <header class="topbar slim">
      <button class="btn ghost" aria-label="Menu" title="Plans, floors and rooms" @click="showMenu = true">☰</button>
      <button class="title-block title-button" title="Plans, floors and rooms" @click="showMenu = true">
        <span class="floor-name">{{ floor.name }}</span>
        <small class="save-state" :class="saveState">
          {{ project.name }} · {{ saveText }}
        </small>
      </button>
      <span v-if="!readonly" class="desktop-only">
        <button class="btn ghost" aria-label="Undo (Ctrl+Z)" title="Undo (Ctrl+Z)" :disabled="!canUndo" @click="undo">↶</button>
        <button class="btn ghost" aria-label="Redo (Ctrl+Y)" title="Redo (Ctrl+Y)" :disabled="!canRedo" @click="redo">↷</button>
      </span>
      <button class="btn ghost" aria-label="Home options" title="Home options" @click="showOptions = true">⋯</button>
    </header>

    <main ref="wrap" class="canvas-wrap">
      <FloorCanvas
        ref="canvas"
        :ghosts="ghosts"
        :can-stack="project.floors.length > 1"
        @three-d="show3d = true"
        :rooms="floor.rooms"
        :openings="floor.openings"
        :unit="unit"
        :selected-id="selectedId"
        :fit-token="fitToken"
        :badges="badges"
        :view="project.settings.view"
        :headroom="project.settings.headroom_mm"
        :aligning="aligning"
        :mode="mode"
        :accent="accent"
        v-model:measuring="measuring"
        @select="onSelect"
        @move="moveRoom"
        @open="openRoom"
        @open-pin="openPin"
        @move-opening="moveOpening"
        @align-to="alignTo"
        @cancel-align="aligning = false"
        :electrical="elec"
        :floor-id="floorId"
        :point-id="pointId"
        :placing="placingBoard ? 'junction' : placingKind"
        :focus-circuit="activeCircuit"
        @select-point="onSelectPoint"
        :linking="linking"
        @place-point="placePoint"
        @move-point="movePoint"
        @move-board="moveBoard"
        :utilities="utils"
        :utility="utility"
        v-model:util-tool="utilTool"
        v-model:util-sel="utilSel"
        @util-place="utilPlace"
        @util-move-point="utilMovePoint"
        @util-add-run="utilAddRun"
        @util-move-corner="utilMoveCorner"
        @open-board="showBoards = true"
      />
      <ModeBar :mode="mode" :readonly="readonly" @update:mode="setMode" />
      <div v-if="looking" class="version-banner" @pointerdown.stop>
        <span>
          Looking at <strong>{{ looking.version.name }}</strong>
          ({{ new Date(looking.version.createdAt).toLocaleDateString('ar') }}) · read-only
        </span>
        <button v-if="!viewOnly" class="btn small" @click="restoreVersion(looking.version)">↺ Restore this</button>
        <button class="btn small primary" @click="backToLatest">Back to the latest</button>
      </div>
      <span v-else-if="readonly" class="mode-badge readonly-badge">View only</span>
      <span v-if="mode === 'layout'" class="mode-badge">Arranging</span>

      <div v-if="!floor.rooms.length" class="empty-hint">
        <p>No rooms on {{ floor.name }} yet.</p>
        <p>Tap <strong>✚</strong> then <strong>+ Room</strong> and type in the walls you measured.</p>
      </div>
      <p v-else-if="aligning" class="canvas-hint strong">
        Tap a wall of another room to line {{ selectedRoom?.name }} up with it · Esc or tap empty space to cancel
      </p>
      <p v-else-if="!selectedRoom && !measuring" class="canvas-hint" :class="{ top: mode === 'electrical' || mode === 'utilities' }">{{ hint }}</p>

      <NotePopup
        v-if="notePopup"
        :key="notePopup.pin.id"
        :pin="notePopup.pin"
        :number="notePopup.number"
        :room-name="notePopup.room.name"
        :attachments="notePopup.files"
        :storage="storage"
        :at="notePopup.at"
        :box="notePopup.box"
        :can-edit="!readonly"
        @edit="editRoom(notePopup.room, 'notes', notePopup.pin.id)"
        @close="note = null"
      />

      <!-- electrical: the selected point -->
      <template v-if="measuring" />
      <UtilityTools
        v-else-if="mode === 'utilities' && utils && !showDock && !(utilTool?.type === 'run')"
        :utilities="utils"
        v-model:utility="utility"
        v-model:tool="utilTool"
        v-model:sel="utilSel"
        :floor-id="floorId"
        :unit="unit"
        :readonly="readonly"
      />
      <template v-else-if="mode === 'utilities'" />
      <div v-else-if="mode === 'electrical' && selectedPoint && !showDock" class="elec-panel" @pointerdown.stop>
        <div class="panel-head">
          <svg class="sym-icon" viewBox="-16 -16 32 32" aria-hidden="true">
            <ElecSymbol :kind="selectedPoint.kind" :appliance="selectedPoint.appliance" :x="0" :y="0" :r="9" color="currentColor" paper="none" />
          </svg>
          <strong>{{ selectedPoint.label || pointInfo(selectedPoint.kind).label }}</strong>
          <small>{{ roomName(selectedPoint) ?? 'Not in a room' }}</small>
          <span class="spacer"></span>
          <button v-if="!readonly" class="btn ghost small" aria-label="Duplicate this point" title="Duplicate (Ctrl+D)" @click="duplicatePoint"><AppIcon name="copy" /></button>
          <button class="btn ghost small danger" aria-label="Delete this point" title="Delete (Del)" @click="deletePoint"><AppIcon name="trash" /></button>
          <button class="btn ghost small" aria-label="Close" title="Close (Esc)" @click="pointId = null">✕</button>
        </div>
        <div class="panel-grid">
          <label class="field">
            <span class="field-label">Symbol</span>
            <select v-model="selectedPoint.kind">
              <option v-for="k in POINT_KINDS" :key="k.id" :value="k.id">{{ k.label }}</option>
            </select>
          </label>
          <label class="field">
            <span class="field-label">Circuit</span>
            <select :value="selectedPoint.circuitId ?? ''" @change="selectedPoint.circuitId = ($event.target as HTMLSelectElement).value || undefined">
              <option value="">– none –</option>
              <option v-for="c in circuits" :key="c.id" :value="c.id">{{ c.code }} {{ c.name }}</option>
            </select>
          </label>
          <label v-if="selectedPoint.kind === 'appliance'" class="field">
            <span class="field-label">Appliance</span>
            <select v-model="selectedPoint.appliance">
              <option v-for="a in APPLIANCES" :key="a.id" :value="a.id">{{ a.label }}</option>
            </select>
          </label>
          <label class="field">
            <span class="field-label">Label</span>
            <input v-model="selectedPoint.label" placeholder="optional" />
          </label>
          <label class="field">
            <span class="field-label">Height (cm)</span>
            <input
              type="number"
              :value="selectedPoint.height_mm !== undefined ? selectedPoint.height_mm / 10 : ''"
              @change="selectedPoint.height_mm = Number(($event.target as HTMLInputElement).value) * 10 || undefined"
            />
          </label>
        </div>
        <div v-if="linkInfo" class="link-row" :class="{ on: linking === selectedPoint.id }">
          <span class="link-text">
            {{ linking === selectedPoint.id ? `Tap ${linkInfo.what} on the plan to link or unlink them` : linkInfo.text }}
          </span>
          <button
            class="btn small"
            :class="{ primary: linking === selectedPoint.id }"
            @click="linking = linking === selectedPoint.id ? null : selectedPoint.id"
          >
            {{ linking === selectedPoint.id ? 'Done' : `🔗 Link ${linkInfo.what}` }}
          </button>
        </div>
      </div>

      <!-- electrical: what to place, on which circuit -->
      <div v-else-if="mode === 'electrical' && !readonly && !showDock" class="elec-bar" @pointerdown.stop>
        <div class="elec-row">
          <select
            :value="activeCircuit ?? ''"
            class="circuit-select"
            :style="{ borderColor: circuits.find((c) => c.id === activeCircuit)?.color }"
            aria-label="New points go on circuit"
            @change="activeCircuit = ($event.target as HTMLSelectElement).value || null"
          >
            <option value="">No circuit (link later)</option>
            <option v-for="c in circuits" :key="c.id" :value="c.id">{{ c.code }} {{ c.name }}</option>
          </select>
          <button class="btn" title="Fuse boxes and circuits" @click="showBoards = true">Fuse box</button>
          <button class="btn" :class="{ warnbtn: elecErrors }" title="Eendraadschema (single-line diagram)" @click="showSchema = true">
            Diagram<small v-if="elecErrors" class="err-count">{{ elecErrors }}</small>
          </button>
        </div>
        <div class="elec-row symbols">
          <button
            v-for="k in POINT_KINDS"
            :key="k.id"
            class="btn sym"
            :class="{ on: placingKind === k.id }"
            :title="k.label"
            :aria-label="k.label"
            :aria-pressed="placingKind === k.id"
            @click="togglePlacing(k.id)"
          >
            <svg class="sym-icon" viewBox="-16 -16 32 32" aria-hidden="true">
              <ElecSymbol :kind="k.id" :x="k.id.startsWith('socket') ? -3 : 0" :y="0" :r="9" color="currentColor" paper="none" />
            </svg>
          </button>
        </div>
      </div>

      <div v-if="selectedRoom && !aligning && !notePopup && !showDock && !measuring && mode !== 'electrical' && mode !== 'utilities'" class="room-pill" @pointerdown.stop>
        <span v-if="readonly" class="pill-note">{{ selectedRoom.name }}</span>
        <button v-else class="btn primary pill-edit" title="Edit (Enter)" @click="editRoom(selectedRoom)">✎ {{ selectedRoom.name }}</button>
        <template v-if="mode === 'layout'">
          <template v-if="!selectedRoom.locked">
            <button class="btn" :disabled="floor.rooms.length < 2" aria-label="Line up with another room" title="Line up with a wall of another room (A)" @click="startAlign">⦦</button>
            <button class="btn angle" title="Type an exact angle (T)" @click="typeAngle">
              {{ (Math.round(selectedRoom.rotation_deg * 10) / 10).toFixed(1) }}°
            </button>
            <button class="btn" aria-label="Turn 90° right" title="Turn 90° right (R)" @click="turnSelected(90)">⟳</button>
          </template>
          <span v-else class="pill-note">🔒</span>
        </template>
        <button v-if="!readonly" class="btn" aria-label="More for this room" :aria-expanded="roomMenu" @click="roomMenu = !roomMenu">⋯</button>
        <div v-if="roomMenu" class="pill-menu" role="menu">
          <button class="menu-item" @click="toggleLock(selectedRoom), (roomMenu = false)">
            {{ selectedRoom.locked ? '🔓 Unlock (can be moved again)' : '🔒 Lock in place' }}
          </button>
          <button v-if="mode === 'layout' && !selectedRoom.locked" class="menu-item" @click="turnSelected(-90), (roomMenu = false)">
            ⟲ Turn 90° left
          </button>
          <button v-for="m in editModes" :key="m.id" class="menu-item" @click="editRoom(selectedRoom, m.editor)">
            {{ m.icon }} Edit {{ m.label.toLowerCase() }}
          </button>
          <button class="menu-item danger" @click="deleteRoom(selectedRoom)"><AppIcon name="trash" /> Delete room</button>
        </div>
      </div>

      <FloatingDock
        v-model:open="showDock"
        :floors="project.floors"
        :floor-id="floorId"
        :can-undo="canUndo"
        :can-redo="canRedo"
        :can-add="!readonly"
        :readonly="readonly"
        @add-room="addRoom"
        @fit="fitToken++"
        @undo="undo"
        @redo="redo"
        @floor="selectFloor"
        @add-floor="addFloor"
      />
    </main>

    <!-- ☰ plans, floors, rooms -->
    <div v-if="showMenu" class="backdrop drawer-backdrop" @click.self="showMenu = false">
      <aside class="drawer">
        <div class="drawer-head">
          <strong>{{ project.name }}</strong>
          <button class="btn ghost small" aria-label="Close" @click="showMenu = false">✕</button>
        </div>
        <button class="menu-item" @click="emit('back')">‹ All plans</button>
        <h3>Floors</h3>
        <button
          v-for="f in project.floors"
          :key="f.id"
          class="menu-item"
          :class="{ on: f.id === floorId }"
          @click="selectFloor(f.id), (showMenu = false)"
        >
          {{ f.name }} <small>{{ f.rooms.length }} room{{ f.rooms.length === 1 ? '' : 's' }}</small>
        </button>
        <div class="row-actions">
          <button class="btn small" @click="(showMenu = false), addFloor()">+ Floor</button>
          <button class="btn small" @click="renameFloor">Rename</button>
          <button class="btn small danger" @click="deleteFloor">Delete</button>
        </div>
        <h3>Rooms on {{ floor.name }}</h3>
        <p v-if="!floor.rooms.length" class="hint">None yet.</p>
        <button
          v-for="r in floor.rooms"
          :key="r.id"
          class="menu-item"
          :class="{ on: r.id === selectedId }"
          @click="(selectedId = r.id), (showMenu = false)"
        >
          {{ r.locked ? '🔒 ' : '' }}{{ r.name }}
          <small>{{ areaText(r) }}</small>
        </button>
      </aside>
    </div>

    <!-- ⋯ home options -->
    <div v-if="showOptions" class="backdrop" @click.self="showOptions = false">
      <div class="dialog">
        <h2>{{ project.name }}</h2>
        <section>
          <div class="row-actions">
            <button class="btn primary" @click="(showOptions = false), (showExport = true)">Export… (PDF, picture, file)</button>
            <button class="btn" @click="(showOptions = false), (showQuantities = true)">📏 Quantities…</button>
            <button class="btn" @click="(showOptions = false), (showVersions = true)">🕘 Versions…</button>
            <button v-if="isOwner" class="btn" @click="(showOptions = false), (showShare = true)">👥 Share…</button>
            <button v-if="!readonly" class="btn" @click="renameProject">Rename</button>
            <button class="btn kbd-only" @click="(showOptions = false), (showHelp = true)">⌨ Shortcuts</button>
          </div>
        </section>
        <section v-if="!readonly">
          <h3>Settings</h3>
          <div class="row-actions">
            <label class="field">
              <span class="field-label">Units</span>
              <select v-model="project.settings.unit">
                <option value="m">metres (3.456)</option>
                <option value="cm">centimetres (345.6)</option>
                <option value="mm">millimetres (3456)</option>
              </select>
            </label>
            <label class="field">
              <span class="field-label">New walls (cm)</span>
              <input
                type="text"
                inputmode="decimal"
                :value="formatInput(project.settings.defaultThickness_mm, 'cm')"
                @change="setThickness"
              />
            </label>
            <label class="field">
              <span class="field-label">New rooms’ height ({{ unit }})</span>
              <input
                type="text"
                inputmode="decimal"
                :value="formatInput(project.settings.defaultHeight_mm ?? 2600, unit)"
                @change="setHeight"
              />
            </label>
            <label class="field" title="Under sloped ceilings, floor with less free height than this is not counted as usable">
              <span class="field-label">Usable headroom ({{ unit }})</span>
              <input
                type="text"
                inputmode="decimal"
                :value="formatInput(project.settings.headroom_mm ?? HEADROOM_MM, unit)"
                @change="setHeadroom"
              />
            </label>
          </div>
        </section>
        <div class="row-actions end">
          <button class="btn" @click="showOptions = false">Close</button>
        </div>
      </div>
    </div>

    <ShareDialog
      v-if="showShare && isOwner"
      :home-id="project.id"
      :name="project.name"
      :rest="storage as RestAdapter"
      @close="showShare = false"
    />

    <BoardEditor
      v-if="showBoards && elec"
      :electrical="elec"
      :room-name="roomName"
      @close="showBoards = false"
      @place-board="placeBoardOnPlan"
      @schema="(showBoards = false), (showSchema = true)"
    />
    <EendraadschemaView
      v-if="showSchema && elec"
      :project="project"
      @close="showSchema = false"
      @boards="(showSchema = false), (showBoards = true)"
    />

    <VersionsDialog
      v-if="showVersions"
      :project="looking ? (JSON.parse(looking.latest) as Project) : project"
      :storage="storage"
      :readonly="viewOnly"
      @look="lookAt"
      @restore="restoreVersion"
      @close="showVersions = false"
    />

    <div v-if="draftChoice" class="backdrop">
      <div class="dialog draft-dialog">
        <h2>Changes that were not saved</h2>
        <p>
          This device has changes to <b>{{ project.name }}</b> from {{ when(draftChoice.draft.savedAt) }} that never
          reached your account, for example because you were logged out.
        </p>
        <p class="hint">
          Version in your account: last saved {{ when(draftChoice.server.updatedAt) }}. The version you don't pick is
          kept as an automatic version, so you can still open it later under Versions.
        </p>
        <p v-if="draftChoice.server.updatedAt > draftChoice.draft.savedAt" class="warn">
          The version in your account was saved after these changes, maybe on another device.
        </p>
        <div class="row-actions end">
          <button class="btn" :disabled="draftBusy" @click="useServer">Use the version in your account</button>
          <button class="btn primary" :disabled="draftBusy" @click="useDraft">Use the changes on this device</button>
        </div>
      </div>
    </div>

    <QuantitiesView v-if="showQuantities" :project="project" @close="showQuantities = false" />

    <Plan3D v-if="show3d" :project="project" :floor-id="floor.id" @close="show3d = false" />

    <ShortcutsHelp v-if="showHelp" context="floor" @close="showHelp = false" />

    <ExportDialog
      v-if="showExport"
      :project="project"
      :floor="floor"
      :storage="storage"
      @close="showExport = false"
    />

    <RoomEditor
      v-if="editing"
      :key="editing.room.id"
      :room="editing.room"
      :openings="floor.openings.filter((o) => o.roomId === editing!.room.id)"
      :attachments="attachmentsOf(editing.room.id)"
      :storage="storage"
      :project-id="project.id"
      :unit="unit"
      :default-thickness="project.settings.defaultThickness_mm"
      :default-height="project.settings.defaultHeight_mm ?? 2600"
      :headroom="project.settings.headroom_mm ?? HEADROOM_MM"
      :neighbours="floor.rooms.filter((r) => r.id !== editing!.room.id)"
      :view="project.settings.view"
      :initial-mode="editing.mode"
      :initial-pin="editing.pin"
      :is-new="editing.isNew"
      :accent="accent"
      @save="saveRoom"
      @cancel="editing = null"
      @delete="deleteRoom(editing.room)"
    />
  </div>
  <div v-else class="app-screen loading">Loading…</div>
</template>
