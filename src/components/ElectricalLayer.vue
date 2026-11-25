<script setup lang="ts">
/** Sockets, lights, switches and fuse boxes on the plan (the situatieschema). Floor coordinates, mm. */
import { computed } from 'vue';
import { type Board, type ElecPoint, circuitColor, isControl, isLight } from '../model/electrical';
import type { Id } from '../model/schema';
import ElecSymbol from './ElecSymbol.vue';

const props = withDefaults(
  defineProps<{
    points: ElecPoint[];
    boards?: Board[];
    codes: Map<Id, string>;
    /** Symbol size in mm (the floor view keeps it readable when zoomed out). */
    r?: number;
    selectedId?: Id | null;
    /** Points can be tapped and dragged. */
    editable?: boolean;
    /** Circuit being linked: its points are emphasised, others faded. */
    focusCircuit?: Id | null;
    accent?: string;
    /** Linking mode: the switch or light whose links are being edited. */
    linking?: Id | null;
    /** Circuit codes under the symbols (off on the floor view outside Electrical mode: the colour says enough). */
    labels?: boolean;
  }>(),
  {
    boards: () => [],
    r: 110,
    selectedId: null,
    editable: false,
    focusCircuit: null,
    accent: '#c2410c',
    linking: null,
    labels: true,
  },
);

const byId = computed(() => new Map(props.points.map((p) => [p.id, p])));

/** Dashed lines from each switch / push button to the lights it controls. */
const links = computed(() =>
  props.points.flatMap((c) =>
    (c.controls ?? [])
      .map((id) => byId.value.get(id))
      .filter((l): l is ElecPoint => !!l)
      .map((l) => {
        const focus = [props.selectedId, props.linking].filter(Boolean);
        const on = focus.includes(c.id) || focus.includes(l.id);
        return { key: `${c.id}-${l.id}`, a: c, b: l, on };
      }),
  ),
);

/** In linking mode: the points that can be tapped to link (lights for a switch, switches for a light). */
const linkSource = computed(() => (props.linking ? byId.value.get(props.linking) : undefined));
const canLink = (p: ElecPoint) => {
  const src = linkSource.value;
  if (!src || src.id === p.id) return false;
  return (isControl(src.kind) && isLight(p.kind)) || (isLight(src.kind) && isControl(p.kind));
};
const linked = (p: ElecPoint) => {
  const src = linkSource.value;
  return !!src && (src.controls?.includes(p.id) || p.controls?.includes(src.id));
};

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
const hits = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/**
 * Each point with its circuit code. A code goes under the symbol; when another
 * symbol or code is already there it tries above, then right, then left. If
 * nothing is free it's left out: its neighbours on the same circuit show it.
 */
const items = computed(() => {
  const r = props.r;
  const symbols = props.points.map((p): Box => ({ x0: p.x_mm - r * 1.15, y0: p.y_mm - r * 1.15, x1: p.x_mm + r * 1.15, y1: p.y_mm + r * 1.15 }));
  const taken: Box[] = [];
  return props.points.map((p, i) => {
    const code = p.circuitId ? props.codes.get(p.circuitId) : undefined;
    const text = code ?? '?';
    const w = r * 0.62 * text.length;
    const h = r * 0.9;
    // Middle of the text for each spot.
    const spots = [
      { x: p.x_mm, y: p.y_mm + r * 1.9 },
      { x: p.x_mm, y: p.y_mm - r * 1.75 },
      { x: p.x_mm + r * 1.3 + w / 2, y: p.y_mm },
      { x: p.x_mm - r * 1.3 - w / 2, y: p.y_mm },
    ];
    let label: { x: number; y: number } | null = null;
    if (props.labels) {
      for (const s of spots) {
        const box: Box = { x0: s.x - w / 2, y0: s.y - h / 2, x1: s.x + w / 2, y1: s.y + h / 2 };
        if (symbols.some((b, j) => j !== i && hits(box, b)) || taken.some((b) => hits(box, b))) continue;
        taken.push(box);
        label = { x: s.x, y: s.y + h * 0.36 };
        break;
      }
    }
    return {
      p,
      code,
      text,
      label,
      color: circuitColor(code),
      faded: !!props.focusCircuit && p.circuitId !== props.focusCircuit,
    };
  });
});
</script>

<template>
  <g class="elec-layer" font-family="Helvetica, Arial, sans-serif">
    <g fill="none" stroke-linecap="round" pointer-events="none">
      <line
        v-for="l in links"
        :key="l.key"
        :x1="l.a.x_mm"
        :y1="l.a.y_mm"
        :x2="l.b.x_mm"
        :y2="l.b.y_mm"
        :stroke="l.on ? accent : '#80868b'"
        :stroke-width="r * (l.on ? 0.22 : 0.12)"
        :stroke-dasharray="`${r * 0.6} ${r * 0.45}`"
        :opacity="l.on ? 1 : 0.7"
      />
    </g>
    <g v-for="b in boards" :key="b.id" :class="{ tap: editable }" :data-board="editable ? b.id : undefined">
      <rect
        :x="b.location!.x_mm - r * 1.6"
        :y="b.location!.y_mm - r * 1.1"
        :width="r * 3.2"
        :height="r * 2.2"
        fill="#fff7ed"
        :stroke="accent"
        :stroke-width="r * 0.18"
      />
      <text
        :x="b.location!.x_mm"
        :y="b.location!.y_mm + r * 0.45"
        text-anchor="middle"
        :font-size="r * 1.2"
        font-weight="bold"
        :fill="accent"
      >
        {{ b.letter }}
      </text>
    </g>
    <g
      v-for="it in items"
      :key="it.p.id"
      :class="{ tap: editable }"
      :data-point="editable ? it.p.id : undefined"
      :opacity="it.faded && !(linking && canLink(it.p)) ? 0.35 : 1"
    >
      <circle
        v-if="linking && canLink(it.p)"
        :cx="it.p.x_mm"
        :cy="it.p.y_mm"
        :r="r * 1.7"
        :fill="linked(it.p) ? accent : '#fff'"
        :fill-opacity="linked(it.p) ? 0.25 : 0.6"
        :stroke="accent"
        :stroke-width="r * 0.15"
        :stroke-dasharray="linked(it.p) ? undefined : `${r * 0.4} ${r * 0.3}`"
      />
      <circle
        v-if="editable"
        :cx="it.p.x_mm"
        :cy="it.p.y_mm"
        :r="r * 1.9"
        :fill="it.p.id === selectedId ? accent : '#000'"
        :fill-opacity="it.p.id === selectedId ? 0.18 : 0"
        :stroke="it.p.id === selectedId ? accent : 'none'"
        :stroke-width="r * 0.15"
      />
      <ElecSymbol :kind="it.p.kind" :appliance="it.p.appliance" :x="it.p.x_mm" :y="it.p.y_mm" :r="r" :color="it.color" />
      <text
        v-if="it.label"
        :x="it.label.x"
        :y="it.label.y"
        text-anchor="middle"
        :font-size="r * 0.9"
        font-weight="bold"
        :fill="it.code ? it.color : '#d93025'"
        stroke="#fff"
        :stroke-width="r * 0.28"
        paint-order="stroke"
        stroke-linejoin="round"
        pointer-events="none"
      >
        {{ it.text }}
      </text>
    </g>
  </g>
</template>
