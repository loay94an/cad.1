<script setup lang="ts">
/**
 * The drawing at the top of the room editor. Pan, pinch and zoom like the
 * floor view; what a tap does depends on the editor mode.
 */
import { computed, ref, watch } from 'vue';
import { DEFAULT_VIEW, type LengthUnit, type Opening, type Room, type ViewSettings } from '../model/schema';
import { type Bounds, boundsOf, grabOffset, openingGeometry, placeOpeningAt, roomGeometry } from '../geometry/floor';
import { add, rotate, sub, type Vec } from '../geometry/vec';
import { type Box, type Seg, clearances, snapBox } from '../geometry/snap';
import { groupOf } from '../model/clipboard';
import { useDragKeys } from '../composables/useDragKeys';
import { type PressHandler, usePanZoom, useStoredFlag } from '../composables/usePanZoom';
import PlanContent from './PlanContent.vue';
import SnapOverlay from './SnapOverlay.vue';
import ViewMenu from './ViewMenu.vue';
import ZoomControls from './ZoomControls.vue';
import { PLAN } from './planStyle';
import type { EditorMode, Selection } from './editorTypes';

const props = defineProps<{
  room: Room;
  openings: Opening[];
  unit: LengthUnit;
  mode: EditorMode;
  selection: Selection | null;
  view?: ViewSettings;
  headroom?: number;
  /** Notes mode: the next tap on the drawing places a new note dot. */
  placing?: boolean;
  accent?: string;
}>();
const emit = defineEmits<{
  /** `tapped`: the user tapped it in the drawing (so the matching field should get focus). */
  select: [sel: Selection | null, tapped: boolean];
  moveFurniture: [id: string, x: number, y: number];
  movePin: [id: string, x: number, y: number];
  moveStair: [id: string, x: number, y: number];
  moveFixed: [id: string, x: number, y: number];
  moveOpening: [id: string, wallIndex: number, offset_mm: number];
  place: [x: number, y: number];
}>();

const view = computed(() => props.view ?? DEFAULT_VIEW);
const svg = ref<SVGSVGElement>();
const showView = ref(false);
const { flag: autoZoom, set: setAutoZoom } = useStoredFlag('fp.autoZoom.room', true);
const geom = computed(() => roomGeometry(props.room));

function selectionFor(el: Element): Selection | null {
  const get = (a: string) => el.getAttribute(a);
  if (get('data-pin') !== null) return { kind: 'pin', id: get('data-pin')! };
  if (get('data-stair') !== null) return { kind: 'stair', id: get('data-stair')! };
  if (get('data-fixed') !== null) return { kind: 'fixed', id: get('data-fixed')! };
  if (get('data-furniture') !== null) return { kind: 'furniture', id: get('data-furniture')! };
  if (get('data-corner') !== null) return { kind: 'corner', index: Number(get('data-corner')) };
  if (get('data-opening') !== null) return { kind: 'opening', id: get('data-opening')! };
  if (get('data-diagonal') !== null) return { kind: 'diagonal', index: Number(get('data-diagonal')) };
  if (get('data-wall') !== null) return { kind: 'wall', index: Number(get('data-wall')) };
  return null;
}

/** Things you can drag in a mode: their start position and where moves go. */
function draggable(sel: Selection): { start: Vec; to: (x: number, y: number) => void } | null {
  if (sel.kind === 'stair' && props.mode === 'layout') {
    const s = props.room.stairs?.find((x) => x.id === sel.id);
    return s ? { start: { x: s.x_mm, y: s.y_mm }, to: (x, y) => emit('moveStair', sel.id, x, y) } : null;
  }
  if (sel.kind === 'fixed' && props.mode === 'layout') {
    const f = props.room.fixed?.find((x) => x.id === sel.id);
    return f ? { start: { x: f.x_mm, y: f.y_mm }, to: (x, y) => emit('moveFixed', sel.id, x, y) } : null;
  }
  if (sel.kind === 'pin' && props.mode === 'notes') {
    const p = props.room.pins?.find((x) => x.id === sel.id);
    return p ? { start: { x: p.x_mm, y: p.y_mm }, to: (x, y) => emit('movePin', sel.id, x, y) } : null;
  }
  return null;
}

function keyOf(s: Selection): string {
  return `${s.kind}:${'id' in s ? s.id : s.index}`;
}

