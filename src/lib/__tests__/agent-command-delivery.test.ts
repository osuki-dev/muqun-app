import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import {
  agentCommandDestination,
  sendVerifiedAgentCommand,
  type AgentCommandDestination,
} from '../agent-command-delivery';
import { normalizeGatewayEntities } from '../gateway-entities';
import { supportsExistingAgentDelivery } from '../agent-collaboration';

const agents = (instance = 'first', status = 'idle') =>
  normalizeGatewayEntities(
    [{ pane_id: 'pane', instance_id: instance, target: 'opaque', status }],
    []
  );
const destination = agentCommandDestination('server', 'session', 'pane', agents())!;

test('agent command entry points do not bypass the unavailable bound-delivery contract', () => {
  const hook = readFileSync(
    new URL('../../hooks/use-agent-command-delivery.ts', import.meta.url),
    'utf8'
  );
  const collaboration = readFileSync(
    new URL('../../hooks/use-composer-assignment.ts', import.meta.url),
    'utf8'
  );
  const commands = readFileSync(new URL('../../app/commands.tsx', import.meta.url), 'utf8');
  // Two different questions, and they used to have one answer between them.
  //
  // The command sheet acts on the pane the reader has open. It sends, and it
  // must: holding it closed made the whole catalogue dead -- `/status` on the
  // agent on screen answered "Update Muqun Gateway". It goes through
  // `sendAgentText`, the same endpoint the composer directly above it uses for
  // the same agent, after re-verifying the instance.
  expect(hook).toContain('sendAgentText(sessionId, target.target');
  expect(hook).toContain('supportsBoundDelivery: async () => true');
  expect(commands).toContain('agentDelivery.send(command.value)');
  expect(commands).toContain('agentDelivery.send(entry.command)');

  // Collaboration is the other question -- dispatch to an agent that is not
  // on screen. It sends too now, and what it does about the replacement race
  // is the same fresh-instance check, made before the write and never retried.
  expect(supportsExistingAgentDelivery()).toBe(true);
  expect(collaboration).toContain("field(agent, 'instance_id') !== target.instanceId");
  expect(collaboration).toContain("field(agent, 'target') || target.paneId");
  const code = collaboration
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n');
  expect(/retry|attempt/i.test(code)).toBe(false);
});

test('a command sheet send is still bound to the agent it was opened for', () => {
  // Sending is not the same as sending anywhere. The destination is captured
  // when the sheet opens and re-checked against a fresh read: a pane whose
  // agent has been replaced must not inherit a sheet someone left open.
  const hook = readFileSync(
    new URL('../../hooks/use-agent-command-delivery.ts', import.meta.url),
    'utf8'
  );
  expect(hook).toContain('agentCommandDestination(serverId, sessionId, paneId, agents)');
  expect(hook).toContain('destination.paneId === paneId');
});

function setup() {
  const sent: { destination: AgentCommandDestination; text: string }[] = [];
  return {
    sent,
    ports: {
      connectedServerId: () => 'server',
      loadAgents: async () => agents(),
      supportsBoundDelivery: async () => true,
      send: async (destination: AgentCommandDestination, text: string) => {
        sent.push({ destination, text });
      },
    },
  };
}

test('a busy agent still answers a question, because a question is not an assignment', async () => {
  // `canAssignToAgent` is the collaboration rule: start a new assignment at an
  // idle prompt, because Herdr cannot correlate completion with a turn. A slash
  // command has no completion to correlate, so refusing `/status` from a
  // working agent was borrowing a rule from a case this is not.
  const { ports, sent } = setup();
  ports.loadAgents = async () => agents('first', 'working');
  await sendVerifiedAgentCommand(destination, '/status', { ...ports, requireIdle: false });
  expect(sent).toHaveLength(1);
  // The default is still the stricter rule, for the caller that wants it.
  await expect(sendVerifiedAgentCommand(destination, '/status', ports)).rejects.toThrow('agent');
});

test('captures only verified agent identities and sends via the latest opaque target', async () => {
  expect(agentCommandDestination('server', 'session', 'pane', [])).toBeNull();
  expect(agentCommandDestination('server', 'session', 'pane', agents(''))).toBeNull();
  const { ports, sent } = setup();
  await sendVerifiedAgentCommand(destination, 'Review my code', ports);
  expect(sent).toEqual([
    { destination: { ...destination, target: 'opaque' }, text: 'Review my code' },
  ]);
});

test('a replaced or exited agent never receives a saved skill', async () => {
  for (const current of [[], agents('replacement')]) {
    const { ports, sent } = setup();
    ports.loadAgents = async () => current;
    await expect(sendVerifiedAgentCommand(destination, 'Review', ports)).rejects.toThrow('agent');
    expect(sent).toHaveLength(0);
  }
});

test('blocked, busy and unknown agents do not receive instructions or approval answers', async () => {
  for (const status of ['blocked', 'working', 'unknown']) {
    const { ports, sent } = setup();
    ports.loadAgents = async () => agents('first', status);
    await expect(sendVerifiedAgentCommand(destination, 'Review', ports)).rejects.toThrow('agent');
    expect(sent).toHaveLength(0);
  }
});

test('connection changes before or during verification prevent dispatch', async () => {
  const { ports, sent } = setup();
  ports.connectedServerId = () => 'other';
  await expect(sendVerifiedAgentCommand(destination, 'Review', ports)).rejects.toThrow(
    'connection'
  );
  ports.connectedServerId = () => 'server';
  ports.loadAgents = async () => {
    ports.connectedServerId = () => 'other';
    return agents();
  };
  await expect(sendVerifiedAgentCommand(destination, 'Review', ports)).rejects.toThrow(
    'connection'
  );
  expect(sent).toHaveLength(0);
});

test('missing instance-bound capability fails closed without a pane or shell fallback', async () => {
  const { ports, sent } = setup();
  ports.supportsBoundDelivery = async () => false;
  await expect(sendVerifiedAgentCommand(destination, 'Review', ports)).rejects.toThrow(
    'unsupported'
  );
  expect(sent).toHaveLength(0);
});

test('an ambiguous response is reported after one attempt and is never retried', async () => {
  const { ports } = setup();
  let attempts = 0;
  ports.send = async () => {
    attempts++;
    throw new Error('Connection lost after request');
  };
  await expect(sendVerifiedAgentCommand(destination, 'Review', ports)).rejects.toThrow('ambiguous');
  expect(attempts).toBe(1);
});
