<script setup lang="ts">
/** Another floor drawn through this one as a faint outline: walls and stairs only, so floors can be lined up. */
import { computed } from 'vue';
import type { Room } from '../model/schema';
import { roomGeometry, toWorld } from '../geometry/floor';
import { add, rotate, type Vec } from '../geometry/vec';

const props = withDefaults(defineProps<{ rooms: Room[]; color?: string; label?: string }>(), { color: '#0891b2', label: '' });

const r1 = (x: number) => Math.round(x * 10) / 10;
const ring = (ps: Vec[]) => 'M' + ps.map((p) => `${r1(p.x)} ${r1(p.y)}`).join(' L') + ' Z';

const geoms = computed(() => props.rooms.map(roomGeometry).filter((g) => g.solved.closed));
const walls = computed(() => geoms.value.map((g) => `${ring(g.outer)} ${ring(g.inner)}`).join(' '));
const stairs = computed(() =>
  props.rooms.flatMap((room) =>
    (room.stairs ?? []).map((s) => {
      const c = toWorld(room, { x: s.x_mm, y: s.y_mm });
      const at = (x: number, y: number) => add(c, rotate({ x, y }, s.rotation_deg + room.rotation_deg));
      const hl = s.length_mm / 2;
      const hw = s.width_mm / 2;
      return ring([at(-hl, -hw), at(hl, -hw), at(hl, hw), at(-hl, hw)]) + ` M${r1(at(-hl * 0.8, 0).x)} ${r1(at(-hl * 0.8, 0).y)} L${r1(at(hl * 0.8, 0).x)} ${r1(at(hl * 0.8, 0).y)}`;
    }),
  ),
);
/** The label sits above the top-left corner of the outline. */
const corner = computed(() => {
  const pts = geoms.value.flatMap((g) => g.outer);
  return pts.length ? { x: Math.min(...pts.map((p) => p.x)), y: Math.min(...pts.map((p) => p.y)) } : null;
});
</script>

<template>
  <g class="ghost-floor" pointer-events="none" font-family="Helvetica, Arial, sans-serif">
    <path :d="walls" :fill="color" fill-opacity="0.28" fill-rule="evenodd" :stroke="color" stroke-opacity="0.6" stroke-width="10" />
    <path v-for="(d, i) in stairs" :key="i" :d="d" fill="none" :stroke="color" stroke-opacity="0.6" stroke-width="14" stroke-dasharray="60 40" />
    <text v-if="label && corner" :x="corner.x" :y="corner.y - 60" font-size="110" :fill="color">{{ label }}</text>
  </g>
</template>
