import { useSyncExternalStore } from 'react';
import type { PaneReadWindow } from '@/terminal/history';

/**
 * The window of pane output on screen, and the revision it was read at.
 *
 * Both change on every frame a streaming pane sends -- several times a second
 * -- and as React state of the terminal screen they re-rendered the whole of
 * it each time: key row, drawer chrome, chips. Held here instead, they reach
 * only the readers that subscribe: the canvas, and the few answers the screen
 * derives from them, each of which re-renders only when its own answer moves.
 *
 * One slot per screen, not one per pane: the slot is "the window on screen",
 * whose owner the screen already tracks, and the windows of panes left behind
 * live in the screen's pane cache.
 */
export interface PaneOutput {
  window: PaneReadWindow;
  revision: number;
}

export interface PaneOutputStore {
  get(): PaneOutput;
  /**
   * Fold a new window in. A window with the same text and depth keeps the held
   * object and announces nothing, so a read restating the screen is free.
   */
  setWindow(next: PaneReadWindow | ((current: PaneReadWindow) => PaneReadWindow)): void;
  setRevision(revision: number): void;
  /**
   * A write made while the screen renders (the pane-switch handoff), whose own
   * children read it in the same pass. Stored without telling anyone, because
   * telling would update other components mid-render; {@link flush} announces
   * it once the commit is in.
   */
  setDuringRender(next: PaneOutput): void;
  flush(): void;
  subscribe(listener: () => void): () => void;
}

export function createPaneOutputStore(initial: PaneOutput): PaneOutputStore {
  let state = initial;
  let unannounced = false;
  const listeners = new Set<() => void>();
  const announce = () => {
    unannounced = false;
    for (const listener of listeners) listener();
  };
  const replace = (next: PaneOutput): boolean => {
    const window = sameWindow(next.window, state.window) ? state.window : next.window;
    if (window === state.window && next.revision === state.revision) return false;
    state = { window, revision: next.revision };
    return true;
  };
  return {
    get: () => state,
    setWindow(next) {
      const window = typeof next === 'function' ? next(state.window) : next;
      if (replace({ window, revision: state.revision })) announce();
    },
    setRevision(revision) {
      if (replace({ window: state.window, revision })) announce();
    },
    setDuringRender(next) {
      if (replace(next)) unannounced = true;
    },
    flush() {
      if (unannounced) announce();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function sameWindow(a: PaneReadWindow, b: PaneReadWindow): boolean {
  return a === b || (a.output === b.output && a.capturedRows === b.capturedRows);
}

/**
 * One answer read from the store, re-rendering the caller only when that
 * answer changes. `select` must return a primitive or a value the store
 * already holds, so an unchanged answer compares equal.
 */
export function usePaneOutput<T>(store: PaneOutputStore, select: (output: PaneOutput) => T): T {
  const read = () => select(store.get());
  return useSyncExternalStore(store.subscribe, read, read);
}
