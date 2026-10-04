import { useLocalSearchParams } from 'expo-router';

import { GitDiffView } from '@/components/git-diff-view';

/**
 * The changes sheet route: the params, nothing else. The frame belongs to the
 * view, for the same reason it does in `artifacts` and `panels` -- a
 * percentage-height wrapper collapses inside a native form sheet, and the sheet
 * lays its own two subviews out around the scroll view itself.
 *
 * A route of its own rather than a section of the files sheet. What a session
 * wrote out and what it changed in place are different questions, and the
 * second one needs a surface wide enough to be a diff.
 *
 * `vcsFiles` is `1` when the gateway advertised `pane_vcs_files`; the entry
 * point already holds the capability list, so the route is told rather than
 * asking again.
 *
 * No `onClose` to hand down: the sheet has no close button, because the grabber
 * and the swipe are the close.
 */
export default function GitDiffScreen() {
  const params = useLocalSearchParams<{
    sessionId: string;
    paneId?: string;
    vcsFiles?: string;
  }>();

  return (
    <GitDiffView
      sessionId={params.sessionId || 'default'}
      paneId={params.paneId || ''}
      vcsFiles={params.vcsFiles === '1'}
    />
  );
}
