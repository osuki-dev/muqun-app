import { describe, expect, test } from 'bun:test';

import { classifyHomeTargetAvailability, isHomeTargetReady } from '@/lib/home-target-availability';

const base = {
  explicit: true,
  snapshot: 'confirmed' as const,
  currentSessionId: 'session-a',
  availableSessionIds: ['session-a', 'session-b'],
  availablePaneIds: ['pane-a'],
};

describe('Home target availability', () => {
  test('reports an authoritative missing pane without selecting a fallback', () => {
    expect(
      classifyHomeTargetAvailability({
        ...base,
        targetSessionId: 'session-a',
        targetPaneId: 'gone',
      })
    ).toEqual({
      kind: 'missing-pane',
      paneId: 'gone',
      sessionId: 'session-a',
    });
  });

  test('keeps an explicit target pending during a temporary snapshot failure', () => {
    expect(
      classifyHomeTargetAvailability({
        ...base,
        snapshot: 'unavailable',
        targetSessionId: 'session-a',
        targetPaneId: 'gone',
        availablePaneIds: [],
      })
    ).toEqual({ kind: 'pending', sessionId: 'session-a' });
  });

  test('waits while a known target session has not become current', () => {
    expect(
      classifyHomeTargetAvailability({
        ...base,
        currentSessionId: 'session-a',
        targetSessionId: 'session-b',
        targetPaneId: 'pane-b',
        availablePaneIds: ['pane-a'],
      })
    ).toEqual({ kind: 'pending', sessionId: 'session-b' });
  });

  test('reports a session missing from the authoritative choices', () => {
    expect(
      classifyHomeTargetAvailability({
        ...base,
        targetSessionId: 'deleted-session',
        targetPaneId: 'pane-a',
        availableSessionIds: ['session-a'],
      })
    ).toEqual({ kind: 'missing-session', sessionId: 'deleted-session' });
  });

  test('keeps remembered backend selection unscoped', () => {
    expect(
      classifyHomeTargetAvailability({
        ...base,
        explicit: false,
        targetPaneId: 'deleted-pane',
        availablePaneIds: [],
      })
    ).toEqual({ kind: 'unscoped' });
  });

  test('accepts the exact pane when the authoritative snapshot contains it', () => {
    expect(
      classifyHomeTargetAvailability({
        ...base,
        targetSessionId: 'session-a',
        targetPaneId: 'pane-a',
      })
    ).toEqual({ kind: 'available' });
  });

  test('keeps display and delivery gated until pending target selection catches up', () => {
    expect(
      isHomeTargetReady({
        explicit: true,
        availability: { kind: 'pending', sessionId: 'session-b' },
        targetSessionId: 'session-b',
        targetPaneId: 'pane-b',
        currentSessionId: 'session-a',
        selectedPaneId: 'pane-a',
      })
    ).toBe(false);
  });

  test('does not open delivery on a fallback pane after an exact target appears', () => {
    expect(
      isHomeTargetReady({
        explicit: true,
        availability: { kind: 'available' },
        targetSessionId: 'session-a',
        targetPaneId: 'pane-b',
        currentSessionId: 'session-a',
        selectedPaneId: 'pane-a',
      })
    ).toBe(false);
  });

  test('opens delivery only for the exact confirmed selection', () => {
    expect(
      isHomeTargetReady({
        explicit: true,
        availability: { kind: 'available' },
        targetSessionId: 'session-a',
        targetPaneId: 'pane-a',
        currentSessionId: 'session-a',
        selectedPaneId: 'pane-a',
      })
    ).toBe(true);
  });
});
