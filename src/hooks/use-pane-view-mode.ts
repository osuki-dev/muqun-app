import { useCallback, useMemo } from 'react';

import type { PaneChatDetail } from '@/lib/pane-chat';
import {
  availablePaneViewModes,
  canCyclePaneViewModes,
  nextPaneViewMode,
  resolvePaneViewMode,
  type PaneViewMode,
} from '@/lib/pane-view-mode';
import { useAppSettings } from '@/stores/app-settings';
import { paneViewKey, usePaneViewChoices } from '@/stores/pane-view-mode';

export interface PaneViewModeInput {
  serverId: string;
  paneId: string;
  /** An agent is attached to this pane. */
  agent: boolean;
  /** The gateway says it can normalize this pane into parts. */
  parts: boolean;
}

export interface PaneViewModeControls {
  /** What to draw. Never a mode this pane cannot show. */
  mode: PaneViewMode;
  /** What was asked for, which may be a mode the pane cannot show yet. */
  preferred: PaneViewMode;
  available: PaneViewMode[];
  canCycle: boolean;
  /** Whether the chat view folds tool steps away. */
  detail: PaneChatDetail;
  cycle: () => void;
  toggleDetail: () => void;
}

/**
 * The one place the three inputs to "which view is this pane in" meet: the
 * setting (what a pane opens in), the per-pane memory (what this pane was last
 * switched to), and the pane's own capabilities (what it can show at all).
 *
 * The preference is never rewritten to match what is drawable. A pane whose
 * gateway has not answered yet, or whose parts read failed, falls back for as
 * long as that lasts and returns to the asked-for view by itself.
 */
export function usePaneViewMode({
  serverId,
  paneId,
  agent,
  parts,
}: PaneViewModeInput): PaneViewModeControls {
  const defaultMode = useAppSettings((state) => state.agentDefaultView);
  const choices = usePaneViewChoices((state) => state.choices);
  const choose = usePaneViewChoices((state) => state.choose);

  const key = paneViewKey(serverId, paneId);
  const choice = choices[key];
  const available = useMemo(() => availablePaneViewModes({ agent, parts }), [agent, parts]);
  const preferred = choice?.mode ?? defaultMode;
  const mode = resolvePaneViewMode(preferred, available);
  const detail = choice?.detail ?? 'simplified';

  const cycle = useCallback(() => {
    // Cycling from what is on screen, not from what was asked for: pressing the
    // button has to move the view the user is looking at.
    choose(key, { mode: nextPaneViewMode(mode, available) });
  }, [available, choose, key, mode]);

  const toggleDetail = useCallback(() => {
    choose(key, { detail: detail === 'simplified' ? 'detailed' : 'simplified' });
  }, [choose, detail, key]);

  return {
    mode,
    preferred,
    available,
    canCycle: canCyclePaneViewModes(available),
    detail,
    cycle,
    toggleDetail,
  };
}
