import { useLocalSearchParams, useRouter } from 'expo-router';

import { AgentWorkspaceSheet } from '@/components/agent-workspace-sheet';
import { useAgentSheetBridge } from '@/stores/agent-sheet-bridge';

/**
 * The workspace switcher's route.
 *
 * Picking a workspace starts a session in it, which is the workbench's job, so
 * the pick goes back through the sheet bridge the way a panel pick goes back
 * through `stores/panel-picker.ts`.
 */
export default function AgentWorkspaceScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ sessionId?: string }>();
  const bridgeSessionId = useAgentSheetBridge((state) => state.sessionId);
  const activeDirectory = useAgentSheetBridge((state) => state.activeDirectory);
  const knownProjects = useAgentSheetBridge((state) => state.knownProjects);
  const selectWorkspace = useAgentSheetBridge((state) => state.actions.selectWorkspace);

  return (
    <AgentWorkspaceSheet
      sessionId={params.sessionId || bridgeSessionId || undefined}
      activeDirectory={activeDirectory}
      initialProjects={knownProjects}
      onSelectWorkspace={selectWorkspace}
      onClose={() => router.back()}
    />
  );
}
