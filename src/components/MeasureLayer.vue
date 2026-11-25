<script setup lang="ts">
/** The measuring tape drawn on the plan: points, lines and a length on every segment. */
import { computed } from 'vue';
import type { LengthUnit } from '../model/schema';
import { segments } from '../geometry/measure';
import { type Vec, mid } from '../geometry/vec';
import { formatLength } from '../units';

const props = defineProps<{
  points: Vec[];
  closed: boolean;
  /** Where the next point would go (mouse only). */
  hover?: Vec | null;
  unit: LengthUnit;
  /** mm per screen pixel. */
  s: number;
  color: string;
}>();

const segs = computed(() =>
  segments(props.points, props.closed).map((g, i) => ({
    ...g,
    key: i,
    at: mid(g.a, g.b),
    text: `${formatLength(g.length_mm, props.unit)} ${props.unit}`,
  })),
);
const path = computed(() => props.points.map((p) => `${p.x},${p.y}`).join(' '));
const last = computed(() => props.points.at(-1));
</script>

<template>
  <g class="measure-layer" font-family="Helvetica, Arial, sans-serif">
    <polygon v-if="closed" :points="path" :fill="color" fill-opacity="0.12" stroke="none" pointer-events="none" />
    <g fill="none" :stroke="color" stroke-linecap="round" stroke-linejoin="round" pointer-events="none">
      <component :is="closed ? 'polygon' : 'polyline'" :points="path" :stroke-width="s * 2.5" />
      <line
        v-if="hover && last && !closed"
        :x1="last.x"
        :y1="last.y"
        :x2="hover.x"
        :y2="hover.y"
        :stroke-width="s * 1.5"
        :stroke-dasharray="`${s * 6} ${s * 5}`"
      />
    </g>
    <text
      v-for="g in segs"
      :key="g.key"
      :x="g.at.x"
      :y="g.at.y - s * 7"
      text-anchor="middle"
      :font-size="s * 13"
      font-weight="bold"
      :fill="color"
      stroke="#fff"
      :stroke-width="s * 4"
      paint-order="stroke"
      pointer-events="none"
    >
      {{ g.text }}
    </text>
    <g v-for="(p, i) in points" :key="i" class="tap" :data-mpt="i">
      <circle :cx="p.x" :cy="p.y" :r="s * 16" fill="#000" fill-opacity="0" />
      <circle
        :cx="p.x"
        :cy="p.y"
        :r="s * (i === 0 && points.length > 2 && !closed ? 7 : 5)"
        fill="#fff"
        :stroke="color"
        :stroke-width="s * 2.5"
      />
    </g>
  </g>
</template>
