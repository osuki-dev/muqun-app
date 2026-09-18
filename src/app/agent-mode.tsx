import { useLocalSearchParams, useRouter } from 'expo-router';

import { AgentModeSheet } from '@/components/agent-mode-sheet';
import { useAgentSheetBridge } from '@/stores/agent-sheet-bridge';

/** The agent-mode picker's route. See `agent-model.tsx` for the same shape. */
export default function AgentModeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ sessionId?: string; directory?: string }>();
  const bridgeSessionId = useAgentSheetBridge((state) => state.sessionId);
  /**
   * The workspace whose agents are listed.
   *
   * OpenCode scopes agents per project, so the catalog read this sheet makes
   * has to name a directory or it gets the global list and no project-defined
   * agent at all. The param is what a link states; the bridge is what the
   * workbench has on screen, for an opening that carried none.
   */
  const bridgeDirectory = useAgentSheetBridge((state) => state.activeDirectory);
  const selectedAgent = useAgentSheetBridge((state) => state.selectedAgent);
  /**
   * What the session is running, when the catalogue's default has not landed.
   *
   * With neither, the sheet had no current row at all and the reader had to
   * pick one to find out which agent was already answering them.
   */
  const sessionAgent = useAgentSheetBridge((state) => state.sessionInfo?.agent);
  const selectAgentMode = useAgentSheetBridge((state) => state.actions.selectAgentMode);

  return (
    <AgentModeSheet
      sessionId={params.sessionId || bridgeSessionId || undefined}
      directory={params.directory || bridgeDirectory || undefined}
      selectedAgent={selectedAgent ?? sessionAgent}
      onSelectAgent={(agent) => {
        selectAgentMode(agent);
        router.back();
      }}
      onClose={() => router.back()}
    />
  );
}
