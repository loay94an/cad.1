<script setup lang="ts">
/**
 * The floor view: pan with one finger, pinch or scroll to zoom, double-tap a
 * room to edit it, tap a note dot to read it. In Layout mode ("arranging"),
 * drag a room to move it (it snaps to walls, unless locked), drag the ⟳ handle
 * to turn it, and drag doors and windows along the walls.
 */
import { computed, ref, watch } from 'vue';
import { DEFAULT_VIEW, type LengthUnit, type Opening, type Room, type ViewSettings } from '../model/schema';
import {
  boundsOf,
  grabOffset,
  nearestWall,
  placeOpeningAt,
  rotateRoomAbout,
  roomGeometry,
  snapRoom,
  snapRotation,
} from '../geometry/floor';
import { add, angleDeg, centroid, sub, type Vec } from '../geometry/vec';
import { type PressHandler, usePanZoom, useStoredFlag } from '../composables/usePanZoom';
import { useDragKeys } from '../composables/useDragKeys';
import { type Seg, pointClearances, snapPoint } from '../geometry/snap';
import SnapOverlay from './SnapOverlay.vue';
import PlanContent from './PlanContent.vue';
import ViewMenu from './ViewMenu.vue';
import ZoomControls from './ZoomControls.vue';
import { PLAN } from './planStyle';
import type { AppMode } from './modes';
import ElectricalLayer from './ElectricalLayer.vue';
import { type Electrical, type PointKind, circuitCodes } from '../model/electrical';
import MeasureLayer from './MeasureLayer.vue';
import GhostFloor from './GhostFloor.vue';
import UtilityLayer from './UtilityLayer.vue';
import { type UtilSel, type UtilTool, type Utilities, type UtilityId, runKind, snapRunPoint, utilityInfo } from '../model/utilities';
import { area_m2, snapMeasure, totalLength } from '../geometry/measure';
import { formatLength } from '../units';

const props = defineProps<{
  rooms: Room[];
  openings: Opening[];
  unit: LengthUnit;
  selectedId: string | null;
  fitToken: number;
  badges?: Record<string, string>;
  view?: ViewSettings;
  /** Usable free height under sloped ceilings (mm). */
  headroom?: number;
  /** Waiting for the user to tap a wall to line the selected room up with. */
  aligning?: boolean;
  /** Layout mode: rooms, doors and windows can be moved. */
  mode?: AppMode;
  accent?: string;
  /** Electrical points and boards of this floor. */
  electrical?: Electrical;
  floorId?: string;
  pointId?: string | null;
  /** Electrical mode: the next tap places this kind of point. */
  placing?: PointKind | null;
  focusCircuit?: string | null;
  /** Linking a switch and its lights: taps on points toggle links. */
  linking?: string | null;
  /** The measuring tape is out: taps add points instead of selecting. */
  measuring?: boolean;
  /** Other floors drawn through this one as outlines. */
  ghosts?: { key: string; rooms: Room[]; color: string; label: string }[];
  /** The house has more than one floor: offer the outlines in the Show menu. */
  canStack?: boolean;
  /** Water, heating, …: points and pipes of this floor, the one being worked on, the tool and the selection. */
  utilities?: Utilities;
  utility?: UtilityId;
  utilTool?: UtilTool | null;
  utilSel?: UtilSel | null;
}>();
const emit = defineEmits<{
  select: [id: string | null];
  move: [id: string, origin: Vec, rotation_deg: number];
  /** Double-tap on a room. */
  open: [id: string];
  /** `at`: where the dot was tapped, in pixels inside the canvas. */
  openPin: [roomId: string, pinId: string, at: { x: number; y: number }];
  alignTo: [roomId: string, wallIndex: number];
  moveOpening: [id: string, wallIndex: number, offset_mm: number];
  cancelAlign: [];
  selectPoint: [id: string | null];
  placePoint: [x: number, y: number];
  movePoint: [id: string, x: number, y: number];
  moveBoard: [id: string, x: number, y: number];
  openBoard: [id: string];
  'update:measuring': [on: boolean];
  threeD: [];
  'update:utilTool': [t: UtilTool | null];
  'update:utilSel': [s: UtilSel | null];
  utilPlace: [x: number, y: number];
  utilMovePoint: [id: string, x: number, y: number];
  utilAddRun: [kind: string, path: Vec[]];
  utilMoveCorner: [runId: string, index: number, x: number, y: number];
}>();

