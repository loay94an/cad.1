<script setup lang="ts">
/** The mode switch on the main screen. Each mode has its own accent colour. */
import { MODES, type AppMode } from './modes';

defineProps<{ mode: AppMode; readonly?: boolean }>();
const emit = defineEmits<{ 'update:mode': [mode: AppMode] }>();
</script>

<template>
  <nav class="mode-bar" role="tablist" aria-label="Mode" @pointerdown.stop>
    <button
      v-for="(m, i) in MODES"
      :key="m.id"
      role="tab"
      class="mode-seg"
      :class="[`m-${m.id}`, { on: mode === m.id }]"
      :aria-selected="mode === m.id"
      :disabled="m.soon || (readonly && m.id !== 'view')"
      :title="`${m.label}${m.soon ? ' (later)' : ''} (${i + 1})`"
      @click="emit('update:mode', m.id)"
    >
      <span class="mode-icon" aria-hidden="true">{{ m.icon }}</span>
      <span class="mode-label">{{ m.label }}</span>
    </button>
  </nav>
</template>
