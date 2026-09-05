// Per-pane view memory: that a choice sticks to the pane it was made on, that
// the two halves of a choice are independent, and that the map cannot grow for
// ever on a long-lived session.
import { beforeEach, describe, expect, test } from 'bun:test';

import { paneViewKey, usePaneViewChoices } from '../pane-view-mode';

const store = usePaneViewChoices;

beforeEach(() => {
  store.getState().forgetAll();
});

describe('remembering a pane', () => {
  test('a choice is scoped to one pane on one server', () => {
    const here = paneViewKey('srv-a', 'wM:p1');
    const there = paneViewKey('srv-b', 'wM:p1');
    store.getState().choose(here, { mode: 'terminal' });
    expect(store.getState().choices[here]?.mode).toBe('terminal');
    expect(there in store.getState().choices).toBe(false);
  });

  test('the fold and the mode are remembered independently', () => {
    const key = paneViewKey('srv-a', 'wM:p1');
    store.getState().choose(key, { detail: 'detailed' });
    store.getState().choose(key, { mode: 'chat' });
    expect(store.getState().choices[key]).toEqual({ mode: 'chat', detail: 'detailed' });
  });

  test('choosing what is already chosen leaves the store alone', () => {
    const key = paneViewKey('srv-a', 'wM:p1');
    store.getState().choose(key, { mode: 'chat' });
    const before = store.getState().choices;
    store.getState().choose(key, { mode: 'chat' });
    expect(store.getState().choices).toBe(before);
  });

  test('the map is bounded, and the least recently chosen pane is the one dropped', () => {
    for (let index = 0; index < 80; index += 1) {
      store.getState().choose(paneViewKey('srv', `p${index}`), { mode: 'terminal' });
    }
    const keys = Object.keys(store.getState().choices);
    expect(keys.length).toBeLessThanOrEqual(64);
    expect(paneViewKey('srv', 'p0') in store.getState().choices).toBe(false);
    expect(store.getState().choices[paneViewKey('srv', 'p79')]?.mode).toBe('terminal');
  });

  test('touching a pane again keeps it from being trimmed', () => {
    const first = paneViewKey('srv', 'p0');
    store.getState().choose(first, { mode: 'terminal' });
    for (let index = 1; index < 60; index += 1) {
      store.getState().choose(paneViewKey('srv', `p${index}`), { mode: 'terminal' });
    }
    store.getState().choose(first, { mode: 'chat' });
    for (let index = 60; index < 80; index += 1) {
      store.getState().choose(paneViewKey('srv', `p${index}`), { mode: 'terminal' });
    }
    expect(store.getState().choices[first]?.mode).toBe('chat');
  });
});
