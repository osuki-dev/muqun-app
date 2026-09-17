import { useLocalSearchParams, useRouter } from 'expo-router';

import { AgentModeSheet } from '@/components/agent-mode-sheet';
import { useAgentSheetBridge } from '@/stores/agent-sheet-bridge';

/** The agent-mode picker's route. See `agent-model.tsx` for the same shape. */
export default function AgentModeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ sessionId?: string }>();
  const bridgeSessionId = useAgentSheetBridge((state) => state.sessionId);
  const selectedAgent = useAgentSheetBridge((state) => state.selectedAgent);
  const selectAgentMode = useAgentSheetBridge((state) => state.actions.selectAgentMode);

  return (
    <AgentModeSheet
      sessionId={params.sessionId || bridgeSessionId || undefined}
      selectedAgent={selectedAgent}
      onSelectAgent={(agent) => {
        selectAgentMode(agent);
        router.back();
      }}
      onClose={() => router.back()}
    />
  );
}
