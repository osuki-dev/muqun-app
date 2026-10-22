import { DEMO_PAIRING_SERVER_ID } from './pairing';
import type { AgentSessionSnapshot } from './agent-protocol';
import type { TaskView } from './task-ledger';

// Explicit offline QA scenario. No renderer overrides, network, or live records.
export const DEMO_STAGE_ASIDS = ['demo-stage-linked', 'demo-stage-independent'] as const;
let startedAt = 0;

export function demoStageSnapshot(asid: string): AgentSessionSnapshot | null {
  if (!startedAt || !DEMO_STAGE_ASIDS.some((id) => id === asid)) return null;
  const linked = asid === DEMO_STAGE_ASIDS[0];
  return {
    info: {
      asid,
      backend_session_id: asid,
      agent_id: 'codex',
      title: 'Stage QA conversation',
      directory: '/demo/stage',
      model: null,
      status: 'busy',
      updated_ms: startedAt,
      runtime: {
        source: 'native',
        interaction: 'native',
        transcript: 'live',
        status: 'working',
        ...(linked
          ? {
              terminal: {
                session_id: 'demo',
                pane_id: 'demo-stage-linked-pane',
                instance_id: 'demo-stage-instance',
              },
            }
          : {}),
      },
    },
    timeline: [
      {
        id: `${asid}-source`,
        message_id: `${asid}-source`,
        role: 'user',
        ordinal: 0,
        seq: 0,
        updated_ms: startedAt - 1,
        part: {
          type: 'text',
          text: linked ? 'STAGE_QA_OPENED_LINKED_SOURCE' : 'STAGE_QA_OPENED_INDEPENDENT_SOURCE',
        },
      },
      {
        id: `${asid}-text`,
        message_id: `${asid}-message`,
        role: 'assistant',
        ordinal: 0,
        seq: 1,
        updated_ms: startedAt,
        part: {
          type: 'text',
          text: linked
            ? 'STAGE_QA_LINKED_SESSION — native progress'
            : 'STAGE_QA_INDEPENDENT_SESSION — separate progress',
        },
      },
    ],
    permissions: [],
    forms: [],
    inbox: [],
    seq: 1,
  };
}

export function demoStageSessions() {
  return DEMO_STAGE_ASIDS.flatMap((asid) => {
    const info = demoStageSnapshot(asid)?.info;
    return info ? [info] : [];
  });
}

export function demoStagePanes() {
  if (!startedAt) return null;
  return [
    {
      id: 'demo-stage-linked-pane',
      pane_id: 'demo-stage-linked-pane',
      instance_id: 'demo-stage-instance',
      shell_pid: 41,
      label: 'Codex',
      agent: 'codex',
      agent_status: 'working',
      status: 'working',
      tab_id: 'tab-1',
      workspace_id: 'ws-1',
    },
    {
      id: 'demo-stage-terminal',
      pane_id: 'demo-stage-terminal',
      instance_id: 'demo-stage-terminal-instance',
      shell_pid: 42,
      label: 'Codex',
      agent: 'codex',
      agent_status: 'working',
      status: 'working',
      tab_id: 'tab-1',
      workspace_id: 'ws-1',
    },
  ];
}

export function demoStageTasks(): TaskView[] {
  if (!startedAt) return [];
  return [
    {
      taskId: 'demo-stage-native-task',
      kind: 'delegation',
      state: 'working',
      goal: 'Synthetic native work',
      binding: { kind: 'agent_session', agentId: 'codex', asid: DEMO_STAGE_ASIDS[0] },
      progress: 'STAGE_QA_LINKED_SESSION — native progress',
      updatedMs: startedAt,
    },
    {
      taskId: 'demo-stage-linked-task',
      kind: 'delegation',
      state: 'working',
      goal: 'Synthetic linked terminal',
      binding: {
        kind: 'pane',
        sessionId: 'demo',
        paneId: 'demo-stage-linked-pane',
        agentId: 'codex',
        shellPid: 41,
      },
      progress: 'STAGE_QA_LINKED_TERMINAL_DUPLICATE',
      updatedMs: startedAt + 1,
    },
    {
      taskId: 'demo-stage-terminal-task',
      kind: 'delegation',
      state: 'working',
      goal: 'Synthetic independent terminal',
      binding: {
        kind: 'pane',
        sessionId: 'demo',
        paneId: 'demo-stage-terminal',
        agentId: 'codex',
        shellPid: 42,
      },
      progress: 'STAGE_QA_PURE_TERMINAL',
      updatedMs: startedAt,
    },
  ];
}

export function demoStagePaneOutput(paneId: string): string | undefined {
  if (!startedAt) return undefined;
  if (paneId === 'demo-stage-linked-pane') return 'Working: STAGE_QA_LINKED_TERMINAL_DUPLICATE';
  if (paneId === 'demo-stage-terminal') return 'Working: STAGE_QA_PURE_TERMINAL';
  return undefined;
}

export function isDemoStageProgressActive(): boolean {
  return startedAt !== 0;
}
export function activateDemoStageProgress(serverId: string, offlineDemo: boolean): number {
  if (!offlineDemo || serverId !== DEMO_PAIRING_SERVER_ID) return 0;
  startedAt ||= Date.now();
  return startedAt;
}
export function clearDemoStageProgress(): void {
  startedAt = 0;
}
