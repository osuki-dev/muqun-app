import { afterEach, expect, test } from 'bun:test';
import {
  activateDemoStageProgress,
  clearDemoStageProgress,
  demoStageSessions,
  demoStageSnapshot,
  demoStageTasks,
} from '../demo-stage-progress';
import { DEMO_PAIRING_SERVER_ID } from '../pairing';
import { gatewayAgentSessions } from '../home-continue';
import { parseAgentSessionSnapshot } from '../agent-protocol';
import { stageProgressLines } from '../stage-overlay';

afterEach(clearDemoStageProgress);

test('Stage QA fixture refuses live identities and remains empty unless explicitly enabled', () => {
  expect(demoStageSessions()).toEqual([]);
  expect(activateDemoStageProgress('real-server', true)).toBe(0);
  expect(activateDemoStageProgress(DEMO_PAIRING_SERVER_ID, false)).toBe(0);
  expect(demoStageSnapshot('demo-stage-linked')).toBeNull();
  activateDemoStageProgress(DEMO_PAIRING_SERVER_ID, true);
  expect(demoStageSessions()).toHaveLength(2);
  clearDemoStageProgress();
  expect(demoStageSessions()).toEqual([]);
  expect(demoStageTasks()).toEqual([]);
});

test('Stage QA wire snapshots preserve native provider and exact terminal linkage', () => {
  const nowMs = activateDemoStageProgress(DEMO_PAIRING_SERVER_ID, true);
  const first = parseAgentSessionSnapshot(demoStageSnapshot('demo-stage-linked'));
  expect(first.info?.runtime?.terminal).toEqual({
    session_id: 'demo',
    pane_id: 'demo-stage-linked-pane',
    instance_id: 'demo-stage-instance',
  });
  const sessions = gatewayAgentSessions(demoStageSessions());
  expect(sessions[0]?.agentId).toBe('codex');
  expect(sessions[0]?.title).toBe(sessions[1]?.title);
  const lines = stageProgressLines({
    serverId: DEMO_PAIRING_SERVER_ID,
    nowMs,
    tasks: demoStageTasks(),
    sessions: {
      serverId: DEMO_PAIRING_SERVER_ID,
      sessionId: 'demo',
      observedAtMs: nowMs,
      sessions,
    },
    panes: {
      serverId: DEMO_PAIRING_SERVER_ID,
      sessionId: 'demo',
      checkedAtMs: nowMs,
      agents: [
        {
          id: 'demo-stage-linked-pane',
          name: 'Codex',
          paneId: 'demo-stage-linked-pane',
          instanceId: 'demo-stage-instance',
          shellPid: 41,
          hasAgent: true,
          status: 'working',
        },
        {
          id: 'demo-stage-terminal',
          name: 'Codex',
          paneId: 'demo-stage-terminal',
          shellPid: 42,
          hasAgent: true,
          status: 'working',
        },
      ],
    },
    activities: [
      {
        key: 'session:independent',
        asid: 'demo-stage-independent',
        agentId: 'codex',
        sessionId: 'demo',
        text: 'Independent progress',
        atMs: nowMs,
      },
    ],
  });
  expect(lines).toHaveLength(3);
  expect(lines.filter((line) => line.asid === 'demo-stage-linked')).toHaveLength(1);
  expect(lines.some((line) => line.text.includes('DUPLICATE'))).toBe(false);
});
