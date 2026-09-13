import { useLingui } from '@lingui/react/macro';
import { useLocalSearchParams, useRouter } from 'expo-router';

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
 */
export default function GitDiffScreen() {
  const { t } = useLingui();
  const router = useRouter();
  const params = useLocalSearchParams<{
    sessionId: string;
    paneId?: string;
    label?: string;
    branch?: string;
  }>();

  return (
    <GitDiffView
      sessionId={params.sessionId || 'default'}
      paneId={params.paneId || ''}
      label={params.label || t`Server`}
      branch={params.branch || ''}
      onClose={() => router.back()}
    />
  );
}