const view = computed(() => props.view ?? DEFAULT_VIEW);
const arranging = computed(() => props.mode === 'layout');
const accent = computed(() => props.accent ?? PLAN.accent);
const wiring = computed(() => props.mode === 'electrical');

// ---- electrical points ----
const ptDrag = ref<{ id: string; x: number; y: number; board?: boolean } | null>(null);
const codes = computed(() => (props.electrical ? circuitCodes(props.electrical) : new Map<string, string>()));
/** 👁 Show → Electrical decides, in every mode (switching to Electrical mode turns it on). */
const showElec = computed(() => !!props.electrical && view.value.installations);
const floorPoints = computed(() =>
  (props.electrical?.points ?? [])
    .filter((p) => p.floorId === props.floorId)
    .map((p) => (ptDrag.value && !ptDrag.value.board && ptDrag.value.id === p.id ? { ...p, x_mm: ptDrag.value.x, y_mm: ptDrag.value.y } : p)),
);
const floorBoards = computed(() =>
  (props.electrical?.boards ?? [])
    .filter((b) => b.location?.floorId === props.floorId)
    .map((b) =>
      ptDrag.value?.board && ptDrag.value.id === b.id
        ? { ...b, location: { ...b.location!, x_mm: ptDrag.value.x, y_mm: ptDrag.value.y } }
        : b,
    ),
);
/** Symbols stay readable when zoomed out. */
const symbolR = computed(() => Math.max(80, 7 * pz.view.value.s));

// ---- lining up points (electrical and utilities) ----
const pointGuides = ref<Seg[]>([]);
/** Alt held: distances from the point to the walls. Escape: cancel a drag. */
const altHeld = useDragKeys(
  () => pz.cancelDrag(),
  () => wiring.value || plumbing.value,
);

/** Inside faces of the walls of the closed rooms on this floor. */
const floorWalls = computed<Seg[]>(() =>
  props.rooms.flatMap((r) => {
    const g = roomGeometry(r);
    if (!g.solved.closed) return [];
    const m = g.inner.length;
    return g.inner.map((a, k) => [a, g.inner[(k + 1) % m]] as Seg);
  }),
);

/** What a dragged point can line up with: the other points and fuse boxes on this floor, and the room corners. */
function anchors(skip: string): Vec[] {
  const here = <T extends { floorId: string; id: string }>(list: T[] | undefined) =>
    (list ?? []).filter((p) => p.floorId === props.floorId && p.id !== skip);
  return [
    ...here(props.electrical?.points).map((p) => ({ x: p.x_mm, y: p.y_mm })),
    ...(props.electrical?.boards ?? [])
      .filter((b) => b.id !== skip && b.location?.floorId === props.floorId)
      .map((b) => ({ x: b.location!.x_mm, y: b.location!.y_mm })),
    ...here(props.utilities?.points).map((p) => ({ x: p.x_mm, y: p.y_mm })),
    ...props.rooms.flatMap((r) => roomGeometry(r).inner),
  ];
}

/**
 * Where a dragged point goes: onto a nearby wall and lined up with other
 * points (Ctrl or Cmd: anywhere), Shift: only across or only up and down.
 */
function dragPoint(start: Vec, world: Vec, w: Vec, e: PointerEvent, others: Vec[]): Vec {
  altHeld.value = e.altKey;
  const shift = sub(w, world);
  const axis = !e.shiftKey ? null : Math.abs(shift.x) >= Math.abs(shift.y) ? 'x' : 'y';
  if (axis === 'x') shift.y = 0;
  if (axis === 'y') shift.x = 0;
  let p = add(start, shift);
  pointGuides.value = [];
  if (!(e.ctrlKey || e.metaKey)) {
    const s = snapPoint(p, others, floorWalls.value, 8 * pz.view.value.s);
    p = axis === 'x' ? { x: s.p.x, y: p.y } : axis === 'y' ? { x: p.x, y: s.p.y } : s.p;
    pointGuides.value = axis ? [] : s.guides;
  }
  if (axis) {
    const far = 100_000;
    pointGuides.value.push(
      axis === 'x' ? [{ x: start.x - far, y: start.y }, { x: start.x + far, y: start.y }] : [{ x: start.x, y: start.y - far }, { x: start.x, y: start.y + far }],
    );
  }
  return { x: Math.round(p.x), y: Math.round(p.y) };
}

