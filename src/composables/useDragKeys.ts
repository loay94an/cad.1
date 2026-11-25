import { onBeforeUnmount, onMounted, ref } from 'vue';

/**
 * Keys while placing things by dragging: Alt held shows distances (true while
 * held), and Escape during a drag calls `cancelDrag` (which puts it back) and
 * stops anything else from also reacting to that Escape.
 */
export function useDragKeys(cancelDrag: () => boolean, altInUse: () => boolean) {
  const altHeld = ref(false);

  function onAlt(e: KeyboardEvent) {
    if (e.key !== 'Alt') return;
    altHeld.value = e.type === 'keydown';
    // Alt on its own would move the focus to the browser's menu.
    if (altInUse()) e.preventDefault();
  }
  const onBlur = () => (altHeld.value = false);
  function onEscape(e: KeyboardEvent) {
    if (e.key !== 'Escape' || !cancelDrag()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  onMounted(() => {
    addEventListener('keydown', onEscape, { capture: true });
    addEventListener('keydown', onAlt);
    addEventListener('keyup', onAlt);
    addEventListener('blur', onBlur);
  });
  onBeforeUnmount(() => {
    removeEventListener('keydown', onEscape, { capture: true });
    removeEventListener('keydown', onAlt);
    removeEventListener('keyup', onAlt);
    removeEventListener('blur', onBlur);
  });
  return altHeld;
}
