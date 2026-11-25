<script setup lang="ts">
/** A note dot's contents, shown next to the dot on the floor view. */
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { type Attachment, type NotePin, fileIdOf } from '../model/schema';
import type { StorageAdapter } from '../storage/types';

const props = defineProps<{
  pin: NotePin;
  number: number;
  roomName: string;
  attachments: Attachment[];
  storage: StorageAdapter;
  /** Where the dot is, in pixels inside the canvas area. */
  at: { x: number; y: number };
  box: { w: number; h: number };
  canEdit?: boolean;
}>();
const emit = defineEmits<{ edit: []; close: [] }>();

const urls = ref<Record<string, string>>({});
const viewing = ref<Attachment | null>(null);

async function load() {
  for (const a of props.attachments) {
    const fid = fileIdOf(a.uri);
    if (!fid || urls.value[a.id]) continue;
    const blob = await props.storage.getFile(fid);
    if (blob) urls.value = { ...urls.value, [a.id]: URL.createObjectURL(blob) };
  }
}
watch(() => props.attachments.map((a) => a.id).join(), load, { immediate: true });
onBeforeUnmount(() => Object.values(urls.value).forEach((u) => URL.revokeObjectURL(u)));

const W = 280;
/** Next to the dot, kept inside the canvas; below it when there's room, else above. */
const style = computed(() => {
  const w = Math.min(W, props.box.w - 16);
  const left = Math.min(Math.max(8, props.at.x - w / 2), props.box.w - w - 8);
  const below = props.at.y < props.box.h * 0.55;
  return below
    ? { left: `${left}px`, top: `${props.at.y + 22}px`, width: `${w}px` }
    : { left: `${left}px`, bottom: `${props.box.h - props.at.y + 22}px`, width: `${w}px` };
});

function open(a: Attachment) {
  if (a.kind === 'photo') {
    viewing.value = a;
    return;
  }
  const url = urls.value[a.id];
  if (url) window.open(url, '_blank', 'noopener');
}
</script>

<template>
  <div class="note-popup" :style="style" role="dialog" :aria-label="pin.title || 'Note'" @pointerdown.stop>
    <div class="note-popup-head">
      <span class="pin-dot small">{{ number }}</span>
      <div class="note-popup-title">
        <strong>{{ pin.title || 'Note' }}</strong>
        <small>{{ roomName }}</small>
      </div>
      <button class="btn icon small ghost" aria-label="Close" @click="emit('close')">✕</button>
    </div>
    <p v-if="pin.text" class="note-popup-text">{{ pin.text }}</p>
    <p v-else-if="!attachments.length" class="hint">Nothing written yet.</p>
    <div v-if="attachments.length" class="note-thumbs">
      <button v-for="a in attachments" :key="a.id" class="thumb" :aria-label="`Open ${a.name}`" @click="open(a)">
        <img v-if="a.kind === 'photo' && urls[a.id]" :src="urls[a.id]" alt="" />
        <span v-else class="doc-icon">{{ a.mime?.includes('pdf') ? 'PDF' : 'FILE' }}</span>
      </button>
    </div>
    <div v-if="canEdit" class="row-actions end">
      <button class="btn small" @click="emit('edit')">✎ Edit</button>
    </div>
    <Teleport to="body">
      <div v-if="viewing" class="viewer" @click="viewing = null">
        <img :src="urls[viewing.id]" :alt="viewing.text || viewing.name" />
        <p>{{ viewing.text || viewing.name }}</p>
      </div>
    </Teleport>
  </div>
</template>