/** Alt: distances from the dragged or selected point to the walls. */
const pointDistances = computed(() => {
  if (!altHeld.value) return [];
  let p: Vec | undefined;
  if (wiring.value) {
    const d = ptDrag.value;
    const q = props.electrical?.points.find((x) => x.id === props.pointId);
    p = d ? { x: d.x, y: d.y } : q && { x: q.x_mm, y: q.y_mm };
  } else if (plumbing.value) {
    const d = uDrag.value;
    const sel = props.utilSel;
    const q = sel?.type === 'point' ? props.utilities?.points.find((x) => x.id === sel.id) : undefined;
    p = d?.type === 'point' ? { x: d.x, y: d.y } : q && { x: q.x_mm, y: q.y_mm };
  }
  return p ? pointClearances(p, floorWalls.value) : [];
});

function pressElectrical(e: PointerEvent, world: Vec): PressHandler | null {
  const target = e.target as Element;
  if (props.placing) return { end: (moved) => !moved && emit('placePoint', world.x, world.y) };
  const ptEl = target.closest('[data-point],[data-board]');
  if (ptEl) {
    const isBoard = ptEl.hasAttribute('data-board');
    const id = ptEl.getAttribute(isBoard ? 'data-board' : 'data-point')!;
    const start = isBoard
      ? props.electrical!.boards.find((b) => b.id === id)!.location!
      : props.electrical!.points.find((p) => p.id === id)!;
    if (!isBoard) emit('selectPoint', id);
    const others = anchors(id);
    const from = { x: start.x_mm, y: start.y_mm };
    return {
      move(w, ev) {
        ptDrag.value = { id, ...dragPoint(from, world, w, ev, others), board: isBoard };
      },
      end(moved) {
        const d = ptDrag.value;
        if (moved && d && isBoard) emit('moveBoard', id, d.x, d.y);
        else if (moved && d) emit('movePoint', id, d.x, d.y);
        else if (!moved && isBoard) emit('openBoard', id);
        ptDrag.value = null;
        pointGuides.value = [];
      },
      cancel() {
        ptDrag.value = null;
        pointGuides.value = [];
      },
    };
  }
  return { end: (moved) => !moved && emit('selectPoint', null) };
}
// ---- utilities (water, heating, …) ----
const plumbing = computed(() => props.mode === 'utilities');
const showUtil = computed(() => !!props.utilities && view.value.utilities !== false);
const uDrag = ref<{ type: 'point' | 'corner'; id: string; index: number; x: number; y: number } | null>(null);
const floorUtilPoints = computed(() =>
  (props.utilities?.points ?? [])
    .filter((p) => p.floorId === props.floorId)
    .map((p) => (uDrag.value?.type === 'point' && uDrag.value.id === p.id ? { ...p, x_mm: uDrag.value.x, y_mm: uDrag.value.y } : p)),
);
const floorUtilRuns = computed(() =>
  (props.utilities?.runs ?? [])
    .filter((r) => r.floorId === props.floorId)
    .map((r) => {
      const d = uDrag.value;
      return d?.type === 'corner' && d.id === r.id ? { ...r, path: r.path.map((c, i) => (i === d.index ? { x: d.x, y: d.y } : c)) } : r;
    }),
);
/** The pipe being drawn: its corners so far. */
const draft = ref<Vec[]>([]);
const draftHover = ref<Vec | null>(null);
const snapU = (w: Vec, prev?: Vec) =>
  props.utilities && props.utility
    ? snapRunPoint(props.utilities, props.utility, props.floorId ?? '', w, prev, 14 * pz.view.value.s)
    : w;
