import { describe, expect, test } from 'bun:test';

import {
  claimHomeWorkspaceHost,
  homeWorkspaceHostStore,
  homeWorkspaceRouteMode,
  reconcileHomeWorkspaceOwner,
  releaseHomeWorkspaceHost,
} from '@/lib/home-workspace-owner';

describe('home workspace owner lifetime', () => {
  test('keeps compact startup on the server list', () => {
    expect(
      reconcileHomeWorkspaceOwner(null, {
        mode: 'compact',
        loading: false,
        serverId: 'server-a',
      })
    ).toBeNull();
  });

  test('activates the existing task workspace for a ready Pad record', () => {
    expect(
      reconcileHomeWorkspaceOwner(null, {
        mode: 'pad',
        loading: false,
        serverId: 'server-a',
      })
    ).toBe('server-a');
  });

  test('does not activate while the initial record is still loading', () => {
    expect(
      reconcileHomeWorkspaceOwner(null, {
        mode: 'pad',
        loading: true,
        serverId: 'server-a',
      })
    ).toBeNull();
  });

  test('does not acquire a first owner while the root route is blurred', () => {
    expect(
      reconcileHomeWorkspaceOwner(null, {
        mode: 'pad',
        loading: false,
        serverId: 'server-a',
        allowInitialActivation: false,
      })
    ).toBeNull();
  });

  test('retains an activated owner when Pad narrows to compact', () => {
    expect(
      reconcileHomeWorkspaceOwner('server-a', {
        mode: 'compact',
        loading: false,
        serverId: 'server-a',
      })
    ).toBe('server-a');
  });

  test('retains an activated owner through transient empty loading', () => {
    expect(
      reconcileHomeWorkspaceOwner('server-a', {
        mode: 'compact',
        loading: true,
        serverId: null,
      })
    ).toBe('server-a');
  });

  test('retains an existing owner while the root route is blurred', () => {
    expect(
      reconcileHomeWorkspaceOwner('server-a', {
        mode: 'pad',
        loading: false,
        serverId: 'server-a',
        allowInitialActivation: false,
      })
    ).toBe('server-a');
  });

  test('clears the owner after an authoritative empty result', () => {
    expect(
      reconcileHomeWorkspaceOwner('server-a', {
        mode: 'compact',
        loading: false,
        serverId: null,
      })
    ).toBeNull();
  });

  test('uses a changed server as the intentional identity boundary', () => {
    expect(
      reconcileHomeWorkspaceOwner('server-a', {
        mode: 'compact',
        loading: true,
        serverId: 'server-b',
      })
    ).toBe('server-b');
  });

  test('normalizes an empty server id as missing', () => {
    expect(
      reconcileHomeWorkspaceOwner('server-a', {
        mode: 'pad',
        loading: false,
        serverId: '',
      })
    ).toBeNull();
  });

  test('a stale root host release cannot clear a newer server host', () => {
    const first = claimHomeWorkspaceHost('server-a');
    const second = claimHomeWorkspaceHost('server-b');

    releaseHomeWorkspaceHost(first);
    expect(homeWorkspaceHostStore.getState().serverId).toBe('server-b');

    releaseHomeWorkspaceHost(second);
    expect(homeWorkspaceHostStore.getState().serverId).toBeNull();
  });

  test('a deep link owns its workspace when no root host exists', () => {
    expect(homeWorkspaceRouteMode(null)).toBe('route-owner');
    expect(homeWorkspaceRouteMode('server-a')).toBe('root-handoff');
  });
});
