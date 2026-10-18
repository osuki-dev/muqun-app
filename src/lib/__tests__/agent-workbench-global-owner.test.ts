import { describe, expect, test } from 'bun:test';

import {
  agentWorkbenchNavigationScope,
  claimAgentWorkbenchGlobalOwner,
  ownsAgentWorkbenchGlobalOwner,
  releaseAgentWorkbenchGlobalOwner,
} from '@/lib/agent-workbench-global-owner';

describe('workbench navigation ownership', () => {
  test('blur before rendered root/path updates retains the existing Context owner', () => {
    const owner = claimAgentWorkbenchGlobalOwner({ serverId: 'server', sessionId: 'session' });
    const scope = agentWorkbenchNavigationScope({
      pathname: '/agent',
      rootRouteName: 'agent',
      routeFocused: false,
      visible: true,
      currentRootRouteName: 'agent-context',
      currentRouteFocused: false,
    });
    expect(scope).toBe('owned-overlay');
    expect(ownsAgentWorkbenchGlobalOwner(owner)).toBe(true);
    expect(
      agentWorkbenchNavigationScope({
        pathname: '/agent-context',
        rootRouteName: 'agent-context',
        routeFocused: true,
        visible: true,
        currentRootRouteName: 'agent',
        currentRouteFocused: true,
      })
    ).toBe('focused');
    releaseAgentWorkbenchGlobalOwner(owner);
  });

  test('a current Settings route releases despite stale overlay and focus snapshots', () => {
    expect(
      agentWorkbenchNavigationScope({
        pathname: '/agent-context',
        rootRouteName: 'agent-context',
        routeFocused: true,
        visible: true,
        currentRootRouteName: 'settings',
        currentRouteFocused: false,
      })
    ).toBe('release');
  });

  test('an explicit embedded hide wins even under an owned sheet', () => {
    expect(
      agentWorkbenchNavigationScope({
        pathname: '/agent-context',
        rootRouteName: 'agent-context',
        routeFocused: true,
        visible: false,
        currentRootRouteName: 'agent-context',
        currentRouteFocused: false,
      })
    ).toBe('release');
  });

  test('overlay state cannot grant focus or let an older owner release its successor', () => {
    const old = claimAgentWorkbenchGlobalOwner({ serverId: 'old', sessionId: 'old' });
    const current = claimAgentWorkbenchGlobalOwner({ serverId: 'new', sessionId: 'new' });
    expect(
      agentWorkbenchNavigationScope({
        pathname: '/agent',
        rootRouteName: 'agent-context',
        routeFocused: true,
        visible: true,
      })
    ).toBe('owned-overlay');
    expect(ownsAgentWorkbenchGlobalOwner(old)).toBe(false);
    expect(releaseAgentWorkbenchGlobalOwner(old)).toBe(false);
    expect(ownsAgentWorkbenchGlobalOwner(current)).toBe(true);
    releaseAgentWorkbenchGlobalOwner(current);
  });
});
