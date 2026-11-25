<script setup lang="ts">
/** The buttons at the top right of a drawing: zoom, fit, the measuring tape and what to show. */
// Boolean props default to false in Vue; undefined here means "don't show that button".
withDefaults(defineProps<{ autoZoom?: boolean; fitLabel?: string; viewOpen?: boolean; measuring?: boolean; threeD?: boolean }>(), {
  autoZoom: undefined,
  measuring: undefined,
});
const emit = defineEmits<{ zoomIn: []; zoomOut: []; fit: []; view: []; measure: []; threeD: []; 'update:autoZoom': [value: boolean] }>();
</script>

<template>
  <div class="zoom-controls" @pointerdown.stop>
    <div class="zgroup mouse-only">
      <button class="zbtn" aria-label="Zoom in (+)" title="Zoom in (+)" @click="emit('zoomIn')">+</button>
      <button class="zbtn" aria-label="Zoom out (−)" title="Zoom out (−)" @click="emit('zoomOut')">−</button>
    </div>
    <div class="zgroup">
      <button class="zbtn" :aria-label="`${fitLabel ?? 'Reset zoom'} (F)`" :title="`${fitLabel ?? 'Reset zoom'} (F)`" @click="emit('fit')">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 8V3h5M12 3h5v5M17 12v5h-5M8 17H3v-5" /></svg>
      </button>
      <button
        v-if="measuring !== undefined"
        class="zbtn"
        :class="{ on: measuring }"
        :aria-pressed="measuring"
        aria-label="Measure (M)"
        title="Measure a distance or an area (M)"
        @click="emit('measure')"
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M2.5 13.5 13.5 2.5l4 4-11 11zM6 10l1.5 1.5M8.5 7.5 10 9M11 5l1.5 1.5" />
        </svg>
      </button>
      <button
        v-if="autoZoom !== undefined"
        class="zbtn"
        :class="{ on: autoZoom }"
        :aria-pressed="autoZoom"
        aria-label="Auto zoom"
        title="Auto zoom: zoom to whatever you select"
        @click="emit('update:autoZoom', !autoZoom)"
      >
        <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6.5" /><circle cx="10" cy="10" r="2" /></svg>
      </button>
      <button v-if="threeD" class="zbtn ztext" aria-label="3D view" title="Look at the house in 3D" @click="emit('threeD')">3D</button>
      <button
        class="zbtn"
        :class="{ on: viewOpen }"
        :aria-pressed="!!viewOpen"
        aria-label="What to show (V)"
        title="What to show (V)"
        @click="emit('view')"
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M1.5 10S4.5 4.5 10 4.5 18.5 10 18.5 10 15.5 15.5 10 15.5 1.5 10 1.5 10z" /><circle cx="10" cy="10" r="2.5" />
        </svg>
      </button>
    </div>
  </div>
</template>
