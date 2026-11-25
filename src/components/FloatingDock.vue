<script setup lang="ts">
/**
 * The floating button at the bottom right of the floor view. Tap it (or press
 * Space) to show the actions: add a room, undo/redo and the floor switch.
 */
import type { Floor } from '../model/schema';

defineProps<{
  open: boolean;
  floors: Floor[];
  floorId: string;
  canUndo: boolean;
  canRedo: boolean;
  canAdd: boolean;
  readonly?: boolean;
}>();
const emit = defineEmits<{
  'update:open': [open: boolean];
  addRoom: [];
  fit: [];
  undo: [];
  redo: [];
  floor: [id: string];
  addFloor: [];
}>();

function onFloor(e: Event) {
  const v = (e.target as HTMLSelectElement).value;
  if (v === '__new') {
    (e.target as HTMLSelectElement).value = '';
    emit('addFloor');
  } else emit('floor', v);
}
</script>

<template>
  <div class="dock" :class="{ open }" @pointerdown.stop>
    <Transition name="dock">
      <div v-if="open" class="dock-panel" role="menu">
        <label class="dock-floor">
          <span class="field-label">Floor</span>
          <select :value="floorId" aria-label="Floor" @change="onFloor">
            <option v-for="f in floors" :key="f.id" :value="f.id">{{ f.name }}</option>
            <option v-if="!readonly" value="__new">+ New floor…</option>
          </select>
        </label>
        <div v-if="!readonly" class="dock-row">
          <button class="btn" aria-label="Undo" title="Undo (Ctrl+Z)" :disabled="!canUndo" @click="emit('undo')">↶</button>
          <button class="btn" aria-label="Redo" title="Redo (Ctrl+Y)" :disabled="!canRedo" @click="emit('redo')">↷</button>
        </div>
        <button v-if="canAdd" class="btn primary" title="New room (N)" @click="emit('addRoom')">+ Room</button>
      </div>
    </Transition>
    <button
      class="fab"
      :aria-expanded="open"
      :aria-label="open ? 'Hide actions' : 'Show actions'"
      title="Actions (Space)"
      @click="emit('update:open', !open)"
    >
      {{ open ? '✕' : '✚' }}
    </button>
  </div>
</template>
