// What the header's one button is allowed to do, as assertions.
//
// The three rules worth pinning: a mode is only offered where the pane can
// actually show it, the cycle is a closed loop in a fixed direction, and a
// preference that cannot be drawn falls back without being rewritten -- which
// is what lets the asked-for view return by itself once the gateway answers.
//
// `text` was the third mode until card #841 took it out. The cases that named
// it are kept rather than deleted, rewritten to assert the mode is *gone*: a
// stored `text` is now an unreadable value, and an upgrade that used to land on
// it lands on the terminal. Those are the two ways a removed mode can come back
// to bite, and neither of them is visible from a screen.
import { describe, expect, test } from 'bun:test';

import {
  CHAT_VIEW_ENABLED,
  availablePaneViewModes,
  canCyclePaneViewModes,
  isPaneViewMode,
  nextPaneViewMode,
  resolvePaneViewMode,
  storedAgentDefaultView,
  type PaneViewMode,
} from '../pane-view-mode';

describe('what a pane can show', () => {
  test('a plain shell pane has only the terminal', () => {
    expect(availablePaneViewModes({ agent: false, parts: false })).toEqual(['terminal']);
  });

  test('a gateway that offers parts for a shell pane still offers no chat', () => {
    expect(availablePaneViewModes({ agent: false, parts: true })).toEqual(['terminal']);
  });

  test('an agent pane without a dictionary has only the terminal too', () => {
    expect(availablePaneViewModes({ agent: true, parts: false })).toEqual(['terminal']);
  });

  test('an agent pane the gateway can normalize gets both', () => {
    // The chat view is behind CHAT_VIEW_ENABLED (basics first); the pane still
    // *could* show it, which is what flipping the flag back restores.
    expect(availablePaneViewModes({ agent: true, parts: true })).toEqual(
      CHAT_VIEW_ENABLED ? ['chat', 'terminal'] : ['terminal']
    );
  });

  test('nothing offers the reflowed-text reading any more', () => {
    for (const capabilities of [
      { agent: false, parts: false },
      { agent: false, parts: true },
      { agent: true, parts: false },
      { agent: true, parts: true },
    ]) {
      expect(availablePaneViewModes(capabilities)).not.toContain('text' as PaneViewMode);
    }
  });

  test('one mode is nothing to cycle', () => {
    expect(canCyclePaneViewModes(['terminal'])).toBe(false);
    expect(canCyclePaneViewModes(['chat', 'terminal'])).toBe(true);
  });
});

describe('cycling', () => {
  const all: PaneViewMode[] = ['chat', 'terminal'];

  test('runs chat to terminal and wraps', () => {
    expect(nextPaneViewMode('chat', all)).toBe('terminal');
    expect(nextPaneViewMode('terminal', all)).toBe('chat');
  });

  test('a mode that has gone away restarts the cycle', () => {
    expect(nextPaneViewMode('chat', ['terminal'])).toBe('terminal');
  });
});

describe('resolving what to draw', () => {
  test('an available preference is drawn as asked', () => {
    expect(resolvePaneViewMode('chat', ['chat', 'terminal'])).toBe('chat');
  });

  test('chat on a pane with no dictionary falls back to the terminal', () => {
    expect(resolvePaneViewMode('chat', ['terminal'])).toBe('terminal');
  });

  test('the fallback never invents a mode the pane does not have', () => {
    expect(resolvePaneViewMode('chat', [])).toBe('terminal');
  });
});

describe('the reflowed-text reading is gone', () => {
  test('it is not a mode any more', () => {
    expect(isPaneViewMode('text')).toBe(false);
    expect(isPaneViewMode('terminal')).toBe(true);
    expect(isPaneViewMode('chat')).toBe(true);
  });

  test('a pane that remembers it is drawn as a terminal, not as nothing', () => {
    // The store is not type-checked at rest -- it survives a hot reload, and an
    // install that switched a pane to text before the upgrade still holds the
    // word. `resolvePaneViewMode` is what keeps that from drawing a blank pane.
    expect(resolvePaneViewMode('text' as PaneViewMode, ['terminal'])).toBe('terminal');
  });
});

describe('reading the setting an upgrade inherits', () => {
  test('a stored mode wins', () => {
    expect(storedAgentDefaultView({ agentDefaultView: 'chat' })).toBe('chat');
  });

  test('a stored value that is not a mode is ignored', () => {
    expect(storedAgentDefaultView({ agentDefaultView: 'structured' })).toBe(undefined);
  });

  test('a setting saved while text was a mode reads as nothing stored', () => {
    expect(storedAgentDefaultView({ agentDefaultView: 'text' })).toBe(undefined);
  });

  test('the old structured-view switch becomes chat', () => {
    expect(storedAgentDefaultView({ agentStructuredView: true })).toBe('chat');
  });

  test('the old terminal default is not kept, so chat is not hidden from upgrades', () => {
    expect(storedAgentDefaultView({ agentStructuredView: false })).toBe(undefined);
  });

  test('nothing stored is nothing to migrate', () => {
    expect(storedAgentDefaultView({})).toBe(undefined);
  });
});
