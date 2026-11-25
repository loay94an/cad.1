<script setup lang="ts">
/** The single-line diagram (eendraadschema) as SVG, in pixels. Also used for export. */
import { computed } from 'vue';
import { type ElecPoint, type Electrical, applianceInfo, cableText as cableLabel, isControl, isLight, pointInfo } from '../model/electrical';
import { LEVEL, POINT_GAP, SYM_FIRST, SYM_GAP, type SchemaNode, layoutSchema } from '../electrical/eendraadschema';
import ElecSymbol from './ElecSymbol.vue';

const props = defineProps<{
  electrical: Electrical;
  title?: string;
  roomName?: (p: ElecPoint) => string | undefined;
}>();

const INK = '#202124';
const MUTED = '#5f6368';
const FONT = 'Helvetica, Arial, sans-serif';

const layout = computed(() =>
  layoutSchema(props.electrical, (a, b) => (props.roomName?.(a) ?? '').localeCompare(props.roomName?.(b) ?? '')),
);

const flat = computed(() => {
  const out: SchemaNode[] = [];
  const walk = (n: SchemaNode) => {
    out.push(n);
    n.children.forEach(walk);
  };
  layout.value.roots.forEach(walk);
  return out;
});

const supplyText = computed(() => {
  const s = props.electrical.supply;
  const net = s.network === '230' ? '2×230 V' : s.network === '3x230' ? '3×230 V' : '3N×400 V';
  return `${net} · ${s.mainRating_A} A`;
});

