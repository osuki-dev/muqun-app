import { useLocalSearchParams, useRouter } from 'expo-router';

import { AgentVcsDiffSheet } from '@/components/agent-vcs-diff-sheet';
import { useAgentSheetBridge } from '@/stores/agent-sheet-bridge';

/**
 * The agent's working-tree diff route: which session, plus an optional file to
 * open and land on. The patch is fetched by the sheet, the way `git-diff`
 * fetches its own.
 */
export default function AgentVcsDiffScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ sessionId?: string; asid?: string; path?: string }>();
  const bridgeSessionId = useAgentSheetBridge((state) => state.sessionId);
  const bridgeAsid = useAgentSheetBridge((state) => state.activeAsid);

  const sessionId = params.sessionId || bridgeSessionId;
  const asid = params.asid || bridgeAsid;

  // A session is what this sheet is about; without one there is no diff to
  // fetch and the sheet renders its own empty state rather than throwing.
  return (
    <AgentVcsDiffSheet
      sessionId={sessionId}
      asid={asid ?? ''}
      targetPath={params.path}
      onClose={() => router.back()}
    />
  );
}
