import { useEffect, useState } from 'react';

import { loadPaneShortcuts, samePaneShortcuts, type PaneShortcuts } from '@/lib/gateway-client';

/**
 * Which keys and slash commands a pane responds to is the gateway's answer,
 * so a newly supported agent needs a gateway update rather than an app
 * release. A failure is not surfaced: the local tables cover the pane until
 * the next attempt.
 *
 * Asked again whenever `refreshKey` changes -- the terminal screen passes the
 * pane's title and how many times the on-screen keyboard has opened, so a
 * shell that has just started an agent gets its chords back without a pane
 * switch. An unchanged answer keeps the same object, so a row ordered by
 * usage does not reshuffle under a thumb. Null until the first answer, and
 * again whenever the pane is not being asked about.
 */
export function usePaneShortcuts({
  sessionId,
  paneId,
  enabled,
  refreshKey = '',
}: {
  sessionId: string;
  paneId: string;
  enabled: boolean;
  refreshKey?: string;
}): PaneShortcuts | null {
  // Held with the pane it answers for: another pane's keys, commands and
  // skills are never returned for this one, not even until this one answers.
  const [answer, setAnswer] = useState<{ key: string; shortcuts: PaneShortcuts } | null>(null);
  const key = `${sessionId}\u0000${paneId}`;
  useEffect(() => {
    if (!enabled || !paneId || !sessionId) {
      setAnswer(null);
      return;
    }
    let cancelled = false;
    void loadPaneShortcuts(sessionId, paneId)
      .then((value) => {
        if (cancelled) return;
        setAnswer((previous) =>
          previous && previous.key === key && samePaneShortcuts(previous.shortcuts, value)
            ? previous
            : { key, shortcuts: value }
        );
      })
      .catch(() => {
        if (!cancelled) setAnswer(null);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, key, paneId, refreshKey, sessionId]);
  return enabled && answer?.key === key ? answer.shortcuts : null;
}