const drawing = computed(() => plumbing.value && props.utilTool?.type === 'run');
const draftColor = computed(() => (props.utility && props.utilTool ? runKind(props.utility, props.utilTool.kind).color : '#000'));
const draftLength = computed(() => draft.value.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - draft.value[i].x, p.y - draft.value[i].y), 0));

function finishDraft(kind = props.utilTool?.kind) {
  if (draft.value.length > 1 && kind) emit('utilAddRun', kind, draft.value);
  draft.value = [];
  draftHover.value = null;
}
// Choosing another tool (or none) keeps what was drawn so far.
watch(
  () => props.utilTool,
  (_now, before) => finishDraft(before?.type === 'run' ? before.kind : undefined),
);
watch([() => props.utility, () => props.floorId, plumbing], () => (draft.value = []));

function pressUtility(e: PointerEvent, world: Vec): PressHandler | null {
  const target = e.target as Element;
  const tool = props.utilTool;
  if (tool?.type === 'point') return { end: (moved) => !moved && emit('utilPlace', world.x, world.y) };
  if (tool?.type === 'run') {
    return {
      end(moved) {
        if (moved) return; // that was panning
        const p = snapU(world, draft.value.at(-1));
        const last = draft.value.at(-1);
        // Tapping the last corner again ends the pipe.
        if (last && Math.hypot(p.x - last.x, p.y - last.y) < 14 * pz.view.value.s) finishDraft();
        else draft.value.push(p);
      },
    };
  }
  const corner = target.closest('[data-rv]');
  const runEl = target.closest('[data-run]');
  if (corner && runEl) {
    const id = runEl.getAttribute('data-run')!;
    const index = Number(corner.getAttribute('data-rv'));
    return {
      move: (w) => (uDrag.value = { type: 'corner', id, index, ...snapU(w) }),
      end(moved) {
        const d = uDrag.value;
        if (moved && d) emit('utilMoveCorner', id, index, d.x, d.y);
        uDrag.value = null;
      },
      cancel: () => (uDrag.value = null),
    };
  }
  const ptEl = target.closest('[data-upoint]');
  if (ptEl) {
    const id = ptEl.getAttribute('data-upoint')!;
    const start = props.utilities!.points.find((p) => p.id === id)!;
    emit('update:utilSel', { type: 'point', id });
    const others = anchors(id);
    const from = { x: start.x_mm, y: start.y_mm };
    return {
      move: (w, ev) => (uDrag.value = { type: 'point', id, index: 0, ...dragPoint(from, world, w, ev, others) }),
      end(moved) {
        const d = uDrag.value;
        if (moved && d) emit('utilMovePoint', id, d.x, d.y);
        uDrag.value = null;
        pointGuides.value = [];
      },
      cancel() {
        uDrag.value = null;
        pointGuides.value = [];
      },
    };
  }
  if (runEl) {
    const id = runEl.getAttribute('data-run')!;
    return { end: (moved) => !moved && emit('update:utilSel', { type: 'run', id }) };
  }
  return { end: (moved) => !moved && emit('update:utilSel', null) };
}

// ---- measuring tape ----
const mPts = ref<Vec[]>([]);
const mClosed = ref(false);
const mHover = ref<Vec | null>(null);
const snapM = (w: Vec) => snapMeasure(props.rooms.map(roomGeometry), w, 18 * pz.view.value.s).p;

