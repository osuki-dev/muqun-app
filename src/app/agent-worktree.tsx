import { useRouter } from 'expo-router';

import { AgentWorktreeSheet } from '@/components/agent-worktree-sheet';
import { hasRealSessionTitle } from '@/lib/agent-session';
import { useAgentSheetBridge } from '@/stores/agent-sheet-bridge';

/**
 * The worktree switcher's route.
 *
 * Moving a session is the workbench's job -- it owns the session, the stream
 * and the screen's notice -- so the pick goes back through the sheet bridge
 * the way a workspace pick does. Everything about the *inventory* is the
 * sheet's own: listing, making and removing a worktree are calls with no
 * session in them at all.
 */
export default function AgentWorktreeScreen() {
  const router = useRouter();
  const sessionInfo = useAgentSheetBridge((state) => state.sessionInfo);
  const activeDirectory = useAgentSheetBridge((state) => state.activeDirectory);
  const activeProject = useAgentSheetBridge((state) => state.activeProject);
  const revision = useAgentSheetBridge((state) => state.worktreeRevision);
  const moveSession = useAgentSheetBridge((state) => state.actions.moveSession);

  return (
    <AgentWorktreeSheet
      sessionTitle={hasRealSessionTitle(sessionInfo) ? sessionInfo?.title : undefined}
      activeDirectory={activeDirectory}
      projectDirectory={activeProject?.canonical}
      revision={revision}
      onMove={moveSession}
      onClose={() => router.back()}
    />
  );
}
