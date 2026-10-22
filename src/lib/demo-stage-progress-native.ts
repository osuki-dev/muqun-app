import { useHomeRecentsStore } from '@/stores/home-recents';
import { useHomeThreads } from '@/stores/home-thread';
import { useHomeAgentSessions } from '@/stores/home-agent-sessions';
import { useServerAgents } from '@/stores/server-agents';
import { useServerTasksStore } from '@/stores/server-tasks';
import { DEMO_PAIRING_SERVER_ID } from './pairing';
import { gatewayAgentSessions } from './home-continue';

import {
  DEMO_STAGE_ASIDS,
  activateDemoStageProgress,
  clearDemoStageProgress,
  isDemoStageProgressActive,
  demoStageSessions,
  demoStagePanes,
  demoStageTasks,
} from './demo-stage-progress';

let restore: (() => void) | undefined;

export function stopDemoStageProgress(): void {
  clearDemoStageProgress();
  if (restore) {
    const recents = useHomeRecentsStore.getState();
    for (const entry of recents.entries) {
      const target = entry.target;
      if (
        target.kind === 'agent-session' &&
        target.serverId === DEMO_PAIRING_SERVER_ID &&
        DEMO_STAGE_ASIDS.some((asid) => asid === target.asid)
      )
        void recents.remove(target);
    }
    const threads = useHomeThreads.getState();
    const target = threads.byServer[DEMO_PAIRING_SERVER_ID];
    if (target?.kind === 'session' && DEMO_STAGE_ASIDS.some((asid) => asid === target.asid))
      threads.clear(DEMO_PAIRING_SERVER_ID, target);
  }
  restore?.();
  restore = undefined;
}

export function startDemoStageProgress(serverId: string, offlineDemo: boolean): void {
  if (!offlineDemo || serverId !== DEMO_PAIRING_SERVER_ID || isDemoStageProgressActive()) return;
  const sessions = useHomeAgentSessions.getState().byServer[serverId];
  const seen = useHomeAgentSessions.getState().seenAtMs[serverId];
  const panes = useServerAgents.getState().byServer[serverId];
  const tasks = useServerTasksStore.getState().index[serverId];
  restore = () => {
    useHomeAgentSessions.setState((state) => {
      const { [serverId]: _sessions, ...byServer } = state.byServer;
      const { [serverId]: _seen, ...seenAtMs } = state.seenAtMs;
      return {
        byServer: sessions ? { ...byServer, [serverId]: sessions } : byServer,
        seenAtMs: seen === undefined ? seenAtMs : { ...seenAtMs, [serverId]: seen },
      };
    });
    useServerAgents.setState((state) => {
      const { [serverId]: _panes, ...byServer } = state.byServer;
      return { byServer: panes ? { ...byServer, [serverId]: panes } : byServer };
    });
    useServerTasksStore.setState((state) => {
      const { [serverId]: _tasks, ...index } = state.index;
      return { index: tasks ? { ...index, [serverId]: tasks } : index };
    });
  };
  const startedAt = activateDemoStageProgress(serverId, offlineDemo);
  // Feed the normal Home stores; followers, dedupe, navigation and transcript
  // rendering remain the production path. Nothing is persisted by this fixture.
  useHomeAgentSessions.getState().record({
    serverId,
    sessionId: 'demo',
    observedAtMs: startedAt,
    sessions: gatewayAgentSessions(demoStageSessions()),
  });
  useServerAgents.setState((state) => ({
    byServer: {
      ...state.byServer,
      [serverId]: {
        serverId,
        sessionId: 'demo',
        checkedAtMs: startedAt,
        agents: demoStagePanes()!.map((pane) => ({
          id: pane.id,
          name: 'Codex',
          agentLabel: 'codex',
          paneId: pane.id,
          instanceId: pane.instance_id,
          shellPid: pane.shell_pid,
          status: 'working',
          hasAgent: true,
        })),
      },
    },
  }));
  useServerTasksStore.getState().replace(serverId, demoStageTasks(), startedAt);
}
