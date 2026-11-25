<script setup lang="ts">
import AppIcon from './AppIcon.vue';
import { computed, onMounted, ref, watch } from 'vue';
import { fileIdOf, fileUri, newProject, type Project, uid } from '../model/schema';
import { parseProjectFile } from '../model/migrate';
import type { ProjectSummary, StorageAdapter } from '../storage/types';
import type { RestAdapter } from '../storage/rest';
import { uploadToAccount } from '../storage/upload';
import { allFileIds, deleteUnusedFiles, fileIdsOf } from '../storage/versions';
import { auth, login, logout } from '../auth/session';
import { countDrafts, listDrafts } from '../storage/drafts';

const props = defineProps<{ local: StorageAdapter; rest: RestAdapter }>();
const emit = defineEmits<{ open: [id: string, inAccount: boolean] }>();

const device = ref<ProjectSummary[]>([]);
const account = ref<ProjectSummary[]>([]);
const error = ref('');
const busy = ref('');
/** Plans with changes on this device that never reached the account. */
const drafts = ref(new Set<string>());
const draftCount = ref(0);
const fileInput = ref<HTMLInputElement>();

const loggedIn = computed(() => !!auth.me);
const mine = computed(() => account.value.filter((p) => p.role === 'owner'));
const shared = computed(() => account.value.filter((p) => p.role !== 'owner'));
/** New and imported plans go to the account when you're logged in. */
const target = computed<StorageAdapter>(() => (loggedIn.value ? props.rest : props.local));

async function refresh() {
  error.value = '';
  try {
    device.value = await props.local.list();
  } catch (e) {
    error.value = `Could not read the plans on this device: ${e instanceof Error ? e.message : e}`;
  }
  try {
    account.value = loggedIn.value ? await props.rest.list() : [];
  } catch (e) {
    error.value = `Could not load your account: ${e instanceof Error ? e.message : e}`;
  }
  try {
    drafts.value = new Set(auth.me ? (await listDrafts(auth.me.id)).map((d) => d.projectId) : []);
    draftCount.value = await countDrafts();
  } catch {
    // no IndexedDB: nothing kept
  }
}
onMounted(refresh);
watch(() => auth.me?.id, refresh);

const fileIds = fileIdsOf;

/**
 * A furnished example house (public/demo.floorplan.json), added as a new plan with
 * a version "Current (as bought)" before the renovation walls, so every feature has
 * something to show.
 */
async function openDemo() {
  busy.value = 'Loading the demo house…';
  error.value = '';
  try {
    const res = await fetch(new URL('demo.floorplan.json', document.baseURI));
    if (!res.ok) throw new Error(`The demo house could not be loaded (${res.status}).`);
    const p = parseProjectFile(await res.text()).project;
    const now = new Date().toISOString();
    Object.assign(p, { id: uid(), createdAt: now, updatedAt: now });
    await target.value.put(p);
    const before = JSON.parse(JSON.stringify(p)) as Project;
    for (const f of before.floors) for (const r of f.rooms) for (const w of r.walls) delete w.status;
    await target.value.putVersion(p.id, 'Current (as bought)', before);
    await target.value.putVersion(p.id, 'After renovation – draft 1', p);
    emit('open', p.id, loggedIn.value);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = '';
  }
}

