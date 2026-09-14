import { expect, test } from 'bun:test';
import { parseWorkOutputText } from '../work-output-text';
import { readCollaborationOutput } from '../agent-collaboration';
import { normalizeGatewayEntities } from '../gateway-entities';
import { observeCollaborationOutput } from '../collaboration-presentation';

const task = {
  id: 'attempt',
  serverId: 'gateway',
  sessionId: 'session',
  sourcePaneId: 'w2:p1',
  paneId: 'w2:p1',
  agentInstanceId: 'launch_114886_term_65b6f80a939ea6',
  agentName: 'codex',
  prompt: '',
  createdAt: 1,
};
const agents = (instance = task.agentInstanceId) =>
  normalizeGatewayEntities(
    {
      result: {
        type: 'agent_list',
        agents: [{ pane_id: task.paneId, instance_id: instance, agent: 'codex' }],
      },
    },
    ['agents', 'items']
  );
const output = {
  result: { type: 'pane_read', read: { output: 'MUQUN_MANAGED_7347', revision: 3 } },
};

test('real Gateway envelopes pass both exact owner checks and preserve a pinned output snapshot', async () => {
  let checks = 0;
  const result = await readCollaborationOutput(
    task,
    async () => {
      checks++;
      return agents();
    },
    async () => {
      const text = parseWorkOutputText(output);
      return { text, signature: text };
    },
    () => {}
  );
  expect(checks).toBe(2);
  expect(result?.text).toBe('MUQUN_MANAGED_7347');
  const pinned = { text: 'Earlier output', signature: 'Earlier output', hasNewOutput: false };
  expect(observeCollaborationOutput(pinned, result!, false)).toEqual({
    ...pinned,
    hasNewOutput: true,
  });
});

test('pane reuse during the recognized output read remains unavailable', async () => {
  let checks = 0;
  expect(
    await readCollaborationOutput(
      task,
      async () => agents(checks++ === 0 ? task.agentInstanceId : 'replacement'),
      async () => parseWorkOutputText(output),
      () => {}
    )
  ).toBeNull();
});

test('recognized legacy text remains readable, while error objects and malformed or oversized envelopes never become output', () => {
  for (const value of [
    'text',
    { text: 'text' },
    { output: 'text' },
    { data: { read: { output: 'text' } } },
  ])
    expect(parseWorkOutputText(value)).toBe('text');
  expect(parseWorkOutputText({ result: { read: { output: '' } } })).toBe('');
  for (const value of [
    { error: { message: 'Refused' } },
    { result: { type: 'pane_read' } },
    { output: 7 },
    { result: { read: [] } },
    'x'.repeat(1024 * 1024 + 1),
    '界'.repeat(400000),
  ])
    expect(() => parseWorkOutputText(value)).toThrow('Output unavailable');
});
