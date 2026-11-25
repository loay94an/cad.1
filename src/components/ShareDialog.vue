<script setup lang="ts">
/** Who else can open this plan: view only, or edit. */
import { onMounted, ref } from 'vue';
import type { RestAdapter, Share } from '../storage/rest';

const props = defineProps<{ homeId: string; name: string; rest: RestAdapter }>();
const emit = defineEmits<{ close: [] }>();

const shares = ref<Share[]>([]);
const email = ref('');
const role = ref<Share['role']>('viewer');
const error = ref('');
const busy = ref(false);

async function load() {
  try {
    shares.value = await props.rest.shares(props.homeId);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}
onMounted(load);

async function run(fn: () => Promise<void>) {
  busy.value = true;
  error.value = '';
  try {
    await fn();
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}

function add() {
  const e = email.value.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+$/.test(e)) {
    error.value = 'Type an email address.';
    return;
  }
  void run(async () => {
    await props.rest.share(props.homeId, e, role.value);
    email.value = '';
  });
}
</script>

<template>
  <div class="backdrop" @click.self="emit('close')">
    <div class="dialog">
      <h2>Share “{{ name }}”</h2>
      <p class="hint">
        People log in with this email address. View only: they can look at the plan, notes and photos. Can edit: they
        can change everything except sharing and deleting the plan.
      </p>
      <form class="share-add" @submit.prevent="add">
        <input v-model="email" type="email" placeholder="name@example.com" autocomplete="email" aria-label="Email" />
        <select v-model="role" aria-label="Role">
          <option value="viewer">View only</option>
          <option value="editor">Can edit</option>
        </select>
        <button class="btn primary" :disabled="busy">Share</button>
      </form>
      <p v-if="error" class="warn">{{ error }}</p>
      <ul v-if="shares.length" class="list">
        <li v-for="s in shares" :key="s.email" class="share-row">
          <span class="share-email">{{ s.email }}</span>
          <select
            :value="s.role"
            :disabled="busy"
            aria-label="Role"
            @change="run(() => rest.share(homeId, s.email, ($event.target as HTMLSelectElement).value as Share['role']))"
          >
            <option value="viewer">View only</option>
            <option value="editor">Can edit</option>
          </select>
          <button class="btn icon danger" :disabled="busy" :aria-label="`Stop sharing with ${s.email}`" @click="run(() => rest.unshare(homeId, s.email))">
            ✕
          </button>
        </li>
      </ul>
      <p v-else class="hint">Not shared with anyone yet.</p>
      <div class="row-actions end">
        <button class="btn" @click="emit('close')">Close</button>
      </div>
    </div>
  </div>
</template>