function pressMeasure(e: PointerEvent, world: Vec): PressHandler {
  const el = (e.target as Element).closest('[data-mpt]');
  if (el) {
    // Drag a point to adjust it; tap the first point to close the shape (gives the area).
    const i = Number(el.getAttribute('data-mpt'));
    return {
      move: (w) => (mPts.value[i] = snapM(w)),
      end(moved) {
        if (!moved && i === 0 && mPts.value.length > 2) mClosed.value = true;
      },
    };
  }
  return {
    end(moved) {
      if (moved) return; // that was panning
      if (mClosed.value) clearMeasure();
      mPts.value.push(snapM(world));
    },
  };
}
function clearMeasure() {
  mPts.value = [];
  mClosed.value = false;
}
function undoMeasure() {
  if (mClosed.value) mClosed.value = false;
  else mPts.value.pop();
}
function hoverMeasure(e: PointerEvent) {
  draftHover.value =
    drawing.value && e.pointerType === 'mouse' && draft.value.length ? snapU(pz.toWorld(e.clientX, e.clientY), draft.value.at(-1)) : null;
  const on = props.measuring && e.pointerType === 'mouse' && mPts.value.length && !mClosed.value;
  mHover.value = on ? snapM(pz.toWorld(e.clientX, e.clientY)) : null;
}
watch(
  () => props.measuring,
  (on) => {
    if (!on) clearMeasure();
    mHover.value = null;
  },
);
const measureText = computed(() => {
  const n = mPts.value.length;
  if (n < 2) return null;
  const len = `${formatLength(totalLength(mPts.value, mClosed.value), props.unit)} ${props.unit}`;
  return { len, area: mClosed.value ? `${area_m2(mPts.value).toFixed(2)} m²` : '', parts: mClosed.value ? n : n - 1 };
});

const svg = ref<SVGSVGElement>();
const drag = ref<{
  roomId: string;
  origin: Vec;
  rotation_deg: number;
  guide: [Vec, Vec] | null;
  turning?: boolean;
  aligned?: boolean;
} | null>(null);
const opDrag = ref<{ id: string; wallIndex: number; offset_mm: number } | null>(null);
const displayOpenings = computed(() =>
  opDrag.value
    ? props.openings.map((o) =>
        o.id === opDrag.value!.id ? { ...o, wallIndex: opDrag.value!.wallIndex, offset_mm: opDrag.value!.offset_mm } : o,
      )
    : props.openings,
);
const { flag: autoZoom, set: setAutoZoom } = useStoredFlag('fp.autoZoom.floor', false);
const showView = ref(false);
let lastTap: { id: string; time: number } | null = null;

function tapRoom(id: string, moved: boolean) {
  if (moved) {
    lastTap = null;
    return;
  }
  const now = performance.now();
  if (lastTap && lastTap.id === id && now - lastTap.time < 450) {
    lastTap = null;
    emit('open', id);
  } else {
    lastTap = { id, time: now };
  }
}

