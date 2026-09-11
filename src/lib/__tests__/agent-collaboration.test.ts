import { describe, expect, test } from 'bun:test';
import {
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
  test('handing work to an assistant that is already running is not available', () => {
    // Both delivery paths stop on this, and the screen stops offering the
    // target because of it. If this ever returns true without the Gateway
    // enforcing an instance-bound request, a task can land on whichever agent
    // happens to occupy the pane by the time it arrives -- the wrong assistant
    // receiving someone's work, which is worse than nothing receiving it.
    expect(supportsExistingAgentDelivery()).toBe(false);
  });

  test('the screen offers only targets that can be delivered to', () => {
    // The list the segmented control is built from. `false` is "already
    // running", `true` is "start a new one". With existing delivery
    // unavailable, a server that can spawn offers exactly one target -- and
    // one target is not a choice, so no switch is drawn.
    const modes = (canSpawn: boolean) => [
      ...(supportsExistingAgentDelivery() ? [false] : []),
      ...(canSpawn ? [true] : []),
    ];
    expect(modes(true)).toEqual([true]);
    // Nothing to spawn with and nothing to hand work to: the form has nowhere
    // to send, and says so instead of collecting a task it cannot deliver.
    expect(modes(false)).toEqual([]);
  });
});
