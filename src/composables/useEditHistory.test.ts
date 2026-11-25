import { describe, expect, it } from 'vite-plus/test';
import { useEditHistory } from './useEditHistory';

function setup() {
  const state = { x: 0 };
  const h = useEditHistory(
    () => JSON.stringify(state),
    (s) => Object.assign(state, JSON.parse(s)),
  );
  const set = (x: number) => {
    state.x = x;
    h.snapshot();
  };
  return { state, h, set };
}

describe('undo and redo in the editor', () => {
  it('steps back and forward through the changes', () => {
    const { state, h, set } = setup();
    expect(h.canUndo.value).toBe(false);
    set(1);
    set(2);
    h.undo();
    expect(state.x).toBe(1);
    h.undo();
    expect(state.x).toBe(0);
    expect(h.canUndo.value).toBe(false);
    h.redo();
    h.redo();
    expect(state.x).toBe(2);
    expect(h.canRedo.value).toBe(false);
  });

  it('forgets the redo steps after a new change', () => {
    const { state, h, set } = setup();
    set(1);
    set(2);
    h.undo();
    set(5);
    expect(h.canRedo.value).toBe(false);
    h.undo();
    expect(state.x).toBe(1);
  });

  it('keeps a change not recorded yet, so undo goes back past it and redo brings it again', () => {
    const { state, h } = setup();
    state.x = 3;
    h.changed(); // still waiting to settle
    h.undo();
    expect(state.x).toBe(0);
    h.redo();
    expect(state.x).toBe(3);
    h.dispose();
  });

  it('makes a whole drag one step', () => {
    const { state, h } = setup();
    h.hold(true);
    for (const x of [1, 2, 3]) {
      state.x = x;
      h.snapshot(); // ignored while held
    }
    h.hold(false);
    h.snapshot();
    h.undo();
    expect(state.x).toBe(0);
  });
});