/** Selecting something you're about to drag must not zoom: the view would jump under your finger. */
let skipZoom = false;
function selectForDrag(sel: Selection) {
  if (keyOf(sel) !== selKey.value) skipZoom = true;
  emit('select', sel, false);
}

function onPress(e: PointerEvent, world: Vec): PressHandler | null {
  if (props.placing) return { end: (moved) => !moved && place(e) }; // the tap places a note
  const el = (e.target as Element).closest(
    '[data-pin],[data-furniture],[data-corner],[data-opening],[data-diagonal],[data-wall],[data-stair],[data-fixed]',
  );
  const sel = el && selectionFor(el);
  if (!sel) return null;
  if (sel.kind === 'opening' && props.mode === 'layout') {
    const op = props.openings.find((o) => o.id === sel.id);
    if (op) {
      selectForDrag(sel);
      const grab = grabOffset(geom.value, op, world);
      const was = { wallIndex: op.wallIndex, offset: op.offset_mm };
      return {
        cancel: () => emit('moveOpening', sel.id, was.wallIndex, was.offset),
        move: (w) => {
          const at = placeOpeningAt(geom.value, op, w, grab);
          if (at) emit('moveOpening', sel.id, at.wallIndex, at.offset_mm);
        },
        end: (moved) => !moved && emit('select', sel, true),
      };
    }
  }
  if (sel.kind === 'furniture' && props.mode === 'furniture') {
    const h = furnitureDrag(sel.id, world);
    if (h) {
      selectForDrag(sel);
      return h;
    }
  }
  const d = draggable(sel);
  if (d) {
    selectForDrag(sel);
    // The preview room sits at 0,0 unrotated, so world = room coordinates.
    return {
      move: (w) => d.to(d.start.x + w.x - world.x, d.start.y + w.y - world.y),
      cancel: () => d.to(d.start.x, d.start.y),
      end: (moved) => !moved && emit('select', sel, true),
    };
  }
  // Walls, corners, …: select on tap, so a drag that starts on a wall still pans.
  return { end: (moved) => !moved && emit('select', sel, true) };
}

// ---- furniture: lining up and distances --------------------------------------------

/** Alt held: show the distances from the selected piece to the walls and other pieces. Escape: cancel a drag. */
const altHeld = useDragKeys(
  () => pz.cancelDrag(),
  () => props.mode === 'furniture',
);
const guides = ref<Seg[]>([]);

/** Inside faces of the walls. */
const wallSegs = computed<Seg[]>(() => {
  const g = geom.value;
  const m = g.inner.length;
  const count = g.solved.closed ? m : m - 1;
  return Array.from({ length: Math.max(0, count) }, (_, k) => [g.inner[k], g.inner[(k + 1) % m]] as Seg);
});

const boxOf = (f: { x_mm: number; y_mm: number; width_mm: number; depth_mm: number; rotation_deg: number }): Box => ({
  x: f.x_mm,
  y: f.y_mm,
  w: f.width_mm,
  d: f.depth_mm,
  angle: f.rotation_deg,
});

/** Everything a piece can line up with, apart from the pieces in `skip`. */
function obstacles(skip: Set<string>): Box[] {
  return [
    ...(props.room.furniture ?? []).filter((f) => !skip.has(f.id)).map(boxOf),
    ...(props.room.fixed ?? []).map(boxOf),
    ...(props.room.stairs ?? []).map((s) => boxOf({ ...s, width_mm: s.length_mm, depth_mm: s.width_mm })),
  ];
}

/**
 * Dragging furniture: its group comes along, and it lines up with walls and
 * other pieces nearby (Ctrl or Cmd: put it anywhere). Shift keeps it on one
 * line: across or up and down, whichever way you dragged furthest.
 */
