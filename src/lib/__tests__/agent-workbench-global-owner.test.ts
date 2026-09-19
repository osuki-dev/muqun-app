import { expect, test } from 'bun:test';

import {
  agentWorkbenchNavigationScope,
  claimAgentWorkbenchGlobalOwner,
  isAgentWorkbenchOwnedRootRoute,
  isAgentWorkbenchOwnedOverlayPath,
  ownsAgentWorkbenchGlobalOwner,
  releaseAgentWorkbenchGlobalOwner,
} from '../agent-workbench-global-owner';

const scope = { serverId: 'server-a', sessionId: 'gateway-session' };

test('agent sheets keep the underlying workbench route owner', () => {
  expect(isAgentWorkbenchOwnedOverlayPath('/agent-model')).toBe(true);
  expect(isAgentWorkbenchOwnedOverlayPath('/agent-sessions')).toBe(true);
  expect(isAgentWorkbenchOwnedOverlayPath('/new-task')).toBe(false);
});

test('root navigation retains an owner through focus-before-pathname sheet handoff', () => {
  expect(
    agentWorkbenchNavigationScope({
      pathname: '/agent',
      rootRouteName: 'agent-workspace',
      routeFocused: false,
      visible: true,
    })
  ).toBe('owned-overlay');
});

test('root navigation releases a stale owner for unrelated destinations', () => {
  expect(
    agentWorkbenchNavigationScope({
      pathname: '/agent-workspace',
      rootRouteName: 'settings-theme',
      routeFocused: false,
      visible: true,
    })
  ).toBe('release');
});

test('explicitly hidden embedded workbench releases even while focused', () => {
  expect(
    agentWorkbenchNavigationScope({
      pathname: '/servers/demo',
      rootRouteName: 'servers/[serverId]',
      routeFocused: true,
      visible: false,
    })
  ).toBe('release');
});

test('explicitly hidden embedded workbench releases even over an agent sheet', () => {
  expect(
    agentWorkbenchNavigationScope({
      pathname: '/agent-workspace',
      rootRouteName: 'agent-workspace',
      routeFocused: false,
      visible: false,
    })
  ).toBe('release');
});

test('route-owned screen promotes the authoritative sheet route to visible', () => {
  expect(isAgentWorkbenchOwnedRootRoute('agent-workspace')).toBe(true);
  expect(isAgentWorkbenchOwnedRootRoute('settings-theme')).toBe(false);
});

test('a focused visible workbench claims the singleton bridge slot', () => {
  const first = claimAgentWorkbenchGlobalOwner(scope);
  expect(first).not.toBeNull();
  const current = claimAgentWorkbenchGlobalOwner(scope);
  expect(current).not.toBeNull();
  expect(ownsAgentWorkbenchGlobalOwner(first)).toBe(false);
  expect(ownsAgentWorkbenchGlobalOwner(current)).toBe(true);
  expect(releaseAgentWorkbenchGlobalOwner(current)).toBe(true);
});

test('a stale cleanup cannot release a newer owner', () => {
  const oldOwner = claimAgentWorkbenchGlobalOwner(scope);
  expect(oldOwner).not.toBeNull();
  const newOwner = claimAgentWorkbenchGlobalOwner(scope);
  expect(newOwner).not.toBeNull();
  expect(releaseAgentWorkbenchGlobalOwner(oldOwner)).toBe(false);
  expect(ownsAgentWorkbenchGlobalOwner(newOwner)).toBe(true);

  expect(releaseAgentWorkbenchGlobalOwner(newOwner)).toBe(true);
});

test('different routes still contend for the singleton visible bridge', () => {
  const first = claimAgentWorkbenchGlobalOwner(scope);
  expect(first).not.toBeNull();
  const second = claimAgentWorkbenchGlobalOwner({
    serverId: 'server-b',
    sessionId: 'other-session',
  });
  expect(second).not.toBeNull();
  expect(releaseAgentWorkbenchGlobalOwner(first)).toBe(false);
  expect(releaseAgentWorkbenchGlobalOwner(second)).toBe(true);
});

test('an owned sheet keeps B while stale A cleanup and a return to A race', () => {
  const a = claimAgentWorkbenchGlobalOwner({ serverId: 'server-a', sessionId: 'a' });
  const b = claimAgentWorkbenchGlobalOwner({ serverId: 'server-b', sessionId: 'b' });

  // Presenting a sheet does not claim a second token: B remains the bridge
  // owner while its route is underneath the sheet.
  expect(ownsAgentWorkbenchGlobalOwner(b)).toBe(true);
  expect(releaseAgentWorkbenchGlobalOwner(a)).toBe(false);
  expect(ownsAgentWorkbenchGlobalOwner(b)).toBe(true);

  const returningA = claimAgentWorkbenchGlobalOwner({ serverId: 'server-a', sessionId: 'a' });
  expect(ownsAgentWorkbenchGlobalOwner(returningA)).toBe(true);
  expect(releaseAgentWorkbenchGlobalOwner(b)).toBe(false);
  expect(releaseAgentWorkbenchGlobalOwner(returningA)).toBe(true);
});
