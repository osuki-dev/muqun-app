import { useLingui } from '@lingui/react/macro';
import { useLocalSearchParams } from 'expo-router';

import { SessionArtifacts } from '@/components/session-artifacts';

/**
 * The files sheet route: the params, nothing else. The frame belongs to the
 * browser, for the same reason it does in `panels` -- a percentage-height
 * wrapper collapses inside a native form sheet.
 *
 * A route of its own rather than a section of the panels sheet. Switching
 * panels and reading what the session wrote are different questions, and the
 * second one deserves a surface it can be a browser on.
 *
 * No `onClose` to hand down: the sheet has no close button, because the grabber
 * and the swipe are the close.
 */
export default function ArtifactsScreen() {
  const { t } = useLingui();
  const params = useLocalSearchParams<{
    sessionId: string;
    tabId?: string;
    label?: string;
  }>();

  return (
    <SessionArtifacts
      sessionId={params.sessionId || 'default'}
      tabId={params.tabId || ''}
      label={params.label || t`Server`}
    />
  );
}