/** The lines next to a device, as on an official diagram: "2P - 20 A", "curve C · 3 kA", "Δ 30 mA · type A". */
const specs = (n: SchemaNode): string[] => {
  const d = n.device;
  const out: string[] = [];
  if (d.rating_A) out.push(`${d.poles}P - ${d.rating_A} A`);
  if (d.kind === 'mcb' || d.kind === 'rcbo') {
    const curve = [d.curve ? `curve ${d.curve}` : '', d.breaking_kA ? `${d.breaking_kA} kA` : ''].filter(Boolean).join(' · ');
    if (curve) out.push(curve);
  }
  if (d.sensitivity_mA) out.push(`Δ ${d.sensitivity_mA} mA${d.rcdType ? ` · type ${d.rcdType}` : ''}`);
  return out;
};
const isSwitchgear = (n: SchemaNode) => ['main', 'rcd', 'mcb', 'rcbo'].includes(n.device.kind);
const cableText = (n: SchemaNode) => (n.device.circuit ? cableLabel(n.device.circuit.cable) : '');
const streetText = computed(() => {
  const c = props.electrical.supply.streetCable;
  return c ? `${cableLabel(c, false)} mm² · from the street` : '';
});
const meterText = computed(() => {
  const c = props.electrical.supply.meterCable;
  return c ? `${cableLabel(c, false)} mm² · meter → fuse box` : '';
});
const nameOf = (p: ElecPoint) =>
  p.label || (p.kind === 'appliance' ? (applianceInfo(p.appliance)?.label ?? 'Appliance') : pointInfo(p.kind).label);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : word.endsWith('ch') ? 'es' : 's'}`;
/** One line of a circuit: "Double socket · Kitchen", or "Switch + Push button → 2 lights · Hall". */
function rowText(row: ElecPoint[], width: number): string {
  const rooms = [...new Set(row.map((p) => props.roomName?.(p)).filter(Boolean))].join(' / ');
  let what: string;
  if (row.length === 1) what = nameOf(row[0]);
  else {
    const ctl = row.filter((p) => isControl(p.kind));
    const lights = row.filter((p) => isLight(p.kind));
    const left = ctl.length > 2 ? plural(ctl.length, 'switch') : ctl.map(nameOf).join(' + ');
    what = `${left} → ${lights.length === 1 ? nameOf(lights[0]) : plural(lights.length, 'light')}`;
  }
  const text = [what, rooms].filter(Boolean).join(' · ');
  const max = Math.floor((width - 14) / 4.8);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
const rowY = (n: SchemaNode, i: number) => n.y + 78 + i * POINT_GAP;
const symX = (n: SchemaNode, j: number) => n.x + SYM_FIRST + j * SYM_GAP;
const earthText = computed(() => {
  const r = props.electrical.supply.earth_ohm;
  return r ? `RA ${r} Ω` : 'RA … Ω';
});
/** Where a node's own drop line starts (the bus above it, or the supply). */
const yTop = (n: SchemaNode) => n.y - LEVEL + 60;
</script>

<template>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    :viewBox="`0 0 ${layout.width} ${layout.height}`"
    :width="layout.width"
    :height="layout.height"
    :font-family="FONT"
  >
    <rect :width="layout.width" :height="layout.height" fill="#fff" />
    <text v-if="title" x="30" y="22" font-size="15" font-weight="bold" :fill="INK">{{ title }}</text>

    <!-- supply -->
    <!-- from the street, through the meter, to the main fuse box -->
    <g :stroke="INK" stroke-width="2" fill="none">
      <line :x1="layout.supply.x" :y1="layout.supply.y - 78" :x2="layout.supply.x" :y2="layout.supply.y" />
      <line v-if="layout.supply.busTo > layout.supply.x" :x1="layout.supply.x" :y1="layout.supply.y" :x2="layout.supply.busTo" :y2="layout.supply.y" />
      <rect :x="layout.supply.x - 17" :y="layout.supply.y - 54" width="34" height="22" fill="#fff" />
    </g>
    <text :x="layout.supply.x" :y="layout.supply.y - 39" font-size="10" text-anchor="middle" :fill="INK">kWh</text>
    <text :x="layout.supply.x + 24" :y="layout.supply.y - 39" font-size="12" :fill="INK">{{ supplyText }}</text>
    <text v-if="streetText" :x="layout.supply.x + 8" :y="layout.supply.y - 62" font-size="10" :fill="MUTED">{{ streetText }}</text>
    <text v-if="meterText" :x="layout.supply.x + 8" :y="layout.supply.y - 14" font-size="10" :fill="MUTED">{{ meterText }}</text>
    <!-- earth: the earthing conductor, the test link (aardingsonderbreker) and the electrode -->
    <g :stroke="INK" stroke-width="1.6" fill="none">
      <line :x1="layout.supply.x - 40" :y1="layout.supply.y - 70" :x2="layout.supply.x - 40" :y2="layout.supply.y - 54" />
      <circle :cx="layout.supply.x - 40" :cy="layout.supply.y - 51" r="3" fill="#fff" />
      <circle :cx="layout.supply.x - 40" :cy="layout.supply.y - 39" r="3" fill="#fff" />
      <line :x1="layout.supply.x - 37" :y1="layout.supply.y - 51" :x2="layout.supply.x - 37" :y2="layout.supply.y - 39" />
      <line :x1="layout.supply.x - 40" :y1="layout.supply.y - 36" :x2="layout.supply.x - 40" :y2="layout.supply.y - 26" />
      <line :x1="layout.supply.x - 50" :y1="layout.supply.y - 26" :x2="layout.supply.x - 30" :y2="layout.supply.y - 26" />
      <line :x1="layout.supply.x - 46" :y1="layout.supply.y - 22" :x2="layout.supply.x - 34" :y2="layout.supply.y - 22" />
      <line :x1="layout.supply.x - 43" :y1="layout.supply.y - 18" :x2="layout.supply.x - 37" :y2="layout.supply.y - 18" />
    </g>
    <text :x="layout.supply.x - 40" :y="layout.supply.y - 6" font-size="9" text-anchor="middle" :fill="MUTED">{{ earthText }}</text>

    <g v-for="n in flat" :key="n.device.id">
      <!-- drop from the bus above, through the device, to its own bus or its circuit -->
      <g :stroke="INK" stroke-width="2" fill="none">
        <line :x1="n.x" :y1="yTop(n) - 20" :x2="n.x" :y2="n.y - 22" />
        <!-- switch contact -->
        <line :x1="n.x" :y1="n.y - 22" :x2="n.x - 12" :y2="n.y + 4" />
        <line :x1="n.x" :y1="n.y + 6" :x2="n.x" :y2="n.y + 40" />
        <!-- breaker: square on the contact; RCD: ring around the line -->
        <rect v-if="n.device.kind === 'mcb' || n.device.kind === 'rcbo'" :x="n.x - 4" :y="n.y - 26" width="8" height="8" :fill="INK" />
        <ellipse v-if="n.device.kind === 'rcd' || n.device.kind === 'rcbo'" :cx="n.x" :cy="n.y + 22" rx="11" ry="5" />
        <rect
          v-if="!isSwitchgear(n)"
          :x="n.x - 14"
          :y="n.y - 10"
          width="28"
          height="20"
          fill="#fff"
        />
        <line v-if="n.busTo !== undefined && n.busTo > n.x" :x1="n.x" :y1="n.y + 40" :x2="n.busTo" :y2="n.y + 40" />
      </g>
      <text v-if="n.code" :x="n.x + 6" :y="yTop(n) + 2" font-size="13" font-weight="bold" :fill="INK">
        {{ n.code }}
      </text>
      <text
        v-for="(t, i) in specs(n)"
        :key="i"
        :x="n.x + (isSwitchgear(n) ? 10 : 18)"
        :y="n.y - 6 + i * 12"
        :font-size="i ? 9.5 : 10.5"
        :fill="i ? MUTED : INK"
      >
        {{ t }}
      </text>
      <text
        v-if="!isSwitchgear(n)"
        :x="n.x"
        :y="n.y + 4"
        text-anchor="middle"
        font-size="8"
        :fill="INK"
      >
        {{ (n.device.label || n.device.kind).slice(0, 6) }}
      </text>
      <text v-if="n.subBoard" :x="n.x + 8" :y="n.y + 54" font-size="11" font-weight="bold" :fill="INK">
        ▸ {{ n.subBoard.name }}
      </text>

      <!-- a circuit: cable and points -->
      <template v-if="!n.children.length && n.device.circuit">
        <text :x="n.x - 6" :y="n.y + 52" font-size="10" :fill="MUTED" text-anchor="end" :transform="`rotate(-90 ${n.x - 6} ${n.y + 52})`">
          {{ cableText(n) }}
        </text>
        <text :x="n.x + 6" :y="n.y + 58" font-size="10.5" font-style="italic" :fill="INK">
          {{ n.device.circuit.name.slice(0, Math.floor((n.width - 12) / 5.4)) }}
        </text>
        <g v-if="n.rows.length" :stroke="INK" stroke-width="2">
          <line :x1="n.x" :y1="n.y + 40" :x2="n.x" :y2="rowY(n, n.rows.length - 1)" />
        </g>
        <!-- one line per point; a switch and the lights it controls share a line: switches first, then the lights -->
        <g v-for="(row, i) in n.rows" :key="row[0].id">
          <line :x1="n.x" :y1="rowY(n, i)" :x2="symX(n, row.length - 1)" :y2="rowY(n, i)" :stroke="INK" stroke-width="2" />
          <ElecSymbol
            v-for="(p, j) in row"
            :key="p.id"
            :kind="p.kind"
            :appliance="p.appliance"
            :x="symX(n, j)"
            :y="rowY(n, i)"
            :r="11"
            :color="INK"
            :rotate="p.kind.startsWith('socket') ? 90 : 0"
          />
          <text :x="n.x + 8" :y="rowY(n, i) + 27" font-size="9" :fill="MUTED">{{ i + 1 }}. {{ rowText(row, n.width) }}</text>
        </g>
      </template>
    </g>

    <text v-if="layout.orphans.length" x="30" :y="layout.height - 10" font-size="11" fill="#d93025">
      Not in the diagram (check “wired after”): {{ layout.orphans.map((d) => d.label || d.kind).join(', ') }}
    </text>
  </svg>
</template>