function onPress(e: PointerEvent, world: Vec): PressHandler | null {
  const target = e.target as Element;
  if (props.measuring) return pressMeasure(e, world);
  if (wiring.value) return pressElectrical(e, world);
  if (plumbing.value) return pressUtility(e, world);

  if (props.aligning) {
    const hit = nearestWall(props.rooms, world, 30 * pz.view.value.s, props.selectedId ?? undefined);
    return {
      end: (moved) => {
        if (moved) return;
        if (hit) emit('alignTo', hit.roomId, hit.wallIndex);
        else emit('cancelAlign');
      },
    };
  }

  // The turn handle of the selected room.
  if (arranging.value && target.closest('[data-handle="rotate"]')) {
    const room = props.rooms.find((r) => r.id === props.selectedId);
    const g = room && roomGeometry(room);
    if (!room || !g?.solved.closed) return null;
    const pivot = centroid(g.inner);
    const startAngle = angleDeg(sub(world, pivot));
    return {
      move(w) {
        const raw = room.rotation_deg + angleDeg(sub(w, pivot)) - startAngle;
        const snap = snapRotation(props.rooms, room.id, raw);
        const next = rotateRoomAbout(room, snap.rotation_deg - room.rotation_deg, pivot);
        drag.value = { roomId: room.id, ...next, guide: null, turning: true, aligned: snap.aligned };
      },
      end(moved) {
        if (moved && drag.value) emit('move', drag.value.roomId, drag.value.origin, drag.value.rotation_deg);
        drag.value = null;
      },
      cancel: () => (drag.value = null),
    };
  }

  // Doors and windows of the selected room slide along its walls.
  const opEl = target.closest('[data-opening]');
  const op = opEl && props.openings.find((o) => o.id === opEl.getAttribute('data-opening'));
  const opRoom = op && props.rooms.find((r) => r.id === op.roomId);
  if (arranging.value && op && opRoom && !opRoom.locked) {
    const g = roomGeometry(opRoom);
    const grab = grabOffset(g, op, world);
    return {
      move(w) {
        const at = placeOpeningAt(g, op, w, grab);
        if (at) opDrag.value = { id: op.id, ...at };
      },
      end(moved) {
        if (moved && opDrag.value) emit('moveOpening', op.id, opDrag.value.wallIndex, opDrag.value.offset_mm);
        opDrag.value = null;
      },
      cancel: () => (opDrag.value = null),
    };
  }

  const pinEl = target.closest('[data-pin]');
  if (pinEl) {
    const roomId = pinEl.getAttribute('data-room')!;
    const pinId = pinEl.getAttribute('data-pin')!;
    const r = svg.value!.getBoundingClientRect();
    const at = { x: e.clientX - r.left, y: e.clientY - r.top };
    return { end: (moved) => !moved && emit('openPin', roomId, pinId, at) };
  }

  const id = target.closest('[data-room]')?.getAttribute('data-room');
  const room = id ? props.rooms.find((r) => r.id === id) : undefined;
  if (!room) return null;
  emit('select', room.id);
  // Outside Layout mode, or when locked, a room only selects; dragging over it pans the view.
  if (room.locked || !arranging.value) return { end: (moved) => tapRoom(room.id, moved) };
  const startOrigin = { ...room.origin };
  const rotation = room.rotation_deg;
  return {
    move(w) {
      const candidate = add(startOrigin, sub(w, world));
      drag.value = { roomId: room.id, ...snapRoom(props.rooms, room.id, candidate, rotation) };
    },
    end(moved) {
      if (moved && drag.value) emit('move', drag.value.roomId, drag.value.origin, drag.value.rotation_deg);
      drag.value = null;
      tapRoom(room.id, moved);
    },
    cancel: () => (drag.value = null),
  };
}

const pz = usePanZoom(svg, {
  onPress,
  onEmptyTap: () => (props.aligning ? emit('cancelAlign') : emit('select', null)),
  onReady: fit,
});

/** The parts of the canvas under the mode bar, the buttons on the right and the bar at the bottom. */
const inset = computed(() => ({ top: 52, right: 52, bottom: plumbing.value ? 166 : wiring.value ? 124 : 76, left: 4 }));

function fit() {
  const b = boundsOf(props.rooms.map(roomGeometry));
  if (b) pz.fitBounds(b, { pad: 0.05, minSpan: 3000, animate: pz.size.value.w > 0, inset: inset.value });
  else pz.setView({ cx: 2000, cy: 1500, s: Math.max(6000 / (pz.size.value.w || 1), 4000 / (pz.size.value.h || 1)) });
}
watch(() => props.fitToken, fit);

function zoomToSelected() {
  const room = props.rooms.find((r) => r.id === props.selectedId);
  const b = room && boundsOf([roomGeometry(room)]);
  if (b) pz.fitBounds(b, { pad: 0.1, minSpan: 2500, animate: true, inset: inset.value });
}
watch(
  () => props.selectedId,
  () => {
    if (autoZoom.value && props.selectedId && !drag.value) zoomToSelected();
  },
);

const grid = computed(() => {
  const vb = pz.viewBox.value;
  const step = pz.view.value.s < 15 ? 1000 : 5000;
  const xs: number[] = [];
  const ys: number[] = [];
  if (view.value.grid) {
    for (let x = Math.floor(vb.x / step) * step; x <= vb.x + vb.w; x += step) xs.push(x);
    for (let y = Math.floor(vb.y / step) * step; y <= vb.y + vb.h; y += step) ys.push(y);
  }
  return { xs, ys, vb };
});

const displayRooms = computed(() =>
  props.rooms.map((r) =>
    drag.value && r.id === drag.value.roomId
      ? { ...r, origin: drag.value.origin, rotation_deg: drag.value.rotation_deg }
      : r,
  ),
);

