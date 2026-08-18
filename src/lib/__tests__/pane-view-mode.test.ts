// What the header's one button is allowed to do, as assertions.
//
// The three rules worth pinning: a mode is only offered where the pane can
// actually show it, the cycle is a closed loop in a fixed direction, and a
// preference that cannot be drawn falls back without being rewritten -- which
// is what lets the asked-for view return by itself once the gateway answers.
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

  test('an agent pane without a dictionary gets text and terminal', () => {
    expect(availablePaneViewModes({ agent: true, parts: false })).toEqual(['text', 'terminal']);
  });

  test('an agent pane the gateway can normalize gets all three', () => {
    // The chat view is behind CHAT_VIEW_ENABLED (basics first); the pane still
    // *could* show it, which is what flipping the flag back restores.
    expect(availablePaneViewModes({ agent: true, parts: true })).toEqual(
      CHAT_VIEW_ENABLED ? ['chat', 'text', 'terminal'] : ['text', 'terminal']
    );
  });

  test('one mode is nothing to cycle', () => {
    expect(canCyclePaneViewModes(['terminal'])).toBe(false);
    expect(canCyclePaneViewModes(['text', 'terminal'])).toBe(true);
  });
});

describe('cycling', () => {
  const all: PaneViewMode[] = ['chat', 'text', 'terminal'];

  test('runs chat to text to terminal and wraps', () => {
    expect(nextPaneViewMode('chat', all)).toBe('text');
    expect(nextPaneViewMode('text', all)).toBe('terminal');
    expect(nextPaneViewMode('terminal', all)).toBe('chat');
  });

  test('skips a mode the pane cannot show', () => {
    const pair: PaneViewMode[] = ['text', 'terminal'];
    expect(nextPaneViewMode('text', pair)).toBe('terminal');
    expect(nextPaneViewMode('terminal', pair)).toBe('text');
  });

  test('a mode that has gone away restarts the cycle', () => {
    expect(nextPaneViewMode('chat', ['text', 'terminal'])).toBe('text');
  });
});

describe('resolving what to draw', () => {
  test('an available preference is drawn as asked', () => {
    expect(resolvePaneViewMode('chat', ['chat', 'text', 'terminal'])).toBe('chat');
  });

  test('chat on a pane with no dictionary falls back to the terminal, not to text', () => {
    expect(resolvePaneViewMode('chat', ['text', 'terminal'])).toBe('terminal');
  });

  test('text on a plain shell pane falls back to the terminal', () => {
    expect(resolvePaneViewMode('text', ['terminal'])).toBe('terminal');
  });

  test('the fallback never invents a mode the pane does not have', () => {
    expect(resolvePaneViewMode('chat', [])).toBe('terminal');
  });
});

describe('reading the setting an upgrade inherits', () => {
  test('a stored mode wins', () => {
    expect(storedAgentDefaultView({ agentDefaultView: 'text' })).toBe('text');
  });

  test('a stored value that is not a mode is ignored', () => {
    expect(storedAgentDefaultView({ agentDefaultView: 'structured' })).toBe(undefined);
  });

  test('the old structured-view switch becomes chat', () => {
    expect(storedAgentDefaultView({ agentStructuredView: true, agentTerminalMode: true })).toBe(
      'chat'
    );
  });

  test('the old reflowed-text choice is kept', () => {
    expect(storedAgentDefaultView({ agentStructuredView: false, agentTerminalMode: false })).toBe(
      'text'
    );
  });

  test('the old terminal default is not kept, so chat is not hidden from upgrades', () => {
    expect(
      storedAgentDefaultView({ agentStructuredView: false, agentTerminalMode: true })
    ).toBe(undefined);
  });

  test('nothing stored is nothing to migrate', () => {
    expect(storedAgentDefaultView({})).toBe(undefined);
  });
});

describe('the type guard', () => {
  test('accepts the three modes and nothing else', () => {
    expect(isPaneViewMode('chat')).toBe(true);
    expect(isPaneViewMode('text')).toBe(true);
    expect(isPaneViewMode('terminal')).toBe(true);
    expect(isPaneViewMode('parts')).toBe(false);
    expect(isPaneViewMode(undefined)).toBe(false);
  });
});
