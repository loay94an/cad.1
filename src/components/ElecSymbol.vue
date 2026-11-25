<script setup lang="ts">
/**
 * Simplified Belgian (NBN/AREI-style) symbols, drawn around (x, y) with
 * size r. Used on the plan (mm) and in the single-line diagram.
 */
import { computed } from 'vue';
import type { Appliance, PointKind } from '../model/electrical';

const props = withDefaults(
  defineProps<{
    kind: PointKind;
    x: number;
    y: number;
    r: number;
    color?: string;
    appliance?: Appliance;
    rotate?: number;
    /** What's behind the symbol; 'none' for buttons. */
    paper?: string;
  }>(),
  { color: '#202124', rotate: 0, paper: '#fff' },
);

const APPLIANCE_LETTER: Record<Appliance, string> = {
  washer: 'WM',
  dryer: 'DK',
  dishwasher: 'VW',
  oven: 'OV',
  hob: 'KP',
  boiler: 'B',
  heatpump: 'WP',
  ev: 'EV',
  fridge: 'KK',
  other: 'T',
};

const sw = computed(() => props.r * 0.16);
const count = computed(() => (props.kind === 'socket2' ? '2' : props.kind === 'socket3' ? '3' : ''));
const letter = computed(() => APPLIANCE_LETTER[props.appliance ?? 'other']);
</script>

<template>
  <g
    :transform="`translate(${x} ${y}) rotate(${rotate})`"
    :stroke="color"
    :stroke-width="sw"
    fill="none"
    stroke-linecap="round"
  >
    <!-- Socket with earth: half circle on a base line, earth stroke on top. -->
    <template v-if="kind === 'socket' || kind === 'socket2' || kind === 'socket3'">
      <path :d="`M ${-r} ${r * 0.35} A ${r} ${r} 0 0 1 ${r} ${r * 0.35}`" :fill="paper" />
      <line :x1="-r * 1.15" :y1="r * 0.35" :x2="r * 1.15" :y2="r * 0.35" />
      <line :x1="0" :y1="-r * 0.65" :x2="0" :y2="-r * 1.15" />
      <line :x1="0" :y1="r * 0.35" :x2="0" :y2="r * 0.95" />
      <text
        v-if="count"
        :transform="`rotate(${-rotate})`"
        :x="rotate ? r * 0.45 : r * 1.25"
        :y="rotate ? -r * 0.8 : -r * 0.25"
        :font-size="r * 0.95"
        :fill="color"
        stroke="none"
        font-family="Helvetica, Arial, sans-serif"
        font-weight="bold"
      >
        {{ count }}
      </text>
    </template>
    <!-- Light point: circle with a cross. -->
    <template v-else-if="kind === 'light'">
      <circle :r="r" :fill="paper" />
      <line :x1="-r * 0.7" :y1="-r * 0.7" :x2="r * 0.7" :y2="r * 0.7" />
      <line :x1="-r * 0.7" :y1="r * 0.7" :x2="r * 0.7" :y2="-r * 0.7" />
    </template>
    <!-- Switches: small circle with a lever and its flag. Two levers in a V: double (serie); a lever at both ends: two-way (wissel). -->
    <template v-else-if="kind === 'switch' || kind === 'switch2' || kind === 'switch_2way' || kind === 'dimmer'">
      <circle :r="r * 0.42" :fill="paper" />
      <path :d="`M ${r * 0.3} ${-r * 0.3} L ${r * 1.1} ${-r * 1.1} l ${r * 0.35} ${r * 0.35}`" />
      <path v-if="kind === 'switch2'" :d="`M ${-r * 0.3} ${-r * 0.3} L ${-r * 1.1} ${-r * 1.1} l ${r * 0.35} ${-r * 0.35}`" />
      <path v-if="kind === 'switch_2way'" :d="`M ${-r * 0.3} ${r * 0.3} L ${-r * 1.1} ${r * 1.1} l ${-r * 0.35} ${-r * 0.35}`" />
      <path v-if="kind === 'dimmer'" :d="`M ${-r * 1.1} ${r * 0.9} L ${r * 0.2} ${r * 0.9} L ${r * 0.2} ${r * 0.5} Z`" :fill="color" />
    </template>
    <!-- Push button: two circles, one inside the other. -->
    <template v-else-if="kind === 'pushbutton'">
      <circle :r="r * 0.75" :fill="paper" />
      <circle :r="r * 0.32" />
    </template>
    <!-- Appliance: a box with its code. -->
    <template v-else-if="kind === 'appliance'">
      <rect :x="-r * 1.1" :y="-r * 0.8" :width="r * 2.2" :height="r * 1.6" :fill="paper" />
      <text
        :y="r * 0.33"
        text-anchor="middle"
        :font-size="r * (letter.length > 1 ? 0.85 : 1)"
        :fill="color"
        stroke="none"
        font-family="Helvetica, Arial, sans-serif"
        font-weight="bold"
      >
        {{ letter }}
      </text>
    </template>
    <!-- Junction box. -->
    <template v-else>
      <circle :r="r * 0.45" :fill="color" />
    </template>
  </g>
</template>
