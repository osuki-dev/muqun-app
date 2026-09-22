import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  assignmentStripState,
  collaborationSpawnOutcome,
  collaborationAvailability,
  collaborationAgents,
  canAssignToAgent,
  collaborationPrompt,
  parseCollaborationTasks,
  tasksForSession,
  taskAgent,
  partitionCollaborationTasks,
  recordCollaborationTask,
  supportsExistingAgentDelivery,
  readCollaborationOutput,
  compactCollaborationOutput,
  type CollaborationTask,
} from '../agent-collaboration';
import { normalizeGatewayEntities } from '../gateway-entities';
import type { HealthResponse } from '../gateway-client';

const health: HealthResponse = {
  ok: true,
  gatewayVersion: '0.9.0',
  serverId: 'server',
  label: 'Server',
  capabilities: ['agent_collaboration'],
  backend: { sessionId: 'tmux', kind: 'tmux', connected: true, version: '3.6' },
  backends: [
    { sessionId: 'herdr', kind: 'herdr', connected: true, version: '0.9.0' },
    { sessionId: 'old', kind: 'herdr', connected: true, version: '0.8.9' },
  ],
};

describe('collaboration compatibility', () => {
  test('uses the selected backend, not the primary tmux version', () => {
    expect(collaborationAvailability(health, 'herdr', 'herdr')).toBe('ready');
    expect(collaborationAvailability(health, 'old', 'herdr')).toBe('herdr');
    expect(collaborationAvailability(health, 'tmux', 'tmux')).toBe('backend');
    expect(collaborationAvailability(health, 'missing', 'herdr')).toBe('unavailable');
  });
  test('gives old gateways a specific upgrade reason', () => {
    expect(collaborationAvailability({ ...health, capabilities: [] }, 'herdr', 'herdr')).toBe(
      'gateway'
    );
  });
  test('an old Herdr is never blamed on the Gateway', () => {
    // A current gateway withholds `agent_collaboration` when no session has a
    // Herdr 0.9.0+ behind it, so the gateway-wide array is missing for exactly
    // the machine whose problem is Herdr. Reading that array first answered
    // `gateway` there -- the one upgrade guaranteed not to help, which is the
    // failure this feature was fixed for once already.
    expect(collaborationAvailability({ ...health, capabilities: [] }, 'old', 'herdr')).toBe(
      'herdr'
    );
  });
  test('a per-session answer is the one that counts', () => {
    // The precise answer, from the gateway that actually pinged that backend.
    // It is preferred over both the version regex here and the gateway-wide
    // array, and an empty list for a connected Herdr means its version -- a
    // gateway too old for the feature sends no per-session key at all.
    const perSession = (capabilities: string[] | undefined, version: string | null) => ({
      ...health,
      capabilities: [],
      backends: [
        {
          sessionId: 'herdr',
          kind: 'herdr',
          connected: true,
          version,
          ...(capabilities ? { capabilities } : {}),
        },
      ],
    });
    expect(
      collaborationAvailability(perSession(['agent_collaboration'], '0.9.2'), 'herdr', 'herdr')
    ).toBe('ready');
    // The gateway-wide array says nothing, and the session's own list still
    // wins -- which is the whole point of sending it.
    expect(collaborationAvailability(perSession([], '0.9.2'), 'herdr', 'herdr')).toBe('herdr');
    // A gateway that reports no version at all still gets a verdict from its
    // own per-session answer rather than falling through to `unavailable`.
    expect(
      collaborationAvailability(perSession(['agent_collaboration'], null), 'herdr', 'herdr')
    ).toBe('ready');
  });
  test('the strip appears only where there is something to offer or to explain', () => {
    const offering = { canSpawn: true, candidates: 1 };
    const nothing = { canSpawn: false, candidates: 0 };

    expect(assignmentStripState('ready', offering)).toEqual({ toggle: true });
    // Ready, but this session has one terminal in it and a gateway that cannot
    // spawn. An empty row is not an answer, so there is no control to open one.
    expect(assignmentStripState('ready', nothing)).toEqual({ toggle: false });

    // The two upgrades, which open the strip even with nothing to offer --
    // because what it holds there is the sentence naming what to update.
    expect(assignmentStripState('gateway', nothing)).toEqual({
      toggle: true,
      upgrade: 'gateway',
    });
    expect(assignmentStripState('herdr', nothing)).toEqual({ toggle: true, upgrade: 'herdr' });

    // tmux, and a backend that is not answering. No toggle and no sentence: an
    // upgrade is not advice anybody can act on here, and ordinary terminal use
    // is untouched. A session with candidates cannot happen on tmux -- the join
    // drops an agent with no instance id -- but the rule does not depend on it.
    for (const availability of ['backend', 'unavailable'] as const) {
      expect(assignmentStripState(availability, offering)).toEqual({ toggle: false });
      expect(assignmentStripState(availability, nothing)).toEqual({ toggle: false });
    }
  });
  test('the demo gateway answers the way a current one does', () => {
    // The offline e2e flow drives the strip, so the fixture has to satisfy the
    // same gate a real gateway does -- and satisfy it by the same route, with a
    // per-session list rather than only the gateway-wide array. Read from the
    // source because importing `demo-gateway` pulls in the Lingui macro, which
    // this suite does not run a Babel pass for.
    const source = readFileSync(new URL('../demo-gateway.ts', import.meta.url), 'utf8');
    expect(source).toContain("capabilities: ['agent_collaboration']");
  });
  test('does not enable a disconnected or mismatched backend', () => {
    for (const backend of [
      { sessionId: 'herdr', kind: 'herdr', connected: false, version: '0.9.0' },
      { sessionId: 'herdr', kind: 'tmux', connected: true, version: '1.0.0' },
      { sessionId: 'herdr', kind: 'herdr', connected: true },
    ]) {
      expect(collaborationAvailability({ ...health, backends: [backend] }, 'herdr', 'herdr')).toBe(
        'unavailable'
      );
    }
  });
  test('accepts future stable releases and refuses uncertain versions', () => {
    for (const version of ['0.9.0', 'v0.10.0', '1.0.0', '0.9.0+build']) {
      expect(
        collaborationAvailability(
          {
            ...health,
            backends: [{ sessionId: 'herdr', kind: 'herdr', connected: true, version }],
          },
          'herdr',
          'herdr'
        )
      ).toBe('ready');
    }
    for (const version of ['0.8.99', '0.9.0-rc.1', 'unknown', '0.9']) {
      expect(
        collaborationAvailability(
          {
            ...health,
            backends: [{ sessionId: 'herdr', kind: 'herdr', connected: true, version }],
          },
          'herdr',
          'herdr'
        )
      ).toBe('herdr');
    }
  });
});

