import { useLocalSearchParams, useRouter } from 'expo-router';

import { AgentModelSheet } from '@/components/agent-model-sheet';
import { useAgentSheetBridge } from '@/stores/agent-sheet-bridge';
import { useHomeComposerSheet } from '@/stores/home-composer-sheet';

/**
 * The model picker's route. The gateway session is a param, because that is
 * the part a link has to be able to state; the current selection and the
 * handler come from the sheet bridge.
 */
export default function AgentModelScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    sessionId?: string;
    /** The computer whose remembered models are listed as recent. */
    memoryScope?: string;
    directory?: string;
    agentId?: string;
    /** `home`: opened from Home's dock, which has no session behind it. */
    owner?: string;
  }>();
  /** The agent whose models are listed; see `catalogAgentId` in the bridge. */
  const bridgeAgentId = useAgentSheetBridge((state) => state.catalogAgentId);
  const bridgeSessionId = useAgentSheetBridge((state) => state.sessionId);
  /** The workspace to read the catalog for; see `agent-mode.tsx`. */
  const bridgeDirectory = useAgentSheetBridge((state) => state.activeDirectory);
  const bridgeModel = useAgentSheetBridge((state) => state.selectedModel);
  const bridgeSelect = useAgentSheetBridge((state) => state.actions.selectModel);
  const homeModel = useHomeComposerSheet((state) => state.selectedModel);
  const homeSelect = useHomeComposerSheet((state) => state.onSelectModel);
  // Home names everything in the params; nothing of the bridge's applies.
  const fromHome = params.owner === 'home';
  const selectedModel = fromHome ? homeModel : bridgeModel;

  return (
    <AgentModelSheet
      sessionId={params.sessionId || (fromHome ? undefined : bridgeSessionId) || undefined}
      memoryScope={params.memoryScope || undefined}
      directory={params.directory || (fromHome ? undefined : bridgeDirectory) || undefined}
      agentId={params.agentId || (fromHome ? undefined : bridgeAgentId) || undefined}
      selectedModel={selectedModel}
      onSelectModel={(model) => {
        if (fromHome) homeSelect?.(model);
        else bridgeSelect(model);
        router.back();
      }}
      onClose={() => router.back()}
    />
  );
}
