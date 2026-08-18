import { useLingui } from '@lingui/react/macro';
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';

import { useLatestRef } from '@/hooks/use-render-refs';
import {
  answerPaneApproval,
  ApprovalConflictError,
  readPaneApproval,
} from '@/lib/gateway-client';
import {
  approvalBannerReducer,
  IDLE_APPROVAL_BANNER,
  paneApprovalFromResponse,
  type ApprovalBannerState,
  type ApprovalOption,
} from '@/lib/pane-approval';

export interface PaneApprovalController {
  state: ApprovalBannerState;
  /** Answer the menu on screen. Never re-sends a rejected answer. */
  answer: (option: ApprovalOption) => void;
  /** Re-read the pane. Called on every (re)connect, since events have no replay. */
  refresh: () => void;
  /** Feed one `approval.pending` / `approval.resolved` payload in. */
  handleEvent: (event: string, payload: unknown) => void;
  dismissError: () => void;
}

export interface PaneApprovalOptions {
  sessionId: string;
  paneId: string;
  /** The gateway declared `pane_approvals`. False means this does nothing at all. */
  supported: boolean;
  /** The screen is on and connected. */
  enabled: boolean;
}

/**
 * Owns the terminal screen's approval banner: what it shows, what a tap sends,
 * and what a rejected answer does next.
 *
 * The state machine lives in `pane-approval.ts` so it can be tested without a
 * gateway; everything here is the I/O around it. Reads are guarded by a request
 * id because a pane switch mid-flight would otherwise paint the old pane's
 * question over the new pane.
 */
export function usePaneApproval({
  sessionId,
  paneId,
  supported,
  enabled,
}: PaneApprovalOptions): PaneApprovalController {
  const { t } = useLingui();
  const [state, dispatch] = useReducer(approvalBannerReducer, IDLE_APPROVAL_BANNER);
  const target = useMemo(
    () => (supported && enabled && paneId ? { sessionId, paneId } : null),
    [enabled, paneId, sessionId, supported]
  );
  const targetRef = useLatestRef(target);
  // `answer` reads the live banner state without being rebuilt on every change
  // of it, which would hand the buttons a new callback on each render.
  const stateRef = useLatestRef(state);
  const readRequestIdRef = useRef(0);

  useEffect(() => {
    dispatch({ type: 'pane-selected', target });
  }, [target]);

  const refresh = useCallback(() => {
    const current = targetRef.current;
    if (!current) return;
    const requestId = ++readRequestIdRef.current;
    void readPaneApproval(current.sessionId, current.paneId)
      .then((next) => {
        // A read that lost the race to a pane switch, or to a newer read of the
        // same pane, is discarded rather than painted.
        if (requestId !== readRequestIdRef.current || !next) return;
        dispatch({ type: 'observed', state: next });
      })
      .catch(() => {
        // A failed read is not worth a banner of its own: the pane is either
        // unreachable, in which case the screen already says so, or the gateway
        // is older than it claimed, in which case there is nothing to show.
      });
  }, [targetRef]);

  // First read for a pane. Events carry every transition after this one, so
  // there is no poll: the gateway watches the pane and publishes.
  useEffect(() => {
    if (!target) return;
    refresh();
  }, [refresh, target]);

  useEffect(() => {
    if (!state.needsRefresh) return;
    dispatch({ type: 'refresh-handled' });
    refresh();
  }, [refresh, state.needsRefresh]);

  const handleEvent = useCallback((_event: string, payload: unknown) => {
    if (!targetRef.current) return;
    const next = paneApprovalFromResponse(payload);
    // Both events carry the same envelope: `pending` names the new menu,
    // `resolved` reports the pane as idle. The reducer only needs the state,
    // and drops anything about a pane the screen is not showing.
    if (next) dispatch({ type: 'observed', state: next });
  }, [targetRef]);

  const answer = useCallback((option: ApprovalOption) => {
    const current = targetRef.current;
    const fingerprint = stateRef.current.approval?.fingerprint;
    if (!current || !fingerprint || stateRef.current.answeringIndex !== null) return;

    dispatch({ type: 'answer-started', fingerprint, optionIndex: option.index });
    void answerPaneApproval(current.sessionId, current.paneId, {
      option: option.index,
      fingerprint,
    })
      .then((result) => {
        dispatch({ type: 'answer-succeeded', answer: result });
      })
      .catch((error: unknown) => {
        if (error instanceof ApprovalConflictError) {
          dispatch({ type: 'answer-conflicted', code: error.code });
          return;
        }
        dispatch({ type: 'answer-failed', message: t`That answer did not reach the agent.` });
      });
  }, [stateRef, t, targetRef]);

  const dismissError = useCallback(() => {
    dispatch({ type: 'error-dismissed' });
  }, []);

  return useMemo(
    () => ({ state, answer, refresh, handleEvent, dismissError }),
    [answer, dismissError, handleEvent, refresh, state]
  );
}