function furnitureDrag(id: string, world: Vec): PressHandler | null {
  const list = props.room.furniture ?? [];
  const f = list.find((x) => x.id === id);
  if (!f) return null;
  const members = groupOf(list, f);
  const starts = members.map((m) => ({ id: m.id, x: m.x_mm, y: m.y_mm }));
  const others = obstacles(new Set(members.map((m) => m.id)));
  const base = boxOf(f);
  return {
    move: (w, ev) => {
      altHeld.value = ev.altKey;
      let shift = sub(w, world);
      /** Shift: the one direction it may move in. */
      const axis = !ev.shiftKey ? null : Math.abs(shift.x) >= Math.abs(shift.y) ? 'x' : 'y';
      if (axis === 'x') shift.y = 0;
      if (axis === 'y') shift.x = 0;
      guides.value = [];
      if (!(ev.ctrlKey || ev.metaKey)) {
        const s = snapBox({ ...base, x: base.x + shift.x, y: base.y + shift.y }, others, wallSegs.value, 8 * pz.view.value.s);
        // Locked: line up only along the line it's on.
        shift = add(shift, { x: axis === 'y' ? 0 : s.delta.x, y: axis === 'x' ? 0 : s.delta.y });
        guides.value = s.guides;
      }
      if (axis) {
        // The line it moves along, through where it started.
        const far = 100_000;
        guides.value.push(
          axis === 'x'
            ? [{ x: base.x - far, y: base.y }, { x: base.x + far, y: base.y }]
            : [{ x: base.x, y: base.y - far }, { x: base.x, y: base.y + far }],
        );
      }
      for (const m of starts) emit('moveFurniture', m.id, m.x + shift.x, m.y + shift.y);
    },
    end: (moved) => {
      guides.value = [];
      if (!moved) emit('select', { kind: 'furniture', id }, true);
    },
    cancel: () => {
      guides.value = [];
      for (const m of starts) emit('moveFurniture', m.id, m.x, m.y);
    },
  };
}

const clearanceItems = computed(() => {
  const s = props.selection;
  if (!altHeld.value || props.mode !== 'furniture' || s?.kind !== 'furniture') return [];
  const f = props.room.furniture?.find((x) => x.id === s.id);
  return f ? clearances(boxOf(f), obstacles(new Set([f.id])), wallSegs.value) : [];
});

function place(e: PointerEvent) {
  const w = pz.toWorld(e.clientX, e.clientY);
  emit('place', w.x, w.y);
}

function onEmptyTap() {
  emit('select', null, true);
}

const pz = usePanZoom(svg, { onPress, onEmptyTap, onReady: () => fitRoom(false) });

function fitRoom(animate = true) {
  const b = boundsOf([geom.value]);
  if (b && b.maxX - b.minX > 1) pz.fitBounds(b, { pad: 0.12, minSpan: 1500, animate });
  else pz.setView({ cx: 2000, cy: 1500, s: Math.max(6000 / (pz.size.value.w || 1), 4500 / (pz.size.value.h || 1)) });
}

function selectionBounds(sel: Selection): Bounds | null {
  const g = geom.value;
  const box = (ps: (Vec | undefined)[]): Bounds | null => {
    const ok = ps.filter((p): p is Vec => !!p);
    if (!ok.length) return null;
    return {
      minX: Math.min(...ok.map((p) => p.x)),
      minY: Math.min(...ok.map((p) => p.y)),
      maxX: Math.max(...ok.map((p) => p.x)),
      maxY: Math.max(...ok.map((p) => p.y)),
    };
  };
  const m = g.inner.length;
  switch (sel.kind) {
    case 'wall':
      return box([g.inner[sel.index], g.inner[g.solved.closed ? (sel.index + 1) % m : sel.index + 1]]);
    case 'corner':
      return box([g.inner[sel.index]]);
    case 'diagonal': {
      const d = props.room.diagonals[sel.index];
      return d ? box([g.inner[d.from], g.inner[d.to]]) : null;
    }
    case 'opening': {
      const op = props.openings.find((o) => o.id === sel.id);
      const o = op && openingGeometry(g, op, [g]);
      return o ? box([o.a, o.b, o.ao, o.bo]) : null;
    }
    case 'pin': {
      const p = props.room.pins?.find((x) => x.id === sel.id);
      return p ? box([{ x: p.x_mm, y: p.y_mm }]) : null;
    }
    case 'furniture':
    case 'fixed':
    case 'stair': {
      const f =
        sel.kind === 'furniture'
          ? props.room.furniture?.find((x) => x.id === sel.id)
          : sel.kind === 'fixed'
            ? props.room.fixed?.find((x) => x.id === sel.id)
            : props.room.stairs?.map((s) => ({ ...s, depth_mm: s.width_mm, width_mm: s.length_mm })).find((x) => x.id === sel.id);
      if (!f) return null;
      const c = { x: f.x_mm, y: f.y_mm };
      return box(
        [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ].map(([sx, sy]) => add(c, rotate({ x: (sx * f.width_mm) / 2, y: (sy * f.depth_mm) / 2 }, f.rotation_deg))),
      );
    }
  }
}

