<script setup lang="ts">
/** Choose what the plan shows. Changes the project's view settings directly (they're saved with it). */
import type { ViewSettings } from '../model/schema';

const props = withDefaults(defineProps<{ view: ViewSettings; autoZoom?: boolean; stack?: boolean }>(), { autoZoom: undefined });
const emit = defineEmits<{ close: []; 'update:autoZoom': [on: boolean] }>();

const items: { key: keyof ViewSettings; label: string; later?: boolean }[] = [
  { key: 'grid', label: 'Background grid (1 m)' },
  { key: 'dimensions', label: 'Wall measurements' },
  { key: 'names', label: 'Room names & areas' },
  { key: 'angles', label: 'Corner angles' },
  { key: 'notes', label: 'Notes (dots)' },
  { key: 'furniture', label: 'Furniture' },
  { key: 'finishes', label: 'Floor finishes' },
  { key: 'installations', label: 'Electrical (sockets, lights, …)' },
  { key: 'utilities', label: 'Utilities (water, heating, …)' },
];
/** Only where there are floors to stack (the floor view of a house with more than one). */
const stackItems: typeof items = [
  { key: 'below', label: 'Floor below (outline)' },
  { key: 'above', label: 'Floor above (outline)' },
];
const shown = () => (props.stack ? [...items, ...stackItems] : items);
</script>

<template>
  <div class="view-menu" role="dialog" aria-label="What to show" @pointerdown.stop @wheel.stop>
    <div class="view-menu-head">
      <strong>Show</strong>
      <button class="btn ghost small" aria-label="Close" @click="emit('close')">✕</button>
    </div>
    <label v-for="i in shown()" :key="i.key" class="check" :class="{ later: i.later }">
      <input v-model="view[i.key]" type="checkbox" :disabled="i.later" />
      <span>{{ i.label }}<small v-if="i.later"> (later)</small></span>
    </label>
    <p class="hint">Exports start from the same choices.</p>
    <label v-if="autoZoom !== undefined" class="check view-extra">
      <input type="checkbox" :checked="autoZoom" @change="emit('update:autoZoom', ($event.target as HTMLInputElement).checked)" />
      <span>Zoom to what I select</span>
    </label>
  </div>
</template>
