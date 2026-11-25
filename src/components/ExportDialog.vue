<script setup lang="ts">
/** Save the plan as PDF, PNG, JPG or SVG, choosing what it shows; or the whole project as a file. */
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { DEFAULT_VIEW, type Floor, type Project, type ViewSettings } from '../model/schema';
import { UTILITIES, type UtilityId } from '../model/utilities';
import type { StorageAdapter } from '../storage/types';
import { type ExportOptions, type Paper, STANDARD_SCALES, exportImage, exportJson, exportPdf, exportSvg, previewUrl } from '../export/exporters';

const props = defineProps<{ project: Project; floor: Floor; storage: StorageAdapter }>();
const emit = defineEmits<{ close: [] }>();

const paper = ref<Paper>('A4');
const scale = ref<number | 'auto'>('auto');
const which = ref<'this' | 'all'>('this');
const size = ref(3000);
const busy = ref(false);
const message = ref('');
const error = ref('');

/** Starts from what the plan shows; changes here only affect the export. */
const view = reactive<ViewSettings>({ ...DEFAULT_VIEW, ...props.project.settings.view });
const items: { key: keyof ViewSettings; label: string }[] = [
  { key: 'dimensions', label: 'Wall measurements' },
  { key: 'names', label: 'Room names & areas' },
  { key: 'angles', label: 'Corner angles' },
  { key: 'notes', label: 'Notes (dots)' },
  { key: 'furniture', label: 'Furniture' },
  { key: 'finishes', label: 'Floor finishes' },
  { key: 'installations', label: 'Electrical' },
  { key: 'utilities', label: 'Utilities' },
];
const stackItems = computed(() =>
  props.project.floors.length > 1
    ? ([
        { key: 'below', label: 'Floor below (outline)' },
        { key: 'above', label: 'Floor above (outline)' },
      ] as typeof items)
    : [],
);
/** The utilities that have something drawn, each with its own tick. */
const used = computed(() => UTILITIES.filter((u) => props.project.utilities?.points.some((p) => p.utility === u.id) || props.project.utilities?.runs.some((r) => r.utility === u.id)));
const utilOn = reactive<Record<string, boolean>>(Object.fromEntries(UTILITIES.map((u) => [u.id, true])));

const floors = computed(() => (which.value === 'all' ? [...props.project.floors].sort((a, b) => a.level - b.level) : [props.floor]));
const options = computed<ExportOptions>(() => ({
  view: { ...view },
  utilities: UTILITIES.filter((u) => utilOn[u.id]).map((u) => u.id as UtilityId),
}));

// ---- preview -------------------------------------------------------------------
const preview = ref('');
let token = 0;
watch(
  options,
  async (o) => {
    const mine = ++token;
    try {
      const url = await previewUrl(props.project, props.floor, o);
      if (mine !== token) return URL.revokeObjectURL(url);
      if (preview.value) URL.revokeObjectURL(preview.value);
      preview.value = url;
    } catch {
      // The preview is a convenience; saving reports its own errors.
    }
  },
  { immediate: true },
);
onBeforeUnmount(() => preview.value && URL.revokeObjectURL(preview.value));

async function run(kind: 'pdf' | 'png' | 'jpg' | 'svg' | 'json') {
  busy.value = true;
  error.value = '';
  message.value = '';
  const n = floors.value.length;
  const files = n === 1 ? '' : ` (${n} files, one per floor)`;
  try {
    if (kind === 'pdf') {
      const used = await exportPdf(props.project, floors.value, paper.value, scale.value, options.value);
      message.value = `PDF saved at 1:${used} on ${paper.value}${n === 1 ? '' : `, ${n} pages`}.`;
    } else if (kind === 'svg') {
      exportSvg(props.project, floors.value, options.value);
      message.value = `SVG saved${files}.`;
    } else if (kind === 'png' || kind === 'jpg') {
      await exportImage(props.project, floors.value, kind, size.value, options.value);
      message.value = `${kind.toUpperCase()} saved${files}.`;
    } else {
      const count = await exportJson(props.project, props.storage);
      message.value =
        `Project file saved${count ? ` with ${count} photo${count === 1 ? '' : 's'}/document${count === 1 ? '' : 's'}` : ''}. ` +
        'Keep it somewhere safe; you can import it again later.';
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="backdrop" @click.self="emit('close')">
    <div class="dialog export-dialog">
      <h2>Export</h2>

      <section>
        <h3>What to show</h3>
        <div class="export-pick">
          <div class="export-checks">
            <label v-if="project.floors.length > 1" class="field">
              <span class="field-label">Floors</span>
              <select v-model="which">
                <option value="this">{{ floor.name }}</option>
                <option value="all">All {{ project.floors.length }} floors</option>
              </select>
            </label>
            <label v-for="i in [...items, ...stackItems]" :key="i.key" class="check">
              <input v-model="view[i.key]" type="checkbox" />
              <span>{{ i.label }}</span>
            </label>
            <div v-if="view.utilities && used.length > 1" class="export-sub">
              <label v-for="u in used" :key="u.id" class="check">
                <input v-model="utilOn[u.id]" type="checkbox" />
                <span>{{ u.icon }} {{ u.label }}</span>
              </label>
            </div>
          </div>
          <img v-if="preview" class="export-preview" :src="preview" :alt="`Preview of ${floor.name}`" />
        </div>
        <p class="hint">These choices are for this export only; the plan on screen keeps its own.</p>
      </section>

      <section>
        <h3>PDF to scale</h3>
        <div class="row-actions">
          <label class="field">
            <span class="field-label">Paper</span>
            <select v-model="paper">
              <option value="A4">A4</option>
              <option value="A3">A3</option>
            </select>
          </label>
          <label class="field">
            <span class="field-label">Scale</span>
            <select v-model="scale">
              <option value="auto">Largest that fits</option>
              <option v-for="s in STANDARD_SCALES" :key="s" :value="s">1:{{ s }}</option>
            </select>
          </label>
        </div>
        <button class="btn primary wide" :disabled="busy" @click="run('pdf')">Save PDF</button>
      </section>

      <section>
        <h3>Picture or drawing</h3>
        <div class="row-actions">
          <label class="field">
            <span class="field-label">Picture size</span>
            <select v-model.number="size">
              <option :value="1600">Small (1600 px)</option>
              <option :value="3000">Normal (3000 px)</option>
              <option :value="6000">Large (6000 px)</option>
            </select>
          </label>
        </div>
        <div class="row-actions">
          <button class="btn" :disabled="busy" @click="run('png')">Save PNG</button>
          <button class="btn" :disabled="busy" @click="run('jpg')">Save JPG</button>
          <button class="btn" :disabled="busy" title="A drawing that stays sharp at any size" @click="run('svg')">Save SVG</button>
        </div>
      </section>

      <section>
        <h3>Whole project</h3>
        <p class="hint">All floors, rooms, measurements, notes, photos and documents as one JSON file. Use it as a backup or to move to another device.</p>
        <button class="btn wide" :disabled="busy" @click="run('json')">Save project file (.json)</button>
      </section>

      <p v-if="busy" class="hint">Working…</p>
      <p v-if="message" class="status ok">{{ message }}</p>
      <p v-if="error" class="warn">{{ error }}</p>

      <div class="row-actions end">
        <button class="btn" @click="emit('close')">Close</button>
      </div>
    </div>
  </div>
</template>
