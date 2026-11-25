import { onBeforeUnmount, onMounted } from 'vue';

/** True while the user is typing in a field, where plain keys must stay plain. */
export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
}

export const ctrlOrCmd = (e: KeyboardEvent) => e.ctrlKey || e.metaKey;

/** Listens for keys on the whole window while the component is mounted. */
export function useKeydown(handler: (e: KeyboardEvent) => void) {
  onMounted(() => addEventListener('keydown', handler));
  onBeforeUnmount(() => removeEventListener('keydown', handler));
}

/** A mouse/trackpad is the main pointer (a PC rather than a phone). */
export const hasFinePointer = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: fine)').matches;
