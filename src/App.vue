<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { IndexedDbAdapter } from './storage/indexeddb';
import { RestAdapter } from './storage/rest';
import { auth, initAuth } from './auth/session';
import ProjectList from './components/ProjectList.vue';
import ProjectView from './components/ProjectView.vue';

const local = new IndexedDbAdapter();
const rest = new RestAdapter();

/**
 * The open plan lives in the URL hash so the phone's back button works:
 * `#account/<id>` for a plan in your account, `#<id>` for one on this device.
 */
const hash = ref(location.hash.slice(1));
const onHash = () => (hash.value = location.hash.slice(1));
onMounted(() => {
  addEventListener('hashchange', onHash);
  void initAuth().then(onHash);
});
onBeforeUnmount(() => removeEventListener('hashchange', onHash));

const opened = computed(() => {
  const h = decodeURIComponent(hash.value);
  if (!h) return null;
  return h.startsWith('account/') ? { id: h.slice(8), storage: rest } : { id: h, storage: local };
});

const open = (id: string, inAccount: boolean) => (location.hash = inAccount ? `account/${id}` : id);
const back = () => {
  if (history.length > 1 && location.hash) history.back();
  else location.hash = '';
};
</script>

<template>
  <div v-if="!auth.ready" class="app-screen loading">Loading…</div>
  <ProjectView
    v-else-if="opened && (opened.storage === local || auth.me)"
    :id="opened.id"
    :key="hash"
    :storage="opened.storage"
    @back="back"
  />
  <ProjectList v-else :local="local" :rest="rest" @open="open" />
</template>
