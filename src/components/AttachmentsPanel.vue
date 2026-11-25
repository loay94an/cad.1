<script setup lang="ts">
import AppIcon from './AppIcon.vue';
/** Photos and documents for a room. Files go straight into storage; the list is saved with the room. */
import { onBeforeUnmount, ref, watch } from 'vue';
import { type Attachment, fileIdOf, fileUri, uid } from '../model/schema';
import type { StorageAdapter } from '../storage/types';

/** `linkedTo`: what new files belong to, e.g. [roomId] or [roomId, pinId]. */
const props = defineProps<{ items: Attachment[]; linkedTo: string[]; storage: StorageAdapter; compact?: boolean }>();
const emit = defineEmits<{ add: [att: Attachment]; remove: [id: string] }>();

const camera = ref<HTMLInputElement>();
const picker = ref<HTMLInputElement>();
const busy = ref(false);
const error = ref('');
const urls = ref<Record<string, string>>({});
const viewing = ref<Attachment | null>(null);

async function loadUrls() {
  for (const a of props.items) {
    const fid = fileIdOf(a.uri);
    if (!fid || urls.value[a.id]) continue;
    const blob = await props.storage.getFile(fid);
    if (blob) urls.value = { ...urls.value, [a.id]: URL.createObjectURL(blob) };
  }
}
watch(() => props.items.map((a) => a.id).join(), loadUrls, { immediate: true });
onBeforeUnmount(() => Object.values(urls.value).forEach((u) => URL.revokeObjectURL(u)));

async function addFiles(e: Event) {
  const input = e.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  input.value = '';
  if (!files.length) return;
  busy.value = true;
  error.value = '';
  try {
    for (const file of files) {
      const id = uid();
      await props.storage.putFile(id, file, props.linkedTo[0]);
      emit('add', {
        id,
        kind: file.type.startsWith('image/') ? 'photo' : 'document',
        name: file.name || (file.type.startsWith('image/') ? 'Photo' : 'File'),
        mime: file.type || undefined,
        size: file.size,
        uri: fileUri(id),
        text: '',
        tags: [],
        linkedTo: [...props.linkedTo],
        createdAt: new Date().toISOString(),
      });
    }
  } catch (err) {
    error.value = `Could not store the file: ${err instanceof Error ? err.message : err}`;
  } finally {
    busy.value = false;
  }
}

function open(a: Attachment) {
  if (a.kind === 'photo') {
    viewing.value = a;
    return;
  }
  const url = urls.value[a.id];
  if (!url) return;
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener';
  if (!a.mime?.startsWith('application/pdf')) link.download = a.name;
  link.click();
}

function remove(a: Attachment) {
  if (confirm(`Remove "${a.name}" from this room?`)) emit('remove', a.id);
}

const sizeText = (n?: number) =>
  !n ? '' : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} kB`;
</script>

<template>
  <div>
    <p v-if="!storage.filesAllowed" class="hint">
      📷 Log in to add photos and documents: they're kept in your account, not on this device.
    </p>
    <div v-else class="row-actions">
      <button class="btn" :disabled="busy" @click="camera?.click()">📷 Take photo</button>
      <button class="btn" :disabled="busy" @click="picker?.click()">📎 Add photo or file</button>
      <input ref="camera" type="file" accept="image/*" capture="environment" hidden @change="addFiles" />
      <input ref="picker" type="file" multiple hidden @change="addFiles" />
    </div>
    <p v-if="busy" class="hint">Saving…</p>
    <p v-if="error" class="warn">{{ error }}</p>
    <p v-if="!items.length && !compact && storage.filesAllowed" class="hint">
      No photos or documents yet. Useful: the electrical panel, behind a wall before it was closed, manuals,
      receipts.
    </p>
    <ul class="attachments">
      <li v-for="a in items" :key="a.id" class="attachment">
        <button class="thumb" :aria-label="`Open ${a.name}`" @click="open(a)">
          <img v-if="a.kind === 'photo' && urls[a.id]" :src="urls[a.id]" alt="" />
          <span v-else class="doc-icon">{{ a.mime?.includes('pdf') ? 'PDF' : 'FILE' }}</span>
        </button>
        <div class="attachment-body">
          <input v-model="a.text" :placeholder="a.kind === 'photo' ? 'Caption' : 'Description'" />
          <small>{{ a.name }} · {{ sizeText(a.size) }}</small>
        </div>
        <button class="btn icon danger" aria-label="Remove" title="Remove" @click="remove(a)"><AppIcon name="trash" /></button>
      </li>
    </ul>

    <div v-if="viewing" class="viewer" @click="viewing = null">
      <img :src="urls[viewing.id]" :alt="viewing.text || viewing.name" />
      <p>{{ viewing.text || viewing.name }}</p>
    </div>
  </div>
</template>
