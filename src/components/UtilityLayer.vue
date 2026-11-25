<script setup lang="ts">
/** Water, drainage, heating, ventilation and gas on the plan: pipes as lines, points as lettered symbols. Floor coordinates, mm. */
import { computed } from 'vue';
import { type UtilPoint, type UtilRun, type UtilSel, type UtilityId, pointKind, runKind, utilityInfo } from '../model/utilities';

const props = withDefaults(
  defineProps<{
    points: UtilPoint[];
    runs: UtilRun[];
    /** Symbol size in mm. */
    r?: number;
    /** The utility being worked on: only it can be tapped, the others are faded. */
    active?: UtilityId | null;
    selected?: UtilSel | null;
    editable?: boolean;
    /** A pipe being drawn. */
    draft?: { path: { x: number; y: number }[]; color: string; hover?: { x: number; y: number } | null } | null;
  }>(),
  { r: 110, active: null, selected: null, editable: false, draft: null },
);

const str = (path: { x: number; y: number }[]) => path.map((p) => `${p.x},${p.y}`).join(' ');
const mine = (u: UtilityId) => !props.active || u === props.active;

const lines = computed(() =>
  props.runs.map((run) => {
    const k = runKind(run.utility, run.kind);
    const on = props.selected?.type === 'run' && props.selected.id === run.id;
    return { run, k, on, d: str(run.path), tap: props.editable && mine(run.utility), faded: !mine(run.utility) };
  }),
);
const symbols = computed(() =>
  props.points.map((p) => {
    const k = pointKind(p.utility, p.kind);
    const on = props.selected?.type === 'point' && props.selected.id === p.id;
    return { p, k, on, color: utilityInfo(p.utility).color, tap: props.editable && mine(p.utility), faded: !mine(p.utility) };
  }),
);
const draftEnd = computed(() => props.draft?.path.at(-1));
</script>

<template>
  <g class="util-layer" font-family="Helvetica, Arial, sans-serif">
    <g v-for="l in lines" :key="l.run.id" :opacity="l.faded ? 0.3 : 1" :class="{ tap: l.tap }" :data-run="l.tap ? l.run.id : undefined">
      <polyline v-if="l.tap" :points="l.d" fill="none" stroke="#000" stroke-opacity="0" :stroke-width="r * 1.6" stroke-linejoin="round" />
      <polyline
        v-if="l.on"
        :points="l.d"
        fill="none"
        :stroke="l.k.color"
        stroke-opacity="0.25"
        :stroke-width="r * 0.9"
        stroke-linecap="round"
        stroke-linejoin="round"
        pointer-events="none"
      />
      <polyline
        :points="l.d"
        fill="none"
        :stroke="l.k.color"
        :stroke-width="r * 0.26"
        :stroke-dasharray="l.k.dashed ? `${r * 0.8} ${r * 0.5}` : undefined"
        stroke-linecap="round"
        stroke-linejoin="round"
        pointer-events="none"
      />
      <template v-if="l.on && editable">
        <g v-for="(c, i) in l.run.path" :key="i" class="tap" :data-rv="i">
          <circle :cx="c.x" :cy="c.y" :r="r * 1.3" fill="#000" fill-opacity="0" />
          <circle :cx="c.x" :cy="c.y" :r="r * 0.42" fill="#fff" :stroke="l.k.color" :stroke-width="r * 0.2" />
        </g>
      </template>
    </g>

    <g v-if="draft" pointer-events="none">
      <polyline
        :points="str(draft.path)"
        fill="none"
        :stroke="draft.color"
        :stroke-width="r * 0.3"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <line
        v-if="draft.hover && draftEnd"
        :x1="draftEnd.x"
        :y1="draftEnd.y"
        :x2="draft.hover.x"
        :y2="draft.hover.y"
        :stroke="draft.color"
        :stroke-width="r * 0.18"
        :stroke-dasharray="`${r * 0.5} ${r * 0.4}`"
      />
      <circle v-for="(c, i) in draft.path" :key="i" :cx="c.x" :cy="c.y" :r="r * 0.4" fill="#fff" :stroke="draft.color" :stroke-width="r * 0.2" />
    </g>

    <g
      v-for="s in symbols"
      :key="s.p.id"
      :opacity="s.faded ? 0.3 : 1"
      :class="{ tap: s.tap }"
      :data-upoint="s.tap ? s.p.id : undefined"
    >
      <circle
        v-if="s.tap"
        :cx="s.p.x_mm"
        :cy="s.p.y_mm"
        :r="r * 1.9"
        :fill="s.on ? s.color : '#000'"
        :fill-opacity="s.on ? 0.18 : 0"
        :stroke="s.on ? s.color : 'none'"
        :stroke-width="r * 0.15"
      />
      <rect
        v-if="s.k.box"
        :x="s.p.x_mm - r * 1.15"
        :y="s.p.y_mm - r * 0.9"
        :width="r * 2.3"
        :height="r * 1.8"
        :rx="r * 0.2"
        fill="#fff"
        :stroke="s.color"
        :stroke-width="r * 0.18"
      />
      <circle v-else :cx="s.p.x_mm" :cy="s.p.y_mm" :r="r" fill="#fff" :stroke="s.color" :stroke-width="r * 0.18" />
      <text
        :x="s.p.x_mm"
        :y="s.p.y_mm + r * 0.32"
        text-anchor="middle"
        :font-size="r * (s.k.code.length > 1 ? 0.85 : 1.05)"
        font-weight="bold"
        :fill="s.color"
        pointer-events="none"
      >
        {{ s.k.code }}
      </text>
      <text
        v-if="s.p.label"
        :x="s.p.x_mm"
        :y="s.p.y_mm + r * 2.15"
        text-anchor="middle"
        :font-size="r * 0.8"
        :fill="s.color"
        stroke="#fff"
        :stroke-width="r * 0.25"
        paint-order="stroke"
        stroke-linejoin="round"
        pointer-events="none"
      >
        {{ s.p.label }}
      </text>
    </g>
  </g>
</template>
