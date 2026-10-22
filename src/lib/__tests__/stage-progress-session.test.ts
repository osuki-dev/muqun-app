import { describe, expect, test } from 'bun:test';

import type { GatewayAgentSessionsSnapshot, HomeContinueEntry } from '../home-continue';
import { SERVER_AGENTS_STALE_AFTER_MS, type ServerAgentsSnapshot } from '../server-agents';
import { stageProgress } from '../stage-overlay';
import { stageProgressSession } from '../stage-progress-session';

const nowMs = 100_000;
const panes: ServerAgentsSnapshot = {
  serverId: 'computer',
  sessionId: 'herdr',
  checkedAtMs: nowMs,
  agents: [
    {
      id: 'native',
      name: 'codex',
      hasAgent: true,
      status: 'working',
      paneId: 'p1',
      instanceId: 'instance-a',
      shellPid: 41,
    },
  ],
};
const sessions: GatewayAgentSessionsSnapshot = {
  serverId: 'computer',
  sessionId: 'herdr',
  observedAtMs: nowMs,
  sessions: [
    {
      asid: 'opaque-conversation',
      agentId: 'codex',
      title: 'Work',
      directory: '/project',
      status: 'busy',
      updatedMs: nowMs,
      terminal: { sessionId: 'herdr', paneId: 'p1' },
    },
  ],
};
const line = stageProgress({
  tasks: [],
  panes,
  nowMs,
  activity: { key: 'pane:p1', paneId: 'p1', text: 'Running tests', atMs: nowMs },
})!;
const input = { line, serverId: 'computer', entries: [], panes, sessions, nowMs };

describe('stageProgressSession', () => {
  test('opens a gateway-linked pane as its opaque conversation', () => {
    expect(line.terminal).toEqual({ sessionId: 'herdr', instanceId: 'instance-a', shellPid: 41 });
    expect(stageProgressSession(input)?.destination).toEqual({
      type: 'agent-session',
      target: {
        kind: 'agent-session',
        serverId: 'computer',
        sessionId: 'herdr',
        asid: 'opaque-conversation',
        agentId: 'codex',
        directory: '/project',
      },
    });
  });

  test('does not match agent names, another computer, or another Herdr session', () => {
    expect(
      stageProgressSession({
        ...input,
        sessions: {
          ...sessions,
          sessions: sessions.sessions.map(({ terminal: _, ...session }) => session),
        },
      })
    ).toBeNull();
    expect(
      stageProgressSession({ ...input, sessions: { ...sessions, serverId: 'other' } })
    ).toBeNull();
    expect(stageProgressSession({ ...input, panes: { ...panes, sessionId: 'other' } })).toBeNull();
    expect(
      stageProgressSession({
        ...input,
        sessions: {
          ...sessions,
          sessions: sessions.sessions.map((session) => ({
            ...session,
            terminal: { sessionId: 'other', paneId: 'p1' },
          })),
        },
      })
    ).toBeNull();
  });

  test('rejects stale, ambiguous, and reused pane associations', () => {
    expect(
      stageProgressSession({ ...input, nowMs: nowMs + SERVER_AGENTS_STALE_AFTER_MS + 1 })
    ).toBeNull();
    expect(
      stageProgressSession({
        ...input,
        sessions: {
          ...sessions,
          sessions: [...sessions.sessions, { ...sessions.sessions[0]!, asid: 'another' }],
        },
      })
    ).toBeNull();
    expect(
      stageProgressSession({
        ...input,
        panes: {
          ...panes,
          agents: panes.agents.map((agent) => ({ ...agent, instanceId: 'replacement' })),
        },
      })
    ).toBeNull();
    expect(
      stageProgressSession({
        ...input,
        panes: { ...panes, agents: panes.agents.map((agent) => ({ ...agent, shellPid: 42 })) },
      })
    ).toBeNull();
  });

  test('resolves a session outside the six visible strip cards and preserves its destination', () => {
    const entries: HomeContinueEntry[] = Array.from({ length: 9 }, (_, index) => ({
      key: `row-${index}`,
      title: 'Same display name',
      atMs: nowMs,
      destination: {
        type: 'agent-session',
        target: {
          kind: 'agent-session',
          serverId: 'computer',
          sessionId: 'herdr',
          asid: `asid-${index}`,
          agentId: 'codex',
          directory: '/project',
        },
      },
    }));
    expect(
      stageProgressSession({
        ...input,
        entries,
        line: { key: 'session:asid-8', agentId: 'codex', text: 'Working', atMs: nowMs },
      })
    ).toBe(entries[8]);
    expect(
      stageProgressSession({
        ...input,
        entries,
        line: { key: 'session:asid-8', agentId: 'claude', text: 'Working', atMs: nowMs },
      })
    ).toBeNull();
  });
  test('a current gateway association replaces a recent routing through an old Herdr session', () => {
    const recent: HomeContinueEntry = {
      key: 'old-recent',
      title: 'Work',
      atMs: nowMs,
      destination: {
        type: 'recent',
        target: {
          kind: 'agent-session',
          serverId: 'computer',
          sessionId: 'old-workspace',
          asid: 'opaque-conversation',
          agentId: 'codex',
          directory: '/project',
        },
      },
    };
    for (const candidate of [
      line,
      { key: 'session:opaque-conversation', agentId: 'codex', text: 'Working', atMs: nowMs },
    ]) {
      expect(
        stageProgressSession({ ...input, entries: [recent], line: candidate })?.destination
      ).toMatchObject({
        target: { sessionId: 'herdr', asid: 'opaque-conversation' },
      });
    }
    expect(
      stageProgressSession({
        ...input,
        entries: [recent],
        line: {
          key: 'session:opaque-conversation',
          agentId: 'codex',
          text: 'Working',
          atMs: nowMs,
        },
        sessions: { ...sessions, observedAtMs: nowMs - SERVER_AGENTS_STALE_AFTER_MS - 1 },
      })
    ).toBe(recent);
  });
});