async function create() {
  const name = prompt('Name of the plan', 'My house');
  if (!name?.trim()) return;
  const p = newProject(name.trim());
  try {
    await target.value.put(p);
    emit('open', p.id, loggedIn.value);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

async function importFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  error.value = '';
  const store = target.value;
  try {
    const { project: p, files } = parseProjectFile(await file.text());
    const existing = loggedIn.value ? account.value.find((x) => x.id === p.id) : await store.get(p.id);
    let remap = false;
    if (existing) {
      const replace =
        !('role' in existing && existing.role === 'viewer') &&
        confirm(`"${p.name}" is already here.\n\nOK: replace it.\nCancel: import it as a copy.`);
      if (replace) {
        const full = await store.get(p.id);
        // Replaced: its versions stay, and keep the photos they use.
        if (full) await deleteUnusedFiles(store, full.id, fileIds(full));
      } else {
        p.id = uid();
        p.name = `${p.name} (copy)`;
        remap = true; // a copy gets its own files, so deleting one plan never removes the other's photos
      }
    }
    if (loggedIn.value && !existing) await props.rest.create({ ...p, attachments: [] });
    for (const a of p.attachments) {
      const oldId = fileIdOf(a.uri);
      const data = oldId ? files[oldId] : undefined;
      if (!oldId || !data) continue;
      const id = remap ? uid() : oldId;
      await store.putFile(id, await (await fetch(data)).blob(), a.linkedTo[0]);
      a.uri = fileUri(id);
    }
    await store.put(p);
    await refresh();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

async function remove(p: ProjectSummary, inAccount: boolean) {
  const store = inAccount ? props.rest : props.local;
  const where = inAccount ? 'from your account (for everyone it is shared with)' : 'from this device';
  if (!confirm(`Delete "${p.name}" ${where}? Export it first if you want to keep a copy.`)) return;
  try {
    const full = await store.get(p.id);
    // With its versions, and the photos only they still used.
    if (full) await store.deleteFiles(await allFileIds(store, full));
    await store.delete(p.id);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
  await refresh();
}

async function upload(p: ProjectSummary) {
  busy.value = `Uploading "${p.name}"…`;
  error.value = '';
  try {
    const id = await uploadToAccount(props.local, props.rest, p.id, (d, t) => {
      busy.value = `Uploading "${p.name}": photo ${d} of ${t}…`;
    });
    await refresh();
    if (confirm(`"${p.name}" is now in your account.\n\nDelete the copy on this device?`)) {
      const full = await props.local.get(p.id);
      if (full) await props.local.deleteFiles(await allFileIds(props.local, full));
      await props.local.delete(p.id);
      await refresh();
    }
    emit('open', id, true);
  } catch (e) {
    error.value = `Upload failed: ${e instanceof Error ? e.message : e}`;
  } finally {
    busy.value = '';
  }
}

const when = (s: string) => new Date(s).toLocaleString();
</script>

<template>
  <div class="app-screen">
    <header class="topbar">
      <h1>Floor plans</h1>
      <span class="spacer"></span>
      <template v-if="auth.server">
        <template v-if="loggedIn">
          <span class="account-name" :title="auth.me!.email">{{ auth.me!.name || auth.me!.email }}</span>
          <button class="btn small" @click="logout">Log out</button>
        </template>
        <template v-else-if="auth.config && !auth.config.authEnabled">
          <select class="dev-user" aria-label="Log in as (development)" @change="login(($event.target as HTMLSelectElement).value)">
            <option value="">Log in as… (dev)</option>
            <option v-for="u in auth.config.devUsers ?? ['dev']" :key="u" :value="u">{{ u }}</option>
          </select>
        </template>
        <button v-else class="btn primary small" @click="login()">Log in</button>
      </template>
    </header>
    <main class="page">
      <div class="row-actions">
        <button class="btn primary" @click="create">+ New plan</button>
        <button class="btn" @click="fileInput?.click()">Import file…</button>
        <button class="btn" :disabled="!!busy" title="A furnished example house to try everything on" @click="openDemo">🏠 Try the demo house</button>
        <input ref="fileInput" type="file" accept=".json,application/json" hidden @change="importFile" />
      </div>
      <p v-if="auth.error" class="warn">{{ auth.error }}</p>
      <p v-if="error" class="warn">{{ error }}</p>
      <p v-if="busy" class="hint">{{ busy }}</p>
      <p v-if="!loggedIn && auth.server && draftCount" class="warn">
        This device has changes that were not saved to your account yet. Log in, then open the plan to choose which version to keep.
      </p>

      <template v-if="loggedIn">
        <h2 class="list-title">In your account</h2>
        <ul v-if="mine.length" class="list">
          <li v-for="p in mine" :key="p.id" class="list-row">
            <button class="list-item" @click="emit('open', p.id, true)">
              <span>{{ p.name }} <span v-if="drafts.has(p.id)" class="role-tag unsaved">unsaved changes on this device</span></span>
              <small>Changed {{ when(p.updatedAt) }}</small>
            </button>
            <button class="btn icon danger" :aria-label="`Delete ${p.name}`" @click="remove(p, true)"><AppIcon name="trash" /></button>
          </li>
        </ul>
        <p v-else class="hint">Nothing yet. New plans go here; you can also upload the ones on this device.</p>

        <template v-if="shared.length">
          <h2 class="list-title">Shared with you</h2>
          <ul class="list">
            <li v-for="p in shared" :key="p.id" class="list-row">
              <button class="list-item" @click="emit('open', p.id, true)">
                <span>{{ p.name }} <span v-if="drafts.has(p.id)" class="role-tag unsaved">unsaved changes on this device</span> <span class="role-tag" :class="p.role">{{ p.role === 'viewer' ? 'view only' : 'can edit' }}</span></span>
                <small>{{ p.ownerName }} · changed {{ when(p.updatedAt) }}</small>
              </button>
            </li>
          </ul>
        </template>
      </template>

      <template v-if="device.length || !loggedIn">
        <h2 v-if="loggedIn" class="list-title">On this device</h2>
        <ul v-if="device.length" class="list">
          <li v-for="p in device" :key="p.id" class="list-row">
            <button class="list-item" @click="emit('open', p.id, false)">
              <span>{{ p.name }}</span>
              <small>Changed {{ when(p.updatedAt) }}</small>
            </button>
            <button
              v-if="loggedIn"
              class="btn"
              :disabled="!!busy"
              title="Save to my account (with its photos)"
              @click="upload(p)"
            >
              ⇪
            </button>
            <button class="btn icon danger" :aria-label="`Delete ${p.name}`" @click="remove(p, false)"><AppIcon name="trash" /></button>
          </li>
        </ul>
        <div v-else class="empty-hint static">
          <p>No plans yet.</p>
          <p>Start a new plan, then add rooms by typing in the walls you measured with your laser meter.</p>
          <p>Or open the <button class="link-button" @click="openDemo">demo house</button> to look around first.</p>
        </div>
      </template>

      <p v-if="!auth.server" class="hint">
        Plans are saved in this browser on this device only. Use Export → project file to keep a backup.
      </p>
      <p v-else-if="!loggedIn" class="hint">
        Plans are saved on this device. Log in to keep them in your account, share them, and add photos to
        notes.
      </p>
    </main>
  </div>
</template>
