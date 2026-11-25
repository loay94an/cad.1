<script setup lang="ts">
defineProps<{ context: 'floor' | 'room' }>();
const emit = defineEmits<{ close: [] }>();

const floor: [string, string][] = [
  ['1 / 2 / 3', 'View & notes / Layout (arrange rooms) / Furniture'],
  ['Space', 'Show or hide the actions button'],
  ['N', 'New room'],
  ['Enter or E', 'Edit the selected room'],
  ['Double-click', 'Edit a room'],
  ['Delete', 'Delete the selected room'],
  ['Arrows', 'Layout: move the selected room 1 cm (Shift: 10 cm)'],
  ['R / Shift+R', 'Turn 90° right / left'],
  [', and .', 'Turn 1° left / right (Shift: 15°)'],
  ['A', 'Line up with a wall of another room (then click the wall)'],
  ['T', 'Type an exact angle'],
  ['L', 'Lock / unlock the selected room'],
  ['Tab', 'Select the next room'],
  ['Page Up / Down', 'Previous / next floor'],
  ['+ / − / F', 'Zoom in / out / show everything'],
  ['V', 'What to show'],
  ['M', 'Measure a distance or an area'],
  ['Ctrl+Z / Ctrl+Y', 'Undo / redo'],
  ['Ctrl+E', 'Export'],
  ['4 / 5', 'Electrical / Utilities (water, heating, …)'],
  ['Ctrl+C / Ctrl+V / Ctrl+D', 'Electrical: copy / paste / duplicate the selected point'],
  ['Drag a point', 'Electrical and utilities: snaps onto walls and lines up · Ctrl: free · Shift: straight · Alt: distances'],
  ['Esc while dragging', 'Put it back where it was'],
  ['Esc', 'Deselect, cancel'],
];

const room: [string, string][] = [
  ['Ctrl+S or Ctrl+Enter', 'Save the room'],
  ['Ctrl+Z / Ctrl+Y', 'Undo / redo, back to when you opened the room'],
  ['Esc', 'Leave a field; again: cancel'],
  ['P', 'Hide the plan / small / large'],
  ['Enter in a length', 'Next wall (adds one after the last)'],
  ['N', 'Notes: place a new note · Furniture: add the chosen item'],
  ['Arrows', 'Move the selected furniture (with its group) or note 1 cm (Shift: 10 cm)'],
  ['R', 'Turn the selected furniture 90°'],
  ['Ctrl+C / Ctrl+V', 'Copy / paste the selected furniture, door or window (also into another room)'],
  ['Ctrl+D', 'Duplicate the selected furniture, door or window'],
  ['Drag furniture', 'Lines up with walls and other pieces · Ctrl: free · Shift: only straight across or up and down'],
  ['Esc while dragging', 'Put it back where it was'],
  ['Alt', 'Furniture: distances from the selected piece to the walls and other pieces'],
  ['Delete', 'Remove the selected item'],
  ['+ / − / F', 'Zoom in / out / show the whole room'],
  ['V', 'What to show'],
];
</script>

<template>
  <div class="backdrop" @click.self="emit('close')">
    <div class="dialog shortcuts">
      <h2>Keyboard shortcuts</h2>
      <p class="hint">Single keys work when you're not typing in a field. Press ? to open this again.</p>
      <table>
        <tbody>
          <tr v-for="[k, what] in context === 'floor' ? floor : room" :key="k">
            <td><kbd>{{ k }}</kbd></td>
            <td>{{ what }}</td>
          </tr>
        </tbody>
      </table>
      <div class="row-actions end">
        <button class="btn" @click="emit('close')">Close</button>
      </div>
    </div>
  </div>
</template>
