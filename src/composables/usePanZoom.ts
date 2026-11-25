/**
 * Pan and zoom for an SVG drawn in millimetres: drag to pan, pinch or scroll
 * to zoom, plus fit/zoom helpers for buttons. The component decides what a
 * press on its content does through `onPress`.
 */
import { computed, onBeforeUnmount, onMounted, ref, type Ref } from 'vue';
import type { Bounds } from '../geometry/floor';
import type { Vec } from '../geometry/vec';

export interface PressHandler {
  /** Present → dragging moves this thing. Absent → dragging pans the view. */
  move?(world: Vec, e: PointerEvent): void;
  /** `moved` is false for a tap. */
  end?(moved: boolean, e: PointerEvent): void;
  /** Escape during the drag: put it back where it was. */
  cancel?(): void;
}

export interface PanZoomOptions {
  /** Return a handler to take over the press, or nothing to pan. */
  onPress?(e: PointerEvent, world: Vec): PressHandler | null | undefined;
  /** A tap on nothing in particular. */
  onEmptyTap?(e: PointerEvent): void;
  /** Called once the SVG has a size, e.g. to fit the content. */
  onReady?(): void;
}

export interface View {
  cx: number;
  cy: number;
  /** Millimetres per screen pixel. */
  s: number;
}

const MIN_S = 0.3;
const MAX_S = 300;
const TAP_PX = 6;
const clampS = (s: number) => Math.min(MAX_S, Math.max(MIN_S, s));

