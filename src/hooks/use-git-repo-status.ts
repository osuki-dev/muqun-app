import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { gatewaySupportsGitDiff } from '@/lib/git-diff';
import { loadPaneContext } from '@/lib/gateway-client';
import {
  readGitRepo,
  recordGitRepo,
  repoEntryFromContext,
  type GitRepoEntry,
} from '@/lib/git-repo-cache';

/** What the toolbar entry needs to know, and nothing else. */
export interface GitRepoStatus {
  /** Draw the control at all. False means draw nothing, not draw it disabled. */
  available: boolean;
  /** The badge. */
  changedFiles: number;
  /** The branch, carried into the sheet's subtitle so it opens already named. */
  branch: string | null;
  /** A request is in flight. The toolbar ignores this; there is no spinner. */
  loading: boolean;
}

const HIDDEN: GitRepoStatus = {
  available: false,
  changedFiles: 0,
  branch: null,
  loading: false,
};

function statusOf(entry: GitRepoEntry | undefined, loading: boolean): GitRepoStatus {
  if (!entry) return { ...HIDDEN, loading };
  return {
    available: entry.available,
    changedFiles: entry.changedFiles,
    branch: entry.branch,
    loading,
  };
}

/**
 * Whether this pane is in a checkout, and how much has changed in it.
 *
 * Two gates, in this order, and neither alone is enough:
 *
 * 1. **The capability.** A gateway that never declared `git_diff` is never
 *    asked -- not asked and told no, not asked at all. The routes would answer
 *    404 anyway, but the point of reading the capability is that the feature
 *    stays *invisible* on an older server rather than merely silent, which is
 *    the same argument `gatewaySupportsAgentEvents` makes at `away-digest.ts`.
 * 2. **The fact.** A capability is a promise about the API; whether *this* pane
 *    is in a repository is an observation about one pane, and it comes from the
 *    context route. `git: null` is the ordinary answer for a pane in a home
 *    directory, and it is not an error.
 *
 * **Nothing polls.** The answer is refreshed when the workspace screen regains
 * focus and when the caller explicitly asks, and that is all. A per-pane git
 * probe on a timer would run `git status` on the user's machine forever, in a
 * directory an agent is actively writing to, to keep a number on a 40pt button
 * up to date.
 *
 * The answer survives in a module-level cache keyed by the cwd, so coming back
 * to a pane is instant and the control does not blink in. See
 * `src/lib/git-repo-cache.ts` for the rule that keeps it from blinking *out*.
 */
export function useGitRepoStatus({
  sessionId,
  paneId,
  cwd,
  capabilities,
  enabled = true,
}: {
  sessionId: string;
  paneId: string;
  /** The pane's working directory. Empty or absent means there is nothing to ask. */
  cwd: string | null | undefined;
  /** `health.capabilities`, as the workspace already holds it. */
  capabilities: readonly string[] | undefined | null;
  /** The screen is connected and worth spending a request on. */
  enabled?: boolean;
}): GitRepoStatus & { refresh: () => void } {
  const supported = gatewaySupportsGitDiff(capabilities);
  const active = Boolean(supported && enabled && cwd && paneId);

  const [status, setStatus] = useState<GitRepoStatus>(() =>
    statusOf(active ? readGitRepo(cwd) : undefined, false)
  );

  /**
   * The request in flight, and the only one whose answer is wanted. A pane
   * change makes the previous question worthless, and an answer that is
   * worthless must not be allowed to land -- the `session-artifacts` rule, for
   * the same reason: nothing about a request guarantees the order its answer
   * arrives in.
   */
  const inFlightRef = useRef<AbortController | null>(null);
  useEffect(() => () => inFlightRef.current?.abort(), []);

  const load = useCallback(() => {
    if (!active || !cwd) {
      setStatus(HIDDEN);
      return;
    }
    // Whatever is already known is shown immediately; the request only ever
    // improves it. This is what makes switching panes inside one repository
    // free of a flicker.
    setStatus(statusOf(readGitRepo(cwd), true));

    inFlightRef.current?.abort();
    const controller = new AbortController();
    inFlightRef.current = controller;
    void loadPaneContext(sessionId, paneId, controller.signal)
      .then((context) => {
        if (controller.signal.aborted) return;
        setStatus(statusOf(recordGitRepo(cwd, repoEntryFromContext(context, Date.now())), false));
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        // A failure is not an answer. Whatever the cache holds stands, which
        // for an unknown directory is "draw nothing" and for a known repository
        // is the control the reader already had.
        setStatus(statusOf(readGitRepo(cwd), false));
      });
  }, [active, cwd, paneId, sessionId]);

  /**
   * The only thing that triggers a request.
   *
   * `useFocusEffect` runs its effect on mount when the screen is focused *and*
   * again whenever the callback's identity changes while focused -- which is
   * exactly "the pane, its directory or the gateway's capabilities changed".
   * So this covers both cases, and a plain `useEffect` beside it would only
   * mean every pane change costs two identical requests instead of one.
   *
   * It also, deliberately, runs when the workspace comes back into view: an
   * agent has very likely been writing in that directory while the reader was
   * somewhere else, and coming back is the moment the badge is looked at.
   */
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  return { ...status, refresh: load };
}
