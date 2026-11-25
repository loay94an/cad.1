<script setup lang="ts">
/** The house in 3D: drag to turn, pinch or scroll to zoom. Loaded only when opened (three.js is large). */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Project } from '../model/schema';
import { hasSlope } from '../geometry/ceiling';
import { type House, type HouseOptions, buildHouse, floorBases } from '../three/house';
import { downloadBlob, safeName } from '../export/exporters';

const props = defineProps<{ project: Project; floorId: string }>();
const emit = defineEmits<{ close: [] }>();

const host = ref<HTMLDivElement>();
/** A floor id, or "all" for the whole house. */
const shown = ref(props.floorId);
const floors = computed(() => [...props.project.floors].sort((a, b) => a.level - b.level));
const visible = computed(() => (shown.value === 'all' ? floors.value : floors.value.filter((f) => f.id === shown.value)));
const anySlope = computed(() => visible.value.some((f) => f.rooms.some((r) => hasSlope(r.walls))));
/** Sloped ceilings are the point of an attic, so they start see-through; flat ones start hidden. */
const ceilings = ref<HouseOptions['ceilings']>(anySlope.value ? 'glass' : 'hidden');
const furniture = ref(true);
const stats = ref({ triangles: 0 });
const error = ref('');

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let controls: OrbitControls;
let house: House | null = null;
let observer: ResizeObserver | null = null;
let frame = 0;

function render() {
  frame = 0;
  if (!renderer) return;
  controls.update();
  renderer.render(scene, camera);
}
/** Draw only when something changed: no animation loop running in the background. */
const invalidate = () => {
  if (!frame) frame = requestAnimationFrame(render);
};

function rebuild(resetCamera: boolean) {
  if (!renderer) return;
  if (house) {
    scene.remove(house.group);
    house.dispose();
  }
  const defaultHeight = props.project.settings.defaultHeight_mm ?? 2600;
  house = buildHouse(visible.value, floorBases(props.project.floors, defaultHeight), {
    ceilings: ceilings.value,
    furniture: furniture.value,
    defaultHeight,
  });
  scene.add(house.group);
  stats.value = { triangles: house.triangles };
  if (resetCamera) {
    const d = house.size * 0.95;
    controls.target.copy(house.center);
    camera.position.set(house.center.x + d * 0.55, house.center.y + d * 0.85, house.center.z + d * 0.7);
    camera.near = Math.max(0.05, house.size / 200);
    camera.far = house.size * 20;
    camera.updateProjectionMatrix();
  }
  invalidate();
  // Also draw now: animation frames don't run while the window is hidden.
  render();
}

function resize() {
  const el = host.value;
  if (!el || !renderer) return;
  const w = el.clientWidth || 1;
  const h = el.clientHeight || 1;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  render();
}

onMounted(() => {
  const el = host.value!;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
  } catch (e) {
    error.value = `3D is not available in this browser (${e instanceof Error ? e.message : String(e)}).`;
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  el.appendChild(renderer.domElement);
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xeef1f4);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(4, 10, 6);
  scene.add(sun);
  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.maxPolarAngle = Math.PI * 0.95;
  controls.addEventListener('change', invalidate);
  observer = new ResizeObserver(resize);
  observer.observe(el);
  resize();
  rebuild(true);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  if (frame) cancelAnimationFrame(frame);
  house?.dispose();
  controls?.dispose();
  renderer?.dispose();
  renderer?.domElement.remove();
  renderer = null;
});

watch(shown, () => rebuild(true));
watch([ceilings, furniture], () => rebuild(false));

/** Saves what is on screen as a PNG. Drawn and read in one go, before the browser clears the picture. */
async function savePicture() {
  if (!renderer) return;
  render();
  const blob = await (await fetch(renderer.domElement.toDataURL('image/png'))).blob();
  downloadBlob(blob, `${safeName(props.project.name)}-3d.png`);
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close');
}
</script>

<template>
  <div class="sheet plan3d" tabindex="-1" @keydown="onKey">
    <header class="topbar">
      <button class="btn ghost" aria-label="Close" @click="emit('close')">‹</button>
      <h1 class="title-block">3D view</h1>
      <button class="btn" title="Save this view as a picture (PNG)" @click="savePicture">Save picture</button>
    </header>
    <div class="schema-tools">
      <select v-model="shown" class="mod-select" aria-label="What to show">
        <option v-for="f in floors" :key="f.id" :value="f.id">{{ f.name }}</option>
        <option v-if="floors.length > 1" value="all">Whole house</option>
      </select>
      <select v-model="ceilings" class="mod-select" aria-label="Ceilings">
        <option value="hidden">No ceilings</option>
        <option value="glass">See-through ceilings</option>
        <option value="solid">Solid ceilings</option>
      </select>
      <label class="check"><input v-model="furniture" type="checkbox" /><span>Furniture</span></label>
    </div>
    <p v-if="error" class="warn">{{ error }}</p>
    <div ref="host" class="plan3d-host" :data-triangles="stats.triangles"></div>
    <p class="canvas-hint plan3d-hint">Drag to turn · pinch or scroll to zoom · two fingers or right button to move</p>
  </div>
</template>