export function usePanZoom(svg: Ref<SVGSVGElement | undefined>, opts: PanZoomOptions = {}) {
  const size = ref({ w: 0, h: 0 });
  const view = ref<View>({ cx: 2000, cy: 1500, s: 10 });
  /** True once the user panned or zoomed themselves (cleared by fit/reset). */
  const manual = ref(false);

  let observer: ResizeObserver | undefined;
  onMounted(() => {
    observer = new ResizeObserver(([entry]) => {
      const first = size.value.w === 0;
      size.value = { w: entry.contentRect.width, h: entry.contentRect.height };
      if (first && size.value.w > 0) opts.onReady?.();
    });
    if (svg.value) observer.observe(svg.value);
    measure();
  });
  /** The observer can be late (or silent while the page is in the background): measure directly as well. */
  function measure() {
    const r = svg.value?.getBoundingClientRect();
    if (!r || !r.width || !r.height) return;
    const first = size.value.w === 0;
    if (r.width !== size.value.w || r.height !== size.value.h) size.value = { w: r.width, h: r.height };
    if (first) opts.onReady?.();
  }
  onBeforeUnmount(() => {
    observer?.disconnect();
    cancelAnimationFrame(anim);
  });

  const viewBox = computed(() => {
    const { cx, cy, s } = view.value;
    const w = Math.max(1, size.value.w) * s;
    const h = Math.max(1, size.value.h) * s;
    return { x: cx - w / 2, y: cy - h / 2, w, h, str: `${cx - w / 2} ${cy - h / 2} ${w} ${h}` };
  });

  function toWorld(clientX: number, clientY: number): Vec {
    const rect = svg.value!.getBoundingClientRect();
    const { cx, cy, s } = view.value;
    return { x: cx + (clientX - rect.left - rect.width / 2) * s, y: cy + (clientY - rect.top - rect.height / 2) * s };
  }

  let anim = 0;
  let animEnd = 0;
  function setView(v: View, animate = false) {
    cancelAnimationFrame(anim);
    clearTimeout(animEnd);
    // Background tabs don't run animation frames; jump straight there.
    if (!animate || document.hidden) {
      view.value = v;
      return;
    }
    const from = { ...view.value };
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 240);
      const e = 1 - (1 - k) ** 3;
      view.value = {
        cx: from.cx + (v.cx - from.cx) * e,
        cy: from.cy + (v.cy - from.cy) * e,
        s: from.s * (v.s / from.s) ** e,
      };
      if (k < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
    // If frames aren't running (a hidden pane or window), still end up in the right place.
    animEnd = window.setTimeout(() => {
      cancelAnimationFrame(anim);
      view.value = v;
    }, 400);
  }

  /**
   * `inset`: pixels at each edge that are covered by buttons and panels; the
   * content is fitted into what's left, so nothing ends up underneath them.
   */
  function fitBounds(
    b: Bounds,
    { pad = 0.1, minSpan = 0, animate = false, inset = { top: 0, right: 0, bottom: 0, left: 0 } } = {},
  ) {
    if (!size.value.w) measure();
    const { w, h } = size.value;
    if (!w || !h) return;
    // On a very small canvas the insets would leave nothing: give them up to half.
    const k = Math.min(1, (w * 0.5) / Math.max(1, inset.left + inset.right), (h * 0.5) / Math.max(1, inset.top + inset.bottom));
    const [t, r, bo, l] = [inset.top * k, inset.right * k, inset.bottom * k, inset.left * k];
    const bw = Math.max(b.maxX - b.minX, minSpan);
    const bh = Math.max(b.maxY - b.minY, minSpan);
    const s = clampS(Math.max(bw / (w - l - r), bh / (h - t - bo), 0.5) * (1 + 2 * pad));
    manual.value = false;
    setView({ cx: (b.minX + b.maxX) / 2 + ((r - l) / 2) * s, cy: (b.minY + b.maxY) / 2 + ((bo - t) / 2) * s, s }, animate);
  }

  function zoomBy(factor: number) {
    manual.value = true;
    setView({ ...view.value, s: clampS(view.value.s * factor) }, true);
  }

  function centreOn(world: Vec, client: Vec, s: number) {
    const rect = svg.value!.getBoundingClientRect();
    view.value = {
      cx: world.x - (client.x - rect.left - rect.width / 2) * s,
      cy: world.y - (client.y - rect.top - rect.height / 2) * s,
      s,
    };
  }

  // ---- gestures -------------------------------------------------------------

  type Gesture =
    | { kind: 'pan'; start: Vec; startView: View; moved: boolean; handler?: PressHandler }
    | { kind: 'drag'; start: Vec; moved: boolean; handler: PressHandler }
    | { kind: 'pinch'; d0: number; s0: number; midWorld: Vec };

  const pointers = new Map<number, Vec>();
  let gesture: Gesture | null = null;

  function pinchInfo() {
    const [a, b] = [...pointers.values()];
    return { d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  }

  function pointerdown(e: PointerEvent) {
    try {
      svg.value?.setPointerCapture(e.pointerId);
    } catch {
      // The pointer is already gone; the gesture still works without capture.
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      if (gesture?.kind === 'drag') gesture.handler.end?.(gesture.moved, e);
      cancelAnimationFrame(anim);
      const { d, mid } = pinchInfo();
      gesture = { kind: 'pinch', d0: d, s0: view.value.s, midWorld: toWorld(mid.x, mid.y) };
      return;
    }
    if (pointers.size > 2) return;
    cancelAnimationFrame(anim);
    const start = { x: e.clientX, y: e.clientY };
    const handler = opts.onPress?.(e, toWorld(e.clientX, e.clientY)) ?? undefined;
    gesture = handler?.move
      ? { kind: 'drag', start, moved: false, handler }
      : { kind: 'pan', start, startView: { ...view.value }, moved: false, handler };
  }

  function pointermove(e: PointerEvent) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture;
    if (!g) return;
    if (g.kind === 'pinch') {
      if (pointers.size < 2) return;
      const { d, mid } = pinchInfo();
      manual.value = true;
      centreOn(g.midWorld, mid, clampS((g.s0 * g.d0) / d));
      return;
    }
    const dx = e.clientX - g.start.x;
    const dy = e.clientY - g.start.y;
    if (!g.moved && Math.hypot(dx, dy) < TAP_PX) return;
    g.moved = true;
    if (g.kind === 'pan') {
      manual.value = true;
      view.value = { cx: g.startView.cx - dx * g.startView.s, cy: g.startView.cy - dy * g.startView.s, s: g.startView.s };
    } else {
      g.handler.move?.(toWorld(e.clientX, e.clientY), e);
    }
  }

  function pointerup(e: PointerEvent) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    const g = gesture;
    const isUp = e.type === 'pointerup';
    if (g?.kind === 'drag') g.handler.end?.(g.moved, e);
    else if (g?.kind === 'pan') {
      if (g.handler) g.handler.end?.(g.moved || !isUp, e);
      else if (!g.moved && isUp) opts.onEmptyTap?.(e);
    }
    if (pointers.size === 0) gesture = null;
    else if (g?.kind === 'pinch' && pointers.size === 1) {
      const [p] = [...pointers.values()];
      gesture = { kind: 'pan', start: p, startView: { ...view.value }, moved: true };
    } else if (g?.kind !== 'pinch') gesture = null;
  }

  /** Stops the drag in progress and puts the thing back; false when nothing is being dragged. */
  function cancelDrag(): boolean {
    const g = gesture;
    if (g?.kind !== 'drag' || !g.moved || !g.handler.cancel) return false;
    g.handler.cancel();
    // The rest of this press does nothing; letting go ends it.
    gesture = null;
    return true;
  }

  function wheel(e: WheelEvent) {
    e.preventDefault();
    cancelAnimationFrame(anim);
    manual.value = true;
    centreOn(toWorld(e.clientX, e.clientY), { x: e.clientX, y: e.clientY }, clampS(view.value.s * Math.exp(e.deltaY * 0.0015)));
  }

  return {
    size,
    view,
    viewBox,
    manual,
    toWorld,
    setView,
    fitBounds,
    zoomBy,
    cancelDrag,
    handlers: { pointerdown, pointermove, pointerup, pointercancel: pointerup, wheel },
  };
}

/** Remembers a toggle per device (survives reloads); falls back to the default if storage is blocked. */
export function useStoredFlag(key: string, fallback: boolean) {
  let initial = fallback;
  try {
    const v = localStorage.getItem(key);
    if (v !== null) initial = v === '1';
  } catch {
    // storage unavailable
  }
  const flag = ref(initial);
  const set = (v: boolean) => {
    flag.value = v;
    try {
      localStorage.setItem(key, v ? '1' : '0');
    } catch {
      // storage unavailable
    }
  };
  return { flag, set };
}