test('the assistant picker excludes the caller and prioritizes the same workspace', () => {
  const agents = normalizeGatewayEntities(
    [{ pane_id: 'self' }, { pane_id: 'elsewhere' }, { pane_id: 'nearby' }],
    []
  );
  const panes = normalizeGatewayEntities(
    [{ pane_id: 'nearby', workspace_id: 'w1', label: 'Reviewer' }],
    []
  );
  expect(collaborationAgents(agents, panes, 'self', 'w1').map((agent) => agent.paneId)).toEqual([
    'nearby',
    'elsewhere',
  ]);
  expect(collaborationAgents(agents, panes, 'self', 'w1')[0].name).toBe('Reviewer');
});

test('assignment chips keep the opaque agent instance as their React identity', () => {
  const source = readFileSync(
    new URL('../../components/agent-assignment-bar.tsx', import.meta.url),
    'utf8'
  );
  expect(source).toContain('key={candidate.instanceId}');
  expect(source).not.toContain('key={candidate.paneId}');
});

test('busy, blocked and unknown agents cannot receive a new tracked assignment', () => {
  for (const status of ['working', 'blocked', 'unknown', 'starting', ''])
    expect(canAssignToAgent(status)).toBe(false);
  expect(canAssignToAgent('idle')).toBe(true);
  expect(canAssignToAgent('done')).toBe(true);
});

test('history is scoped to both the paired server and session', () => {
  const task: CollaborationTask = {
    id: '1',
    serverId: 'a',
    sessionId: 'one',
    sourcePaneId: 'p1',
    paneId: 'p2',
    agentName: 'Reviewer',
    prompt: 'Review',
    createdAt: 1,
  };
  const tasks = [task, { ...task, id: '2', serverId: 'b' }, { ...task, id: '3', sessionId: 'two' }];
  expect(tasksForSession(tasks, 'a', 'one')).toEqual([task]);
  expect(parseCollaborationTasks(JSON.stringify(tasks))).toEqual(tasks);
  expect(parseCollaborationTasks('[null,{},42]')).toEqual([]);
  expect(parseCollaborationTasks('invalid')).toEqual([]);
  expect(parseCollaborationTasks(JSON.stringify([{ ...task, reviewed: 'yes' }]))).toEqual([]);
  expect(
    parseCollaborationTasks(JSON.stringify(Array.from({ length: 50 }, () => task)))
  ).toHaveLength(40);
});

test('context is opt-in, clearly delimited and bounded', () => {
  expect(collaborationPrompt(' Review ', '')).toBe('Review');
  const text = collaborationPrompt('Review', 'x'.repeat(7000));
  expect(text).toContain('reference material');
  expect(text.endsWith('x'.repeat(6000))).toBe(true);
  expect(text.length).toBeLessThan(6200);
});

test('output keeps content and indentation but collapses empty terminal padding', () => {
  expect(compactCollaborationOutput('\nAnswer\n\n  \n\t\n\n  indented code\n\nPrompt\n')).toBe(
    'Answer\n\n  indented code\n\nPrompt'
  );
  expect(compactCollaborationOutput(' \n\t\n ')).toBe('');
});