/** The ⟳ handle above the selected room, a fixed size on screen. */
const handle = computed(() => {
  const room = displayRooms.value.find((r) => r.id === props.selectedId);
  if (!room || room.locked || props.aligning || !arranging.value) return null;
  const g = roomGeometry(room);
  const b = boundsOf([g]);
  if (!g.solved.closed || !b) return null;
  const s = pz.view.value.s;
  const c = centroid(g.inner);
  const hy = b.minY - 46 * s;
  return {
    stemFrom: { x: c.x, y: b.minY - 4 * s },
    at: { x: c.x, y: hy },
    r: 17 * s,
    font: 20 * s,
    label: `${(Math.round(room.rotation_deg * 10) / 10).toFixed(1)}°`,
    s,
  };
});

/** Note dots stay readable when zoomed out. */
const pinRadius = computed(() => Math.max(120, 11 * pz.view.value.s));

function toggleAuto(v: boolean) {
  setAutoZoom(v);
  if (v && props.selectedId) zoomToSelected();
}

defineExpose({
  fit,
  zoomIn: () => pz.zoomBy(1 / 1.5),
  zoomOut: () => pz.zoomBy(1.5),
  toggleView: () => (showView.value = !showView.value),
});
</script>

<template>
  <div class="canvas-box" :class="{ aligning, arranging, placing: !!placing || measuring || (plumbing && !!utilTool) }">
    <svg
      ref="svg"
      class="floor-canvas"
      xmlns="http://www.w3.org/2000/svg"
      :viewBox="pz.viewBox.value.str"
      v-on="pz.handlers"
      @pointermove="hoverMeasure"
      @pointerleave="mHover = null"
    >
      <rect :x="grid.vb.x" :y="grid.vb.y" :width="grid.vb.w" :height="grid.vb.h" :fill="PLAN.paper" />
      <g :stroke="PLAN.grid" :stroke-width="pz.view.value.s">
        <line v-for="x in grid.xs" :key="'x' + x" :x1="x" :x2="x" :y1="grid.vb.y" :y2="grid.vb.y + grid.vb.h" />
        <line v-for="y in grid.ys" :key="'y' + y" :y1="y" :y2="y" :x1="grid.vb.x" :x2="grid.vb.x + grid.vb.w" />
      </g>
      <PlanContent
        :rooms="displayRooms"
        :openings="displayOpenings"
        :unit="unit"
        :selected-id="selectedId"
        :openings-room-id="arranging ? (rooms.find((r) => r.id === selectedId && !r.locked)?.id ?? null) : null"
        :accent="accent"
        :badges="badges"
        :show-dimensions="view.dimensions"
        :show-names="view.names"
        :show-angles="view.angles"
        :show-furniture="view.furniture || mode === 'furniture'"
        :show-pins="view.notes || mode === 'view'"
        :show-finishes="view.finishes"
        :headroom="headroom"
        :pin-radius="pinRadius"
      />
      <GhostFloor v-for="g in ghosts ?? []" :key="g.key" :rooms="g.rooms" :color="g.color" :label="g.label" />
      <ElectricalLayer
        v-if="showElec"
        :points="floorPoints"
        :boards="floorBoards"
        :codes="codes"
        :r="symbolR"
        :selected-id="pointId"
        :editable="wiring"
        :labels="wiring"
        :focus-circuit="wiring ? focusCircuit : null"
        :linking="wiring ? linking : null"
        :accent="accent"
      />
      <UtilityLayer
        v-if="showUtil"
        :points="floorUtilPoints"
        :runs="floorUtilRuns"
        :r="symbolR"
        :active="plumbing ? utility : null"
        :selected="plumbing ? utilSel : null"
        :editable="plumbing"
        :draft="drawing && draft.length ? { path: draft, color: draftColor, hover: draftHover } : null"
      />
      <MeasureLayer
        v-if="measuring"
        :points="mPts"
        :closed="mClosed"
        :hover="mHover"
        :unit="unit"
        :s="pz.view.value.s"
        color="#b91c8c"
      />
      <line
        v-if="drag?.guide"
        :x1="drag.guide[0].x"
        :y1="drag.guide[0].y"
        :x2="drag.guide[1].x"
        :y2="drag.guide[1].y"
        :stroke="accent"
        :stroke-width="pz.view.value.s * 4"
        stroke-linecap="round"
        pointer-events="none"
      />
      <g v-if="handle" data-handle="rotate" class="tap">
        <line
          :x1="handle.stemFrom.x"
          :y1="handle.stemFrom.y"
          :x2="handle.at.x"
          :y2="handle.at.y + handle.r"
          :stroke="accent"
          :stroke-width="handle.s * 2"
          pointer-events="none"
        />
        <circle :cx="handle.at.x" :cy="handle.at.y" :r="handle.r * 1.6" fill="#000" fill-opacity="0" />
        <circle :cx="handle.at.x" :cy="handle.at.y" :r="handle.r" :fill="drag?.aligned ? PLAN.ok : accent" />
        <text
          :x="handle.at.x"
          :y="handle.at.y + handle.font * 0.35"
          text-anchor="middle"
          :font-size="handle.font"
          fill="#fff"
          pointer-events="none"
        >
          ⟳
        </text>
        <text
          v-if="drag?.turning"
          :x="handle.at.x + handle.r * 1.6"
          :y="handle.at.y + handle.font * 0.35"
          :font-size="handle.font * 0.8"
          :fill="drag.aligned ? PLAN.ok : PLAN.label"
          font-weight="bold"
          pointer-events="none"
        >
          {{ handle.label }}{{ drag.aligned ? ' aligned' : '' }}
        </text>
      </g>
      <SnapOverlay
        v-if="wiring || plumbing"
        :guides="pointGuides"
        :clearances="pointDistances"
        :unit="unit"
        :px="pz.view.value.s"
        :accent="accent"
      />
    </svg>
    <ZoomControls
      :view-open="showView"
      fit-label="Show the whole floor"
      :measuring="!!measuring"
      three-d
      @three-d="emit('threeD')"
      @measure="emit('update:measuring', !measuring)"
      @zoom-in="pz.zoomBy(1 / 1.5)"
      @zoom-out="pz.zoomBy(1.5)"
      @fit="fit"
      @view="showView = !showView"
    />
    <ViewMenu
      v-if="showView && props.view"
      :view="props.view"
      :stack="canStack"
      :auto-zoom="autoZoom"
      @update:auto-zoom="toggleAuto"
      @close="showView = false"
    />
    <div v-if="drawing && !measuring && utility && utilTool" class="measure-bar draw-bar" role="status" @pointerdown.stop>
      <div class="measure-read">
        <strong :style="{ color: draftColor }">{{ runKind(utility, utilTool.kind).label }}</strong>
        <span v-if="draft.length > 1">{{ formatLength(draftLength, unit) }} {{ unit }}</span>
        <small class="measure-tip">
          {{ draft.length ? `Tap the next corner · tap the last one again to end the ${utilityInfo(utility).line}` : `Tap where the ${utilityInfo(utility).line} starts` }}
        </small>
      </div>
      <button class="btn small" aria-label="Remove the last corner" title="Remove the last corner" :disabled="!draft.length" @click="draft.pop()">↶</button>
      <button class="btn small primary" @click="emit('update:utilTool', null)">Done</button>
    </div>
    <div v-if="measuring" class="measure-bar" role="status" @pointerdown.stop>
      <div class="measure-read">
        <template v-if="measureText">
          <strong>{{ measureText.len }}</strong>
          <span v-if="measureText.area">· {{ measureText.area }}</span>
          <small v-else-if="measureText.parts > 1">{{ measureText.parts }} parts</small>
        </template>
        <small v-else>{{ mPts.length ? 'Tap the next point' : 'Tap a point to start. It snaps to corners and walls.' }}</small>
        <small v-if="mPts.length > 2 && !mClosed" class="measure-tip">Tap the first point for the area</small>
      </div>
      <button class="btn small" aria-label="Remove the last point" title="Remove the last point" :disabled="!mPts.length" @click="undoMeasure">↶</button>
      <button class="btn small" :disabled="!mPts.length" @click="clearMeasure">Clear</button>
      <button class="btn small primary" @click="emit('update:measuring', false)">Done</button>
    </div>
  </div>
</template>
