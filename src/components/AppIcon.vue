<script setup lang="ts">
/**
 * Small line icons drawn in the text colour, so they match the button they sit
 * in (colour emoji like 🗑 look out of place, and differ per device).
 */
defineProps<{ name: 'trash' | 'copy' }>();
</script>

<template>
  <svg
    class="app-icon"
    viewBox="0 0 24 24"
    width="1.1em"
    height="1.1em"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <template v-if="name === 'trash'">
      <path d="M4 7h16" />
      <path d="M10 3h4" />
      <path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
      <path d="M10 11v6M14 11v6" />
    </template>
    <template v-else>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
    </template>
  </svg>
</template>

<style scoped>
.app-icon {
  display: inline-block;
  vertical-align: -0.2em;
  flex: none;
}
</style>
