/**
 * The result of checking an explicit Home destination against one successful
 * workspace snapshot.
 *
 * `pending` means the requested session is known to exist, but this snapshot
 * is still for the previous session. A failed refresh never reaches this
 * classifier, so it cannot turn a temporary transport problem into a missing
 * terminal.
 */
export type HomeTargetAvailability =
  | { kind: 'unscoped' }
  | { kind: 'pending'; sessionId: string }
  | { kind: 'available' }
  | { kind: 'missing-session'; sessionId: string }
  | { kind: 'missing-pane'; paneId: string; sessionId?: string };

export type HomeTargetAvailabilityInput = {
  explicit: boolean;
  snapshot: 'confirmed' | 'unavailable';
  targetSessionId?: string;
  targetPaneId?: string;
  currentSessionId: string;
  availableSessionIds: readonly string[];
  availablePaneIds: readonly string[];
};

export type HomeTargetReadyInput = {
  explicit: boolean;
  availability: HomeTargetAvailability;
  targetSessionId?: string;
  targetPaneId?: string;
  currentSessionId: string;
  selectedPaneId?: string;
};

/**
 * Classifies an explicit Home target without choosing a fallback pane.
 * Remembered backend selection passes `explicit: false` and keeps its legacy
 * reconcile-to-a-usable-pane behaviour in the workspace.
 */
export function classifyHomeTargetAvailability(
  input: HomeTargetAvailabilityInput
): HomeTargetAvailability {
  if (!input.explicit) return { kind: 'unscoped' };
  if (input.snapshot === 'unavailable') {
    return { kind: 'pending', sessionId: input.targetSessionId ?? input.currentSessionId };
  }

  const { targetSessionId, targetPaneId } = input;
  if (targetSessionId && targetSessionId !== input.currentSessionId) {
    if (input.availableSessionIds.includes(targetSessionId)) {
      return { kind: 'pending', sessionId: targetSessionId };
    }
    return { kind: 'missing-session', sessionId: targetSessionId };
  }

  if (targetPaneId && !input.availablePaneIds.includes(targetPaneId)) {
    return { kind: 'missing-pane', paneId: targetPaneId, sessionId: targetSessionId };
  }

  return { kind: 'available' };
}

/**
 * Presentation and delivery may use an explicit target only after the
 * authoritative snapshot contains it and selection has caught up with it.
 * Transport readiness remains independent so a pending target can recover.
 */
export function isHomeTargetReady(input: HomeTargetReadyInput): boolean {
  if (!input.explicit || input.availability.kind === 'unscoped') return true;
  if (input.availability.kind !== 'available') return false;
  if (input.targetSessionId && input.currentSessionId !== input.targetSessionId) return false;
  if (input.targetPaneId && input.selectedPaneId !== input.targetPaneId) return false;
  return true;
}
