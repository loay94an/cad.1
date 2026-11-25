<script setup lang="ts">
import AppIcon from './AppIcon.vue';
/**
 * The bar at the bottom of Utilities mode: choose the utility, then a symbol
 * to place or a pipe to draw. With something selected it shows its details
 * instead. Changes go straight into the project (undo works).
 */
import { computed } from 'vue';
import type { LengthUnit } from '../model/schema';
import {
  UTILITIES,
  type UtilSel,
  type UtilTool,
  type Utilities,
  type UtilityId,
  pointKind,
  runKind,
  runLength_mm,
  runTotals,
  utilityInfo,
} from '../model/utilities';
import { formatLength } from '../units';

const props = defineProps<{
  utilities: Utilities;
  utility: UtilityId;
  tool: UtilTool | null;
  sel: UtilSel | null;
  floorId: string;
  unit: LengthUnit;
  readonly?: boolean;
}>();
const emit = defineEmits<{
  'update:utility': [u: UtilityId];
  'update:tool': [t: UtilTool | null];
  'update:sel': [s: UtilSel | null];
}>();

const info = computed(() => utilityInfo(props.utility));
const len = (mm: number) => `${formatLength(mm, props.unit)} ${props.unit}`;
/** "Cold water 12.400 m · Hot water 8.100 m", for the whole house. */
const totals = computed(() => runTotals(props.utilities, props.utility));

const point = computed(() => (props.sel?.type === 'point' ? props.utilities.points.find((p) => p.id === props.sel!.id) : undefined));
const run = computed(() => (props.sel?.type === 'run' ? props.utilities.runs.find((r) => r.id === props.sel!.id) : undefined));

function pick(type: UtilTool['type'], kind: string) {
  const same = props.tool?.type === type && props.tool.kind === kind;
  emit('update:sel', null);
  emit('update:tool', same ? null : { type, kind });
}

function remove() {
  const u = props.utilities;
  if (point.value) u.points = u.points.filter((p) => p.id !== point.value!.id);
  if (run.value) u.runs = u.runs.filter((r) => r.id !== run.value!.id);
  emit('update:sel', null);
}

function setUtility(e: Event) {
  emit('update:tool', null);
  emit('update:sel', null);
  emit('update:utility', (e.target as HTMLSelectElement).value as UtilityId);
}
</script>

<template>
  <!-- a selected point -->
  <div v-if="point" class="elec-panel" @pointerdown.stop>
    <div class="panel-head">
      <span class="util-chip" :class="{ box: pointKind(point.utility, point.kind).box }" :style="{ color: utilityInfo(point.utility).color }">
        {{ pointKind(point.utility, point.kind).code }}
      </span>
      <strong>{{ point.label || pointKind(point.utility, point.kind).label }}</strong>
      <small>{{ utilityInfo(point.utility).label }}</small>
      <span class="spacer"></span>
      <button v-if="!readonly" class="btn ghost small danger" aria-label="Delete this point" title="Delete (Del)" @click="remove"><AppIcon name="trash" /></button>
      <button class="btn ghost small" aria-label="Close" title="Close (Esc)" @click="emit('update:sel', null)">✕</button>
    </div>
    <div class="panel-grid">
      <label class="field">
        <span class="field-label">Symbol</span>
        <select v-model="point.kind" :disabled="readonly">
          <option v-for="k in utilityInfo(point.utility).points" :key="k.id" :value="k.id">{{ k.label }}</option>
        </select>
      </label>
      <label class="field">
        <span class="field-label">Label</span>
        <input v-model="point.label" placeholder="optional" :disabled="readonly" />
      </label>
      <label class="field wide">
        <span class="field-label">Note</span>
        <input v-model="point.note" placeholder="size, brand, height, …" :disabled="readonly" />
      </label>
    </div>
  </div>

  <!-- a selected pipe -->
  <div v-else-if="run" class="elec-panel" @pointerdown.stop>
    <div class="panel-head">
      <span class="util-swatch" :class="{ dashed: runKind(run.utility, run.kind).dashed }" :style="{ color: runKind(run.utility, run.kind).color }"></span>
      <strong>{{ run.label || runKind(run.utility, run.kind).label }}</strong>
      <small>{{ len(runLength_mm(run)) }}</small>
      <span class="spacer"></span>
      <button v-if="!readonly" class="btn ghost small danger" :aria-label="`Delete this ${utilityInfo(run.utility).line}`" title="Delete (Del)" @click="remove"><AppIcon name="trash" /></button>
      <button class="btn ghost small" aria-label="Close" title="Close (Esc)" @click="emit('update:sel', null)">✕</button>
    </div>
    <div class="panel-grid">
      <label class="field">
        <span class="field-label">Kind</span>
        <select v-model="run.kind" :disabled="readonly">
          <option v-for="k in utilityInfo(run.utility).runs" :key="k.id" :value="k.id">{{ k.label }}</option>
        </select>
      </label>
      <label class="field">
        <span class="field-label">Diameter (mm)</span>
        <input v-model.number="run.size_mm" type="number" min="1" step="1" :disabled="readonly" />
      </label>
      <label class="field">
        <span class="field-label">Label</span>
        <input v-model="run.label" placeholder="optional" :disabled="readonly" />
      </label>
    </div>
    <p v-if="!readonly" class="hint panel-hint">Drag the white dots to move the corners.</p>
  </div>

  <!-- what to place or draw -->
  <div v-else class="elec-bar util-bar" @pointerdown.stop>
    <div class="elec-row">
      <select class="circuit-select" :value="utility" :style="{ borderColor: info.color }" aria-label="Utility" @change="setUtility">
        <option v-for="u in UTILITIES" :key="u.id" :value="u.id">{{ u.icon }} {{ u.label }}</option>
      </select>
      <span class="util-totals">
        <template v-if="totals.length">
          <span v-for="t in totals" :key="t.kind.id" :style="{ color: t.kind.color }">{{ t.kind.label }} {{ len(t.length_mm) }}</span>
        </template>
        <template v-else>No {{ info.line }}s yet</template>
      </span>
    </div>
    <div v-if="!readonly" class="elec-row symbols">
      <button
        v-for="k in info.points"
        :key="k.id"
        class="btn sym"
        :class="{ on: tool?.type === 'point' && tool.kind === k.id }"
        :title="k.label"
        :aria-label="k.label"
        :aria-pressed="tool?.type === 'point' && tool.kind === k.id"
        @click="pick('point', k.id)"
      >
        <span class="util-chip" :class="{ box: k.box }">{{ k.code }}</span>
      </button>
    </div>
    <div v-if="!readonly" class="elec-row symbols">
      <button
        v-for="k in info.runs"
        :key="k.id"
        class="btn run-btn"
        :class="{ on: tool?.type === 'run' && tool.kind === k.id }"
        :title="`Draw a ${info.line}: ${k.label.toLowerCase()}`"
        :aria-pressed="tool?.type === 'run' && tool.kind === k.id"
        @click="pick('run', k.id)"
      >
        <span class="util-swatch" :class="{ dashed: k.dashed }" :style="{ color: k.color }"></span>{{ k.label }}
      </button>
    </div>
  </div>
</template>
