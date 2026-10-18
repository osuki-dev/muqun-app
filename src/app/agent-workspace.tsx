import { useLingui } from '@lingui/react/macro';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { AgentWorkspaceSheet } from '@/components/agent-workspace-sheet';
import { useAgentSheetBridge } from '@/stores/agent-sheet-bridge';
import { homeFolderName } from '@/lib/home-composer';
import { useHomeAgentChoice } from '@/stores/home-agent-choice';
import { TASK_DEFAULTS_CAPABILITY } from '@/lib/task-ledger';
import { useServerCapabilities } from '@/stores/server-capabilities';
import { useServerTasksStore } from '@/stores/server-tasks';

/**
 * The workspace switcher's route.
 *
 * Picking a workspace starts a session in it, which is the workbench's job, so
 * the pick goes back through the sheet bridge the way a panel pick goes back
 * through `stores/panel-picker.ts`.
 *
 * `owner=home` is Home's dock choosing the folder its goals start in on
 * `serverId` (the computer the dock has selected, so the shared client lists
 * that computer's folders). The pick is that computer's folder; the
 * workbench's bridge is never touched. Its first row is the gateway's default
 * folder (or "Last folder" where the gateway cannot name it) and clears the
 * pick, so the gateway applies that default again.
 */
export default function AgentWorkspaceScreen() {
  const { t } = useLingui();
  const router = useRouter();
  const params = useLocalSearchParams<{
    sessionId?: string;
    agentId?: string;
    owner?: string;
    serverId?: string;
  }>();
  const bridgeSessionId = useAgentSheetBridge((state) => state.sessionId);
  const activeDirectory = useAgentSheetBridge((state) => state.activeDirectory);
  const knownProjects = useAgentSheetBridge((state) => state.knownProjects);
  const catalogAgentId = useAgentSheetBridge((state) => state.catalogAgentId);
  const selectWorkspace = useAgentSheetBridge((state) => state.actions.selectWorkspace);
  const homeServerId = params.owner === 'home' ? params.serverId : undefined;
  const homeFolder = useHomeAgentChoice((state) =>
    homeServerId ? state.folderByServer[homeServerId] : undefined
  );
  const chooseFolder = useHomeAgentChoice((state) => state.chooseFolder);
  const reportsDefaults = useServerCapabilities((state) =>
    homeServerId ? state.byServer[homeServerId]?.includes(TASK_DEFAULTS_CAPABILITY) === true : false
  );
  const reportedCwd = useServerTasksStore((state) =>
    homeServerId ? state.defaultCwd[homeServerId] : undefined
  );
  const defaultCwd = reportsDefaults ? reportedCwd : undefined;
  const defaultLabel = homeFolderName(defaultCwd, { last: t`Last folder`, home: t`Home folder` });

  if (homeServerId) {
    return (
      <AgentWorkspaceSheet
        sessionId={params.sessionId || undefined}
        activeDirectory={homeFolder}
        defaultRow={{ label: defaultLabel }}
        agentId={params.agentId || undefined}
        onSelectWorkspace={(directory) => chooseFolder(homeServerId, directory)}
        onClose={() => router.back()}
      />
    );
  }
  return (
    <AgentWorkspaceSheet
      sessionId={params.sessionId || bridgeSessionId || undefined}
      activeDirectory={activeDirectory}
      agentId={catalogAgentId}
      initialProjects={knownProjects}
      onSelectWorkspace={selectWorkspace}
      onClose={() => router.back()}
    />
  );
}