function zoomToSelection() {
  const b = props.selection && selectionBounds(props.selection);
  if (b) pz.fitBounds(b, { pad: 0.25, minSpan: 2200, animate: true });
}

// Zoom to a newly selected item (not on every move while dragging it).
const selKey = computed(() => (props.selection ? keyOf(props.selection) : ''));
watch(selKey, () => {
  if (skipZoom) {
    skipZoom = false;
    return;
  }
  if (autoZoom.value && props.selection) zoomToSelection();
});

// Keep the whole room in view while you type, until you pan or zoom yourself.
const boundsKey = computed(() => JSON.stringify(boundsOf([geom.value])));
watch(boundsKey, () => {
  if (!pz.manual.value && !(autoZoom.value && props.selection)) fitRoom(false);
});

const highlight = computed(() => {
  const s = props.selection;
  if (!s) return {};
  if (s.kind === 'wall') return { wall: s.index };
  if (s.kind === 'corner') return { corner: s.index };
  if (s.kind === 'diagonal') return { diagonal: s.index };
  if (s.kind === 'opening') return { opening: s.id };
  if (s.kind === 'pin') return { pin: s.id };
  if (s.kind === 'stair') return { stair: s.id };
  if (s.kind === 'fixed') return { fixed: s.id };
  return { furniture: s.id };
});

const hint = computed(() => {
  if (props.placing) return 'Tap where the note goes';
  if (props.mode === 'layout') return 'Tap a wall, corner, door, stairs or chimney to edit it · drag doors, windows, stairs and chimneys to move them';
  if (props.mode === 'furniture')
    return 'Drag to place: lines up with walls and furniture · Ctrl: free · Shift: straight across or up/down · Alt: distances';
  if (props.mode === 'notes') return 'Drag a note dot to move it · tap to select';
  return '';
});

function toggleAuto(v: boolean) {
  setAutoZoom(v);
  if (v) zoomToSelection();
}

defineExpose({
  fitRoom,
  zoomIn: () => pz.zoomBy(1 / 1.5),
  zoomOut: () => pz.zoomBy(1.5),
  toggleView: () => (showView.value = !showView.value),
});
</script>

<template>
  <div class="preview-canvas" :class="{ placing }">
    <svg ref="svg" xmlns="http://www.w3.org/2000/svg" :viewBox="pz.viewBox.value.str" v-on="pz.handlers">
      <rect
        :x="pz.viewBox.value.x"
        :y="pz.viewBox.value.y"
        :width="pz.viewBox.value.w"
        :height="pz.viewBox.value.h"
        :fill="PLAN.paper"
      />
      <PlanContent
        :rooms="[room]"
        :openings="openings"
        :unit="unit"
        :interactive="false"
        :editable="mode === 'layout'"
        :furniture-editable="mode === 'furniture'"
        :pins-editable="mode === 'notes'"
        :show-corners="mode === 'layout'"
        :show-angles="mode === 'layout' || view.angles"
        :show-diagonals="mode === 'layout'"
        :show-dimensions="mode === 'layout' || view.dimensions"
        :show-names="view.names"
        :show-furniture="mode === 'furniture' || view.furniture"
        :show-pins="mode === 'notes' || view.notes"
        :show-finishes="view.finishes"
        :headroom="headroom"
        :pin-radius="Math.max(110, 10 * pz.view.value.s)"
        :highlight="highlight"
        :accent="accent"
      />
      <!-- furniture: where a dragged piece lines up, and its distances while Alt is held -->
      <SnapOverlay
        v-if="mode === 'furniture'"
        :guides="guides"
        :clearances="clearanceItems"
        :unit="unit"
        :px="pz.view.value.s"
        :accent="accent"
      />
    </svg>
    <ZoomControls
      :auto-zoom="autoZoom"
      :view-open="showView"
      fit-label="Show the whole room"
      @zoom-in="pz.zoomBy(1 / 1.5)"
      @zoom-out="pz.zoomBy(1.5)"
      @fit="fitRoom()"
      @view="showView = !showView"
      @update:auto-zoom="toggleAuto"
    />
    <ViewMenu v-if="showView && props.view" :view="props.view" @close="showView = false" />
    <p v-if="hint" class="preview-hint">{{ hint }}</p>
  </div>
</template>
