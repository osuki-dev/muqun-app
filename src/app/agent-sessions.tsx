import { useRouter } from 'expo-router';

import { AgentSessionsSheet } from '@/components/agent-sessions-sheet';
import { useAgentSheetBridge } from '@/stores/agent-sheet-bridge';

/**
 * The all-sessions sheet route: the state, and nothing else.
 *
 * The frame belongs to the sheet, for the same reason it does in `panels` and
 * `artifacts` -- a percentage-height wrapper collapses inside a native form
 * sheet, and the sheet lays its own two subviews out around the scroller.
 *
 * What it reads comes from `stores/agent-sheet-bridge.ts` rather than from
 * props: the workbench that owns the session list is behind this sheet, not
 * above it. See that store for why.
 */
export default function AgentSessionsScreen() {
  const router = useRouter();
  const sessions = useAgentSheetBridge((state) => state.sessions);
  const activeAsid = useAgentSheetBridge((state) => state.activeAsid);
  const knownProjects = useAgentSheetBridge((state) => state.knownProjects);
  const activeDirectory = useAgentSheetBridge((state) => state.activeDirectory);
  const activeProject = useAgentSheetBridge((state) => state.activeProject);
  const actions = useAgentSheetBridge((state) => state.actions);

  return (
    <AgentSessionsSheet
      sessions={sessions}
      activeAsid={activeAsid}
      knownProjects={knownProjects}
      activeDirectory={activeDirectory}
      activeProject={activeProject}
      onSelectSession={actions.selectSession}
      onCreateNewSession={actions.createSession}
      onClose={() => router.back()}
    />
  );
}
