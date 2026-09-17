import { useLocalSearchParams, useRouter } from 'expo-router';

import { AgentModelSheet } from '@/components/agent-model-sheet';
import { useAgentSheetBridge } from '@/stores/agent-sheet-bridge';

/**
 * The model picker's route. The gateway session is a param, because that is
 * the part a link has to be able to state; the current selection and the
 * handler come from the sheet bridge.
 */
export default function AgentModelScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ sessionId?: string }>();
  const bridgeSessionId = useAgentSheetBridge((state) => state.sessionId);
  const selectedModel = useAgentSheetBridge((state) => state.selectedModel);
  const selectModel = useAgentSheetBridge((state) => state.actions.selectModel);

  return (
    <AgentModelSheet
      sessionId={params.sessionId || bridgeSessionId || undefined}
      selectedModel={selectedModel}
      onSelectModel={(model) => {
        selectModel(model);
        router.back();
      }}
      onClose={() => router.back()}
    />
  );
}