test('startup and delivery outcomes are explicit, never inferred from a created pane', () => {
  const created = { paneId: 'pane', tabId: null, workspaceId: null };
  expect(collaborationSpawnOutcome(created)).toBe('start-unconfirmed');
  expect(
    collaborationSpawnOutcome({
      ...created,
      agentStarted: false,
      failure: { step: 'agent', code: 'agent_start_timeout' },
    })
  ).toBe('start-unconfirmed');
  expect(
    collaborationSpawnOutcome({ ...created, failure: { step: 'agent', code: 'agent_not_ready' } })
  ).toBe('attention');
  expect(
    collaborationSpawnOutcome({
      ...created,
      failure: { step: 'agent', code: 'agent_start_failed' },
    })
  ).toBe('start-failed');
  expect(
    collaborationSpawnOutcome({ ...created, agentStarted: true, promptSubmitted: false })
  ).toBe('delivery-unconfirmed');
  expect(collaborationSpawnOutcome({ ...created, agentStarted: true, promptSubmitted: true })).toBe(
    'sent'
  );
});

test('history never attaches to a replacement occupant or unverified legacy pane', () => {
  const task: CollaborationTask = {
    id: 'task',
    serverId: 'server',
    sessionId: 'session',
    sourcePaneId: 'source',
    paneId: 'pane',
    agentName: 'Claude',
    agentInstanceId: 'original',
    prompt: 'review',
    createdAt: 1,
  };
  const agents = normalizeGatewayEntities([{ pane_id: 'pane', instance_id: 'original' }], []);
  expect(taskAgent(task, agents)).toBe(agents[0]);
  expect(
    taskAgent(task, normalizeGatewayEntities([{ pane_id: 'pane', instance_id: 'replacement' }], []))
  ).toBeUndefined();
  expect(taskAgent({ ...task, agentInstanceId: undefined }, agents)).toBeUndefined();
  expect(taskAgent(task, [])).toBeUndefined();
  expect(parseCollaborationTasks(JSON.stringify([{ ...task, agentInstanceId: 42 }]))).toEqual([]);
  expect(parseCollaborationTasks(JSON.stringify([task]))[0].agentInstanceId).toBe('original');
  const older = { ...task, id: 'older', createdAt: 0 };
  expect(partitionCollaborationTasks([task, older], agents)).toEqual({
    current: [task],
    history: [older],
  });
  const reviewed = { ...task, reviewed: true };
  expect(partitionCollaborationTasks([reviewed, older], agents)).toEqual({
    current: [],
    history: [reviewed, older],
  });
  expect(partitionCollaborationTasks([task], [])).toEqual({ current: [], history: [task] });
  const recorded = recordCollaborationTask([older], task);
  expect(partitionCollaborationTasks(recorded.slice(1), agents).current).toEqual([]);
});

test('a replaced agent or changed connection never exposes the pending snapshot', async () => {
  const task: CollaborationTask = {
    id: 'task',
    serverId: 'server',
    sessionId: 'session',
    sourcePaneId: 'source',
    paneId: 'pane',
    agentName: 'Claude',
    agentInstanceId: 'original',
    prompt: 'review',
    createdAt: 1,
  };
  const original = normalizeGatewayEntities([{ pane_id: 'pane', instance_id: 'original' }], []);
  const replacement = normalizeGatewayEntities(
    [{ pane_id: 'pane', instance_id: 'replacement' }],
    []
  );
  let reads = 0;
  const read = async () => {
    reads++;
    return 'private output';
  };
  expect(
    await readCollaborationOutput(
      task,
      async () => replacement,
      read,
      () => {}
    )
  ).toBeNull();
  expect(reads).toBe(0);
  let loads = 0;
  expect(
    await readCollaborationOutput(
      task,
      async () => (++loads === 1 ? original : replacement),
      read,
      () => {}
    )
  ).toBeNull();
  expect(reads).toBe(1);
  let connected = true;
  await expect(
    readCollaborationOutput(
      task,
      async () => {
        connected = false;
        return original;
      },
      read,
      () => {
        if (!connected) throw new Error('connection changed');
      }
    )
  ).rejects.toThrow('connection changed');
  expect(reads).toBe(1);
  expect(
    await readCollaborationOutput(
      task,
      async () => original,
      read,
      () => {}
    )
  ).toBe('private output');
});

describe('where a task can actually go', () => {
  test('handing work to an assistant that is already running is available', () => {
    // It returned false for a long time on the strength of a race a fresh
    // instance check narrows and the composer takes anyway. What guards it now
    // is written in `use-composer-assignment`: verify the instance immediately
    // before the write, use the target from that read, never retry.
    expect(supportsExistingAgentDelivery()).toBe(true);
  });
});
