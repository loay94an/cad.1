<script setup lang="ts">
/**
 * While dragging: dashed lines where the thing lines up, and (Alt) its
 * distances to the walls and things around it. Sizes are in screen pixels.
 */
import { computed } from 'vue';
import type { Clearance, Seg } from '../geometry/snap';
import type { LengthUnit } from '../model/schema';
import { formatLength } from '../units';
import { mid } from '../geometry/vec';
import { PLAN } from './planStyle';

const props = defineProps<{
  guides: Seg[];
  clearances: Clearance[];
  unit: LengthUnit;
  /** Millimetres per screen pixel. */
  px: number;
  accent?: string;
}>();

const labels = computed(() =>
  props.clearances
    .filter((c) => c.length >= 1)
    .map((c, i) => {
      const m = mid(c.from, c.to);
      const deg = (Math.atan2(c.to.y - c.from.y, c.to.x - c.from.x) * 180) / Math.PI;
      return {
        key: i,
        ...c,
        mx: m.x,
        my: m.y - 4 * props.px,
        angle: deg > 90 || deg < -90 ? deg + 180 : deg,
        text: formatLength(c.length, props.unit),
      };
    }),
);
</script>

<template>
  <g pointer-events="none" :font-family="PLAN.font">
    <line
      v-for="(l, i) in guides"
      :key="'g' + i"
      :x1="l[0].x"
      :y1="l[0].y"
      :x2="l[1].x"
      :y2="l[1].y"
      :stroke="accent ?? PLAN.accent"
      :stroke-width="1.5 * px"
      :stroke-dasharray="`${6 * px} ${4 * px}`"
    />
    <g v-for="c in labels" :key="'c' + c.key">
      <line
        :x1="c.from.x"
        :y1="c.from.y"
        :x2="c.to.x"
        :y2="c.to.y"
        :stroke="PLAN.angle"
        :stroke-width="1.5 * px"
        marker-start="url(#fp-dim-tick)"
        marker-end="url(#fp-dim-tick)"
      />
      <text
        :x="c.mx"
        :y="c.my"
        :transform="`rotate(${c.angle} ${c.mx} ${c.my})`"
        text-anchor="middle"
        :font-size="12 * px"
        font-weight="bold"
        :fill="PLAN.angle"
        :stroke="PLAN.paper"
        :stroke-width="3 * px"
        paint-order="stroke"
      >
        {{ c.text }}
      </text>
    </g>
    <defs>
      <marker id="fp-dim-tick" viewBox="-1 -5 2 10" markerWidth="2" markerHeight="10" orient="auto" markerUnits="strokeWidth">
        <line x1="0" y1="-5" x2="0" y2="5" :stroke="PLAN.angle" stroke-width="1" />
      </marker>
    </defs>
  </g>
</template>
