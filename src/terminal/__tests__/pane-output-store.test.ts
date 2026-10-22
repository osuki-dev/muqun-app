import { describe, expect, test } from 'bun:test';

import { createPaneOutputStore } from '../pane-output-store';

describe('pane output store', () => {
  const seeded = () => {
    const store = createPaneOutputStore({
      window: { output: 'a', capturedRows: 0 },
      revision: 1,
    });
    let heard = 0;
    store.subscribe(() => {
      heard += 1;
    });
    return { store, heard: () => heard };
  };

  test('a read restating the window keeps the held object and tells nobody', () => {
    const { store, heard } = seeded();
    const held = store.get();
    store.setWindow({ output: 'a', capturedRows: 0 });
    store.setWindow((current) => ({ ...current }));
    store.setRevision(1);
    expect(store.get()).toBe(held);
    expect(heard()).toBe(0);
  });

  test('new output or a new revision is announced once, keeping what did not change', () => {
    const { store, heard } = seeded();
    const window = store.get().window;
    store.setRevision(2);
    expect(store.get().window).toBe(window);
    store.setWindow((current) => ({ ...current, output: 'ab' }));
    expect(store.get()).toEqual({ window: { output: 'ab', capturedRows: 0 }, revision: 2 });
    expect(heard()).toBe(2);
  });

  test('a write made during render is held back until the flush, and flushed once', () => {
    const { store, heard } = seeded();
    store.setDuringRender({ window: { output: 'b', capturedRows: 3 }, revision: -1 });
    expect(store.get().window.output).toBe('b');
    expect(heard()).toBe(0);
    store.flush();
    store.flush();
    expect(heard()).toBe(1);
  });
});
