import { expect, test } from 'bun:test';

import {
  advanceAgentWorkbenchOwnerAfterCreate,
  agentWorkbenchOwnerMatches,
  agentWorkbenchRouteMatches,
  shouldPreserveNewSessionDraft,
  type AgentWorkbenchOwner,
} from '../agent-workbench-ownership';

const owner: AgentWorkbenchOwner = {
  serverId: 'server-a',
  sessionId: 'gateway-session',
  generation: 4,
  asid: 'agent-a',
  directory: '/work/a',
};

test('a request keeps ownership only for its captured route and source', () => {
  expect(agentWorkbenchOwnerMatches(owner, owner)).toBe(true);
  expect(agentWorkbenchOwnerMatches(owner, { ...owner, serverId: 'server-b' })).toBe(false);
  expect(agentWorkbenchOwnerMatches(owner, { ...owner, sessionId: 'other-session' })).toBe(false);
  expect(agentWorkbenchOwnerMatches(owner, { ...owner, generation: 5 })).toBe(false);
  expect(agentWorkbenchOwnerMatches(owner, { ...owner, asid: 'agent-b' })).toBe(false);
  expect(agentWorkbenchOwnerMatches(owner, { ...owner, directory: '/work/b' })).toBe(false);
  expect(agentWorkbenchRouteMatches(owner, { ...owner, asid: 'agent-b' })).toBe(true);
  expect(agentWorkbenchRouteMatches(owner, { ...owner, directory: '/work/b' })).toBe(false);
});

test('route-only requests do not claim a later asid or directory', () => {
  const routeOnly: AgentWorkbenchOwner = {
    serverId: owner.serverId,
    sessionId: owner.sessionId,
    generation: owner.generation,
    asid: undefined,
    directory: undefined,
    matchAsid: false,
    matchDirectory: false,
  };
  expect(agentWorkbenchOwnerMatches(routeOnly, owner)).toBe(true);
  expect(agentWorkbenchOwnerMatches(routeOnly, { ...owner, serverId: 'server-b' })).toBe(false);
});

test('an empty captured asid is distinct from a later selected asid', () => {
  const newSessionOwner: AgentWorkbenchOwner = {
    ...owner,
    asid: undefined,
  };
  expect(agentWorkbenchOwnerMatches(newSessionOwner, { ...owner, asid: undefined })).toBe(true);
  expect(agentWorkbenchOwnerMatches(newSessionOwner, owner)).toBe(false);
});

test('an owned create advances to the returned asid so the first prompt can send', async () => {
  const captured: AgentWorkbenchOwner = { ...owner, asid: undefined };
  let current = captured;
  const sent: string[] = [];
  const create = async () => ({ asid: 'agent-created' });
  const send = async (asid: string) => {
    sent.push(asid);
  };
  const created = await create();
  const advanced = advanceAgentWorkbenchOwnerAfterCreate(captured, current, created.asid);

  expect(advanced?.asid).toBe('agent-created');
  current = { ...current, asid: created.asid };
  if (advanced && agentWorkbenchOwnerMatches(advanced, current)) await send(created.asid);

  expect(sent).toEqual(['agent-created']);
});

test('a selection race rejects the create result before the first prompt sends', async () => {
  const captured: AgentWorkbenchOwner = { ...owner, asid: undefined };
  const selected = { ...owner, asid: 'agent-selected' };
  const sent: string[] = [];
  const create = async () => ({ asid: 'agent-created' });
  const send = async (asid: string) => {
    sent.push(asid);
  };
  const created = await create();
  const advanced = advanceAgentWorkbenchOwnerAfterCreate(captured, selected, created.asid);

  expect(advanced).toBeNull();
  if (advanced && agentWorkbenchOwnerMatches(advanced, selected)) await send(created.asid);
  expect(sent).toEqual([]);
});

test('a fresh Home new intent keeps its draft when choosing a workspace', () => {
  const calls: string[] = [];
  const intent: 'new' | undefined = 'new';
  let activeAsid: string | undefined;

  if (shouldPreserveNewSessionDraft(intent, activeAsid)) {
    calls.push('set-directory');
  } else {
    calls.push('list-sessions');
    calls.push('create-session');
  }

  expect(calls).toEqual(['set-directory']);

  activeAsid = 'agent-created-on-first-prompt';
  expect(shouldPreserveNewSessionDraft(intent, activeAsid)).toBe(false);
});

test('ordinary workspace selection still resolves a backend session', () => {
  expect(shouldPreserveNewSessionDraft(undefined, undefined)).toBe(false);
  expect(shouldPreserveNewSessionDraft('new', 'agent-existing')).toBe(false);
});
