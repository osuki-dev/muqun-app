import { useLocalSearchParams } from 'expo-router';

import { AgentVcsDiffSheet } from '@/components/agent-vcs-diff-sheet';
import { gatewaySupportsVcsFiles } from '@/lib/agent-protocol';
import { useAgentSheetBridge } from '@/stores/agent-sheet-bridge';
import { useServerCapabilities } from '@/stores/server-capabilities';

/**
 * The agent's working-tree diff route: which session, plus an optional file to
 * open and land on. The patch is fetched by the sheet, the way `git-diff`
 * fetches its own.
 */
export default function AgentVcsDiffScreen() {
  const params = useLocalSearchParams<{ sessionId?: string; asid?: string; path?: string }>();
  const bridgeSessionId = useAgentSheetBridge((state) => state.sessionId);
  const bridgeAsid = useAgentSheetBridge((state) => state.activeAsid);
  const serverId = useAgentSheetBridge((state) => state.serverId);
  // What `/health` last said this gateway can do: lazy per-file patches and
  // discard, or the one `…/vcs/diff` answer every gateway has.
  const filesApi = useServerCapabilities((state) =>
    serverId ? gatewaySupportsVcsFiles(state.byServer[serverId]) : false
  );

  const sessionId = params.sessionId || bridgeSessionId;
  const asid = params.asid || bridgeAsid;

  // A session is what this sheet is about; without one there is no diff to
  // fetch and the sheet renders its own empty state rather than throwing.
  return (
    <AgentVcsDiffSheet
      sessionId={sessionId}
      asid={asid ?? ''}
      targetPath={params.path}
      filesApi={filesApi}
    />
  );
}
