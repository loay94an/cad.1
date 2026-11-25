<script setup lang="ts">
/** Areas, wall area for paint, skirting, doors and windows per room, with totals; saved as a spreadsheet (CSV). */
import { computed } from 'vue';
import type { Project } from '../model/schema';
import { STATUS_LABEL, type Totals, houseQuantities, quantitiesCsv } from '../model/quantities';
import { downloadBlob, safeName } from '../export/exporters';
import { formatLength } from '../units';

const props = defineProps<{ project: Project }>();
const emit = defineEmits<{ close: [] }>();

const q = computed(() => houseQuantities(props.project));
const unit = computed(() => props.project.settings.unit);
const len = (mm: number) => formatLength(mm, unit.value);
const m2 = (x: number) => x.toFixed(2);
const many = computed(() => q.value.floors.length > 1);

const columns: { key: keyof Totals | 'covering'; label: string; title?: string }[] = [
  { key: 'covering', label: 'Floor' },
  { key: 'floorArea_m2', label: 'Area m²' },
  { key: 'usableArea_m2', label: 'Usable m²', title: 'Floor with at least the usable headroom' },
  { key: 'perimeter_mm', label: 'Perimeter' },
  { key: 'skirting_mm', label: 'Skirting', title: 'Perimeter minus doors and openings to the floor' },
  { key: 'wallGross_m2', label: 'Walls m²', title: 'Wall area up to the ceiling, before doors and windows' },
  { key: 'wallNet_m2', label: 'Walls net m²', title: 'Wall area minus doors and windows: what you paint' },
  { key: 'ceiling_m2', label: 'Ceiling m²', title: 'Sloped ceilings counted at their real (tilted) size' },
  { key: 'doors', label: 'Doors' },
  { key: 'windows', label: 'Windows' },
];

function save() {
  const csv = quantitiesCsv(q.value, `${props.project.name} – quantities (${new Date().toLocaleDateString()})`);
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${safeName(props.project.name)}-quantities.csv`);
}
</script>

<template>
  <div class="sheet quantities-view">
    <header class="topbar">
      <button class="btn ghost" aria-label="Close" @click="emit('close')">‹</button>
      <h1 class="title-block">Quantities</h1>
      <button class="btn primary" title="CSV for Excel or LibreOffice" @click="save">Save spreadsheet</button>
    </header>
    <div class="quantities-body">
      <p class="hint">
        Lengths in {{ unit }}, areas in m². Wall areas are the inside faces up to the ceiling, following sloped
        ceilings. A door in a wall between two rooms counts for both rooms, and once in the totals.
      </p>

      <section v-for="f in q.floors" :key="f.floorId">
        <h2>{{ f.name }}</h2>
        <p v-if="!f.rooms.length" class="hint">No rooms.</p>
        <div v-else class="table-scroll">
          <table class="qty">
            <thead>
              <tr>
                <th>Room</th>
                <th v-for="c in columns" :key="c.key" :title="c.title">{{ c.label }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in f.rooms" :key="r.roomId" :class="{ dim: !r.closed }">
                <th>{{ r.name }}</th>
                <template v-if="r.closed">
                  <td class="text">{{ r.covering || '–' }}</td>
                  <td>{{ m2(r.floorArea_m2) }}</td>
                  <td>{{ m2(r.usableArea_m2) }}</td>
                  <td>{{ len(r.perimeter_mm) }}</td>
                  <td>{{ len(r.skirting_mm) }}</td>
                  <td>{{ m2(r.wallGross_m2) }}</td>
                  <td>{{ m2(r.wallNet_m2) }}</td>
                  <td>{{ m2(r.ceiling_m2) }}</td>
                  <td>{{ r.doors.count }}</td>
                  <td>{{ r.windows.count }}</td>
                </template>
                <td v-else :colspan="columns.length" class="text">not closed yet: no quantities</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <th>Total</th>
                <td></td>
                <td>{{ m2(f.total.floorArea_m2) }}</td>
                <td>{{ m2(f.total.usableArea_m2) }}</td>
                <td>{{ len(f.total.perimeter_mm) }}</td>
                <td>{{ len(f.total.skirting_mm) }}</td>
                <td>{{ m2(f.total.wallGross_m2) }}</td>
                <td>{{ m2(f.total.wallNet_m2) }}</td>
                <td>{{ m2(f.total.ceiling_m2) }}</td>
                <td>{{ f.total.doors.count }}</td>
                <td>{{ f.total.windows.count }}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section>
        <h2>{{ many ? 'Whole house' : 'Totals' }}</h2>
        <dl class="qty-totals">
          <div><dt>Floor area</dt><dd>{{ m2(q.total.floorArea_m2) }} m²</dd></div>
          <div><dt>Usable area</dt><dd>{{ m2(q.total.usableArea_m2) }} m²</dd></div>
          <div><dt>Wall area (net)</dt><dd>{{ m2(q.total.wallNet_m2) }} m²</dd></div>
          <div><dt>Ceiling area</dt><dd>{{ m2(q.total.ceiling_m2) }} m²</dd></div>
          <div><dt>Skirting</dt><dd>{{ len(q.total.skirting_mm) }} {{ unit }}</dd></div>
          <div><dt>Doors</dt><dd>{{ q.total.doors.count }} · {{ m2(q.total.doors.area_m2) }} m²</dd></div>
          <div><dt>Windows</dt><dd>{{ q.total.windows.count }} · {{ m2(q.total.windows.area_m2) }} m²</dd></div>
        </dl>

        <div class="qty-groups">
          <div v-if="q.grouped.coverings.length">
            <h3>Floor area by covering</h3>
            <table class="qty small">
              <tr v-for="c in q.grouped.coverings" :key="c.covering">
                <th>{{ c.covering || 'Not set' }}</th>
                <td>{{ m2(c.area_m2) }} m²</td>
              </tr>
            </table>
          </div>
          <div v-if="q.grouped.walls.length">
            <h3>Renovation</h3>
            <table class="qty small">
              <tr v-for="w in q.grouped.walls" :key="w.status">
                <th>{{ STATUS_LABEL[w.status] }}</th>
                <td>{{ len(w.length_mm) }} {{ unit }}</td>
                <td>{{ m2(w.area_m2) }} m²</td>
              </tr>
            </table>
            <p class="hint">Each wall once, measured on one face.</p>
          </div>
          <div v-if="q.grouped.pipes.length">
            <h3>Pipes</h3>
            <table class="qty small">
              <tr v-for="p in q.grouped.pipes" :key="p.utility + p.kind">
                <th>{{ p.utility }} · {{ p.kind }}</th>
                <td>{{ len(p.length_mm) }} {{ unit }}</td>
              </tr>
            </table>
          </div>
          <div v-if="q.grouped.electrical.length">
            <h3>Electrical points</h3>
            <table class="qty small">
              <tr v-for="e in q.grouped.electrical" :key="e.kind">
                <th>{{ e.kind }}</th>
                <td>{{ e.count }}</td>
              </tr>
            </table>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
