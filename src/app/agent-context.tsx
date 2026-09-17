import { useRouter } from 'expo-router';

import { AgentContextSheet } from '@/components/agent-context-sheet';
import { useAgentSheetBridge } from '@/stores/agent-sheet-bridge';

/**
 * The context and usage sheet's route. Every switch on it belongs to the
 * workbench's session, so all five handlers come from the sheet bridge.
 */
export default function AgentContextScreen() {
  const router = useRouter();
  const sessionInfo = useAgentSheetBridge((state) => state.sessionInfo);
  const tokens = useAgentSheetBridge((state) => state.tokens);
  const contextUsage = useAgentSheetBridge((state) => state.contextUsage);
  const cost = useAgentSheetBridge((state) => state.cost);
  const showReasoning = useAgentSheetBridge((state) => state.showReasoning);
  const yoloMode = useAgentSheetBridge((state) => state.yoloMode);
  const actions = useAgentSheetBridge((state) => state.actions);

  return (
    <AgentContextSheet
      session={sessionInfo}
      tokens={tokens}
      contextUsage={contextUsage}
      cost={cost}
      showReasoning={showReasoning}
      onToggleReasoning={actions.toggleReasoning}
      yoloMode={yoloMode}
      onToggleYolo={actions.toggleYolo}
      onClose={() => router.back()}
      onCompact={actions.compactContext}
      onClear={actions.clearContext}
    />
  );
}
