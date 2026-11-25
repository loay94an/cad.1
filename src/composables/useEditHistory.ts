import { ref } from 'vue';

/**
 * Undo and redo for one editing session: snapshots of the state (as JSON),
 * taken shortly after each change. While `hold` is on (a finger or the mouse is
 * down, e.g. during a drag) no snapshot is taken, so a whole drag is one step.
 */
export function useEditHistory(read: () => string, apply: (state: string) => void, { delay = 350, limit = 200 } = {}) {
  const stack: string[] = [read()];
  let at = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let held = false;
  const canUndo = ref(false);
  const canRedo = ref(false);

  function update() {
    canUndo.value = at > 0;
    canRedo.value = at < stack.length - 1;
  }

  /** Records the current state as a step, if it changed. */
  function snapshot() {
    clearTimeout(timer);
    if (held) return;
    const s = read();
    if (stack[at] === s) return;
    stack.splice(at + 1);
    stack.push(s);
    if (stack.length > limit) stack.shift();
    at = stack.length - 1;
    update();
  }

  /** Call on every change; the step is recorded once things settle. */
  function changed() {
    clearTimeout(timer);
    timer = setTimeout(snapshot, delay);
  }

  function hold(on: boolean) {
    held = on;
    if (!on) changed();
  }

  function go(i: number) {
    at = i;
    apply(stack[i]);
    update();
  }

  function undo() {
    held = false;
    snapshot();
    if (at > 0) go(at - 1);
  }

  function redo() {
    held = false;
    snapshot();
    if (at < stack.length - 1) go(at + 1);
  }

  return { changed, hold, snapshot, undo, redo, canUndo, canRedo, dispose: () => clearTimeout(timer) };
}
