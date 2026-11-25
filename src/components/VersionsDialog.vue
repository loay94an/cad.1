<script setup lang="ts">
import AppIcon from './AppIcon.vue';
/**
 * Named snapshots of the plan ("Current", "After renovation"): save one, look at
 * one, restore it, or start a separate plan from it.
 */
import { onMounted, ref, toRaw } from 'vue';
import { type Attachment, type Project, fileIdOf, fileUri, uid } from '../model/schema';
import type { StorageAdapter, VersionSummary } from '../storage/types';
import { RestAdapter } from '../storage/rest';
import { deleteUnusedFiles, fileIdsOf } from '../storage/versions';

const props = defineProps<{ project: Project; storage: StorageAdapter; readonly: boolean }>();
const emit = defineEmits<{ close: []; look: [v: VersionSummary]; restore: [v: VersionSummary] }>();

const versions = ref<VersionSummary[]>([]);
const loading = ref(true);
const busy = ref('');
const error = ref('');
const message = ref('');
const name = ref('');

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

async function refresh() {
  try {
    versions.value = await props.storage.listVersions(props.project.id);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}
onMounted(refresh);

async function run(what: string, f: () => Promise<void>) {
  busy.value = what;
  error.value = '';
  message.value = '';
  try {
    await f();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = '';
  }
}

const save = () =>
  run('Saving…', async () => {
    const n = name.value.trim();
    if (!n) return;
    const v = await props.storage.putVersion(props.project.id, n, JSON.parse(JSON.stringify(toRaw(props.project))));
    name.value = '';
    message.value = `Saved “${v.name}”.`;
    await refresh();
  });

function remove(v: VersionSummary) {
  if (!confirm(`Delete the version “${v.name}”? The plan itself stays as it is.`)) return;
  void run('Deleting…', async () => {
    const doc = await props.storage.getVersion(props.project.id, v.id);
    await props.storage.deleteVersion(props.project.id, v.id);
    // Photos only this version still used can go now.
    const inPlan = new Set(fileIdsOf(props.project));
    if (doc) await deleteUnusedFiles(props.storage, props.project.id, fileIdsOf(doc).filter((id) => !inPlan.has(id)));
    await refresh();
  });
}

/** A separate plan from this version, with its own copies of the photos and documents. */
function saveAsPlan(v: VersionSummary) {
  const planName = prompt('Name of the new plan', `${props.project.name} – ${v.name}`)?.trim();
  if (!planName) return;
  void run('Copying…', async () => {
    const doc = await props.storage.getVersion(props.project.id, v.id);
    if (!doc) throw new Error('This version could not be found.');
    const now = new Date().toISOString();
    const copy: Project = { ...doc, id: uid(), name: planName, createdAt: now, updatedAt: now, attachments: [] };
    const rest = props.storage instanceof RestAdapter ? props.storage : null;
    if (rest) await rest.create(copy);
    else await props.storage.put(copy);
    const attachments: Attachment[] = [];
    for (const [i, a] of doc.attachments.entries()) {
      busy.value = `Copying photos and documents: ${i + 1} of ${doc.attachments.length}…`;
      const oldId = fileIdOf(a.uri);
      const blob = oldId ? await props.storage.getFile(oldId) : undefined;
      if (!oldId || !blob) {
        if (!oldId) attachments.push(a);
        continue;
      }
      const id = uid();
      if (rest) await rest.putFile(id, blob, a.linkedTo[0], copy.id);
      else await props.storage.putFile(id, blob, a.linkedTo[0]);
      attachments.push({ ...a, uri: fileUri(id) });
    }
    await props.storage.put({ ...copy, attachments, updatedAt: new Date().toISOString() });
    message.value = `“${planName}” is in your plan list (‹ All plans).`;
  });
}

</script>

<template>
  <div class="backdrop" @click.self="emit('close')">
    <div class="dialog versions-dialog">
      <h2>Versions</h2>
      <p class="hint">
        A version is a copy of the whole plan as it is now, e.g. “Current” before you draw the renovation. Photos and
        documents are shared, not copied.
      </p>

      <section v-if="!readonly">
        <h3>Save this plan as a version</h3>
        <form class="row-actions" @submit.prevent="save">
          <label class="field">
            <span class="field-label">Name</span>
            <input v-model="name" maxlength="200" placeholder="e.g. Current, After renovation" />
          </label>
          <button class="btn primary" type="submit" :disabled="!name.trim() || !!busy">Save version</button>
        </form>
      </section>

      <section>
        <h3>Saved versions</h3>
        <p v-if="loading" class="hint">Loading…</p>
        <p v-else-if="!versions.length" class="hint">None yet.</p>
        <ul v-else class="version-list">
          <li v-for="v in versions" :key="v.id" :class="{ auto: v.auto }">
            <div class="version-head">
              <strong>{{ v.name }}</strong>
              <small>{{ when(v.createdAt) }}{{ v.createdBy ? ` · ${v.createdBy}` : '' }}{{ v.auto ? ' · automatic' : '' }}</small>
            </div>
            <div class="row-actions">
              <button class="btn small" :disabled="!!busy" @click="emit('look', v)">👁 Open to look</button>
              <button v-if="!readonly" class="btn small" :disabled="!!busy" @click="emit('restore', v)">↺ Restore</button>
              <button class="btn small" :disabled="!!busy" @click="saveAsPlan(v)"><AppIcon name="copy" /> Save as a new plan</button>
              <button v-if="!readonly" class="btn small danger" :disabled="!!busy" @click="remove(v)"><AppIcon name="trash" /> Delete</button>
            </div>
          </li>
        </ul>
        <p class="hint">Automatic versions are made before a restore; the last 10 are kept. Named ones stay until you delete them.</p>
      </section>

      <p v-if="busy" class="hint">{{ busy }}</p>
      <p v-if="message" class="status ok">{{ message }}</p>
      <p v-if="error" class="warn">{{ error }}</p>

      <div class="row-actions end">
        <button class="btn" @click="emit('close')">Close</button>
      </div>
    </div>
  </div>
</template>
