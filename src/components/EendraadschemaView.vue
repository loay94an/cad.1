<script setup lang="ts">
/** Shows the single-line diagram, with export to SVG and PDF. */
import { computed, ref } from 'vue';
import type { Project } from '../model/schema';
import { checkInstallation } from '../electrical/arei';
import { roomNameFn } from '../electrical/rooms';
import { exportSchemaPdf, exportSchemaSvg, type Paper } from '../export/exporters';
import EendraadschemaSvg from './EendraadschemaSvg.vue';

const props = defineProps<{ project: Project }>();
const emit = defineEmits<{ close: []; boards: [] }>();

const roomName = computed(() => roomNameFn(props.project));
const errors = computed(
  () => checkInstallation(props.project.electrical!, { roomName: roomName.value }).filter((i) => i.level === 'error').length,
);
const paper = ref<Paper>('A3');
const busy = ref(false);
const error = ref('');
const zoom = ref(1);

async function pdf() {
  busy.value = true;
  error.value = '';
  try {
    await exportSchemaPdf(props.project, paper.value);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="sheet schema-view">
    <header class="topbar">
      <button class="btn ghost" aria-label="Close" @click="emit('close')">‹</button>
      <h1 class="title-block">Eendraadschema</h1>
      <button class="btn" @click="emit('boards')">⚡ Fuse boxes</button>
    </header>
    <div class="schema-tools">
      <button class="btn small" aria-label="Zoom out" @click="zoom = Math.max(0.4, zoom / 1.25)">−</button>
      <button class="btn small" aria-label="Zoom in" @click="zoom = Math.min(3, zoom * 1.25)">+</button>
      <span class="spacer"></span>
      <button class="btn small" @click="exportSchemaSvg(project)">SVG</button>
      <select v-model="paper" class="mod-select" aria-label="Paper">
        <option>A4</option>
        <option>A3</option>
      </select>
      <button class="btn small primary" :disabled="busy" @click="pdf">PDF</button>
    </div>
    <p v-if="errors" class="warn schema-warn">
      The AREI check finds {{ errors }} error(s). See Fuse boxes → AREI check.
    </p>
    <p v-if="error" class="warn">{{ error }}</p>
    <div class="schema-scroll">
      <div :style="{ transform: `scale(${zoom})`, transformOrigin: '0 0' }">
        <EendraadschemaSvg
          :electrical="project.electrical!"
          :title="`${project.name} – eendraadschema`"
          :room-name="roomName"
        />
      </div>
    </div>
  </div>
</template>
