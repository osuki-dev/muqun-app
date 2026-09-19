import { describe, expect, test } from 'bun:test';

import {
  consumeNewOpenCodeIntent,
  createHomeCommandController,
  isHomeSshTargetAvailable,
  type HomeCommandPorts,
  type HomeNavigation,
} from '../home-commands';
import { homeWorkspaceHandoffStore } from '../home-workspace-handoff';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function ports(overrides: Partial<HomeCommandPorts> = {}) {
  const navigations: HomeNavigation[] = [];
  let selectedServerId: string | null = null;
  const base: HomeCommandPorts = {
    hasServer: (serverId) => serverId === 'server-a' || serverId === 'server-b',
    selectServerNow: (serverId) => {
      selectedServerId = serverId;
      return true;
    },
    selectServer: async (serverId) => {
      selectedServerId = serverId;
      return true;
    },
    selectedServerId: () => selectedServerId,
    loadTerminalSelection: async (serverId) => ({
      sessionId: `${serverId}-session`,
      choices: [{ id: `${serverId}-session`, label: 'Main', kind: 'shell' }],
    }),
    navigate: (destination) => navigations.push(destination),
  };
  return {
    ...base,
    ...overrides,
    navigations,
    setSelected: (id: string) => (selectedServerId = id),
  };
}

describe('home command boundary', () => {
  test('a stale request failure does not surface over the newer destination', async () => {
    const load = deferred<Awaited<ReturnType<HomeCommandPorts['loadTerminalSelection']>>>();
    const adapter = ports({ loadTerminalSelection: () => load.promise });
    const controller = createHomeCommandController(adapter);
    const first = controller.dispatch({ type: 'new-terminal', serverId: 'server-a' });
    await Promise.resolve();
    expect((await controller.dispatch({ type: 'manage-connections' })).status).toBe('dispatched');
    load.reject(new Error('old server disconnected'));

    expect((await first).status).toBe('superseded');
    expect(adapter.navigations).toEqual([{ type: 'manage' }]);
  });

  test('routes a canonical resume target with every scoped identity intact', async () => {
    const adapter = ports();
    const controller = createHomeCommandController(adapter);
    const target = {
      kind: 'opencode-session' as const,
      serverId: 'server-a',
      sessionId: 'routing-a',
      directory: '/work/app',
      asid: 'agent-a',
    };

    const result = await controller.dispatch({ type: 'resume-target', target });

    expect(result.status).toBe('dispatched');
    expect(adapter.navigations).toEqual([{ type: 'opencode', target, intent: 'existing' }]);
  });

  test('rejects a canonical target after validation says its pane disappeared', async () => {
    const adapter = ports({ validateTarget: async () => false });
    const controller = createHomeCommandController(adapter);
    const target = {
      kind: 'gateway-terminal' as const,
      serverId: 'server-a',
      sessionId: 'routing-a',
      paneId: 'pane-gone',
    };

    const result = await controller.dispatch({ type: 'resume-target', target });

    expect(result.status).toBe('missing-target');
    expect(adapter.navigations).toEqual([]);
  });

  test('keeps a validated terminal handoff alive when selection unmounts its owner', async () => {
    let disposeOwner = () => {};
    const adapter = ports({
      validateTarget: async () => true,
      resumeServer: (target) => {
        homeWorkspaceHandoffStore.getState().publish(target);
      },
    });
    const selectServerNow = adapter.selectServerNow;
    adapter.selectServerNow = (serverId) => {
      const selected = selectServerNow(serverId);
      disposeOwner();
      return selected;
    };
    const controller = createHomeCommandController(adapter);
    disposeOwner = controller.dispose;
    const target = {
      kind: 'gateway-terminal' as const,
      serverId: 'server-b',
      sessionId: 'routing-b',
      paneId: 'pane-b',
    };

    const result = await controller.dispatch({ type: 'resume-target', target });

    expect(result.status).toBe('dispatched');
    const handoff = homeWorkspaceHandoffStore.getState().handoff;
    expect(handoff?.target).toEqual(target);
    expect(homeWorkspaceHandoffStore.getState().consume(handoff?.id ?? -1)?.target).toEqual(target);
    expect(homeWorkspaceHandoffStore.getState().handoff).toBeNull();
  });

  test('plain cross-server cards select before publishing a handoff', async () => {
    let disposeOwner = () => {};
    const adapter = ports();
    const selectServerNow = adapter.selectServerNow;
    adapter.selectServerNow = (serverId) => {
      const selected = selectServerNow(serverId);
      disposeOwner();
      return selected;
    };
    adapter.resumeServer = async (target, isCurrent) => {
      if (!adapter.selectServerNow(target.serverId)) return;
      homeWorkspaceHandoffStore.getState().publish(target, isCurrent);
    };
    const controller = createHomeCommandController(adapter);
    disposeOwner = controller.dispose;
    const target = { kind: 'gateway-terminal' as const, serverId: 'server-b', paneId: 'pane-b' };

    const result = await controller.dispatch({ type: 'resume-server', target });

    expect(result.status).toBe('dispatched');
    expect(homeWorkspaceHandoffStore.getState().handoff?.target).toEqual(target);
    homeWorkspaceHandoffStore.getState().clear();
  });

  test('a newer Home command invalidates a late plain-card handoff', async () => {
    const selection = deferred<boolean>();
    const adapter = ports();
    adapter.resumeServer = async (target, isCurrent) => {
      await selection.promise;
      if (isCurrent()) homeWorkspaceHandoffStore.getState().publish(target, isCurrent);
    };
    const controller = createHomeCommandController(adapter);
    const stale = controller.dispatch({
      type: 'resume-server',
      target: { kind: 'gateway-terminal', serverId: 'server-b', paneId: 'pane-b' },
    });
    await Promise.resolve();
    expect((await controller.dispatch({ type: 'manage-connections' })).status).toBe('dispatched');
    selection.resolve(true);

    expect((await stale).status).toBe('superseded');
    expect(homeWorkspaceHandoffStore.getState().handoff).toBeNull();
  });

  test('coalesces duplicate new-terminal taps while the explicit picker data loads', async () => {
    const load = deferred<Awaited<ReturnType<HomeCommandPorts['loadTerminalSelection']>>>();
    const adapter = ports({ loadTerminalSelection: () => load.promise });
    const controller = createHomeCommandController(adapter);

    const first = controller.dispatch({ type: 'new-terminal', serverId: 'server-a' });
    const duplicate = await controller.dispatch({ type: 'new-terminal', serverId: 'server-a' });
    expect(duplicate.status).toBe('duplicate');

    load.resolve({
      sessionId: 'routing-a',
      choices: [{ id: 'routing-a', label: 'Main', kind: 'shell' }],
    });
    expect((await first).status).toBe('dispatched');
    expect(adapter.navigations).toHaveLength(1);
    expect(adapter.navigations[0]).toMatchObject({ type: 'panels', intent: 'new-terminal' });
  });

  test('late selection cannot navigate over a newer user action', async () => {
    const selection = deferred<boolean>();
    const adapter = ports({
      selectServerNow: () => false,
      selectServer: () => selection.promise,
    });
    const controller = createHomeCommandController(adapter);

    const stale = controller.dispatch({
      type: 'open-opencode',
      target: { kind: 'opencode-session', serverId: 'server-a' },
    });
    const newer = await controller.dispatch({ type: 'open-ssh', hostId: 'host-a' });
    expect(newer.status).toBe('dispatched');
    selection.resolve(true);

    expect((await stale).status).toBe('superseded');
    expect(adapter.navigations).toEqual([{ type: 'ssh', hostId: 'host-a' }]);
  });

  test('allows the synthetic demo SSH target only while demo mode is active', async () => {
    expect(isHomeSshTargetAvailable('demo-ssh', [], true)).toBe(true);
    expect(isHomeSshTargetAvailable('demo-ssh', [], false)).toBe(false);
    expect(isHomeSshTargetAvailable('saved-host', ['saved-host'], false)).toBe(true);

    const staleAdapter = ports({
      validateTarget: async (target) =>
        target.kind === 'ssh-host' && isHomeSshTargetAvailable(target.hostId, [], false),
    });
    const staleController = createHomeCommandController(staleAdapter);
    const stale = await staleController.dispatch({
      type: 'resume-target',
      target: { kind: 'ssh-host', hostId: 'demo-ssh' },
    });

    expect(stale.status).toBe('missing-target');
    expect(staleAdapter.navigations).toEqual([]);
    const staleOpen = await staleController.dispatch({
      type: 'open-ssh',
      hostId: 'demo-ssh',
    });
    expect(staleOpen.status).toBe('missing-target');
    expect(staleAdapter.navigations).toEqual([]);

    const demoAdapter = ports({
      validateTarget: async (target) =>
        target.kind === 'ssh-host' && isHomeSshTargetAvailable(target.hostId, [], true),
    });
    const demoController = createHomeCommandController(demoAdapter);
    const active = await demoController.dispatch({
      type: 'resume-target',
      target: { kind: 'ssh-host', hostId: 'demo-ssh' },
    });

    expect(active.status).toBe('dispatched');
    expect(demoAdapter.navigations).toEqual([{ type: 'ssh', hostId: 'demo-ssh' }]);
    const activeOpen = await demoController.dispatch({
      type: 'open-ssh',
      hostId: 'demo-ssh',
    });
    expect(activeOpen.status).toBe('dispatched');
    expect(demoAdapter.navigations).toEqual([
      { type: 'ssh', hostId: 'demo-ssh' },
      { type: 'ssh', hostId: 'demo-ssh' },
    ]);
  });

  test('keeps an existing OpenCode route alive when server selection unmounts Home', async () => {
    let disposeOwner = () => {};
    const adapter = ports();
    const selectServerNow = adapter.selectServerNow;
    adapter.selectServerNow = (serverId) => {
      const selected = selectServerNow(serverId);
      disposeOwner();
      return selected;
    };
    const controller = createHomeCommandController(adapter);
    disposeOwner = controller.dispose;

    const result = await controller.dispatch({
      type: 'open-opencode',
      target: { kind: 'opencode-session', serverId: 'server-b' },
    });

    expect(result.status).toBe('dispatched');
    expect(adapter.navigations).toEqual([
      {
        type: 'opencode',
        target: { kind: 'opencode-session', serverId: 'server-b' },
        intent: 'existing',
      },
    ]);
  });

  test('keeps a new OpenCode draft alive when server selection unmounts Home', async () => {
    let disposeOwner = () => {};
    const adapter = ports({
      prepareNewOpenCode: async () => ({ status: 'ready', capabilities: ['agent_sessions'] }),
    });
    const selectServerNow = adapter.selectServerNow;
    adapter.selectServerNow = (serverId) => {
      const selected = selectServerNow(serverId);
      disposeOwner();
      return selected;
    };
    const controller = createHomeCommandController(adapter);
    disposeOwner = controller.dispose;

    const result = await controller.dispatch({
      type: 'new-opencode',
      serverId: 'server-b',
      directory: '/work/app',
    });

    expect(result.status).toBe('dispatched');
    expect(adapter.navigations).toEqual([
      {
        type: 'opencode',
        target: {
          kind: 'opencode-session',
          serverId: 'server-b',
          directory: '/work/app',
        },
        intent: 'new',
      },
    ]);
    consumeNewOpenCodeIntent('server-b', '/work/app');
  });

  test('keeps the new terminal picker alive when server selection unmounts Home', async () => {
    let disposeOwner = () => {};
    const adapter = ports();
    const selectServerNow = adapter.selectServerNow;
    adapter.selectServerNow = (serverId) => {
      const selected = selectServerNow(serverId);
      disposeOwner();
      return selected;
    };
    const controller = createHomeCommandController(adapter);
    disposeOwner = controller.dispose;

    const result = await controller.dispatch({ type: 'new-terminal', serverId: 'server-b' });

    expect(result.status).toBe('dispatched');
    expect(adapter.navigations).toEqual([
      {
        type: 'panels',
        serverId: 'server-b',
        intent: 'new-terminal',
        selection: {
          sessionId: 'server-b-session',
          choices: [{ id: 'server-b-session', label: 'Main', kind: 'shell' }],
        },
      },
    ]);
  });

  test('cancels a new OpenCode route when the source Home route leaves', async () => {
    const selection = deferred<boolean>();
    let sourceActive = true;
    const adapter = ports({
      sourceRouteActive: () => sourceActive,
      selectServerNow: () => false,
      selectServer: () => selection.promise,
    });
    const controller = createHomeCommandController(adapter);
    const pending = controller.dispatch({ type: 'new-opencode', serverId: 'server-b' });
    sourceActive = false;
    selection.resolve(true);

    expect((await pending).status).toBe('superseded');
    expect(adapter.navigations).toEqual([]);
  });

  test('cancels a new terminal picker when the source Home route leaves', async () => {
    const selection = deferred<boolean>();
    let sourceActive = true;
    const adapter = ports({
      sourceRouteActive: () => sourceActive,
      selectServerNow: () => false,
      selectServer: () => selection.promise,
    });
    const controller = createHomeCommandController(adapter);
    const pending = controller.dispatch({ type: 'new-terminal', serverId: 'server-b' });
    sourceActive = false;
    selection.resolve(true);

    expect((await pending).status).toBe('superseded');
    expect(adapter.navigations).toEqual([]);
  });

  test('a route-bound resume that loses focus before navigation is superseded', async () => {
    let sourceActive = true;
    const adapter = ports({ sourceRouteActive: () => sourceActive });
    adapter.resumeServer = async (_target, isCurrent) => {
      sourceActive = false;
      return isCurrent() ? true : false;
    };
    const controller = createHomeCommandController(adapter);

    const result = await controller.dispatch({
      type: 'resume-server',
      target: { kind: 'gateway-terminal', serverId: 'server-b', paneId: 'pane-b' },
    });

    expect(result.status).toBe('superseded');
    expect(adapter.navigations).toEqual([]);
  });

  test('a route-bound recent target reports focus loss instead of dispatched', async () => {
    let sourceActive = true;
    const target = {
      kind: 'gateway-terminal' as const,
      serverId: 'server-b',
      sessionId: 'routing-b',
      paneId: 'pane-b',
    };
    const adapter = ports({
      sourceRouteActive: () => sourceActive,
      validateTarget: async () => true,
      resumeServer: async (_target, isCurrent) => {
        sourceActive = false;
        return isCurrent();
      },
    });
    const controller = createHomeCommandController(adapter);

    const result = await controller.dispatch({ type: 'resume-target', target });

    expect(result.status).toBe('superseded');
    expect(adapter.navigations).toEqual([]);
  });

  test('releases a route-left operation so an identical later command can run', async () => {
    const selection = deferred<boolean>();
    let sourceActive = true;
    const adapter = ports({
      sourceRouteActive: () => sourceActive,
      selectServerNow: () => false,
      selectServer: () => selection.promise,
    });
    const controller = createHomeCommandController(adapter);
    const pending = controller.dispatch({ type: 'new-opencode', serverId: 'server-b' });
    sourceActive = false;
    selection.resolve(true);

    expect((await pending).status).toBe('superseded');
    sourceActive = true;
    adapter.selectServerNow = (serverId) => {
      adapter.setSelected(serverId);
      return true;
    };
    const retry = await controller.dispatch({ type: 'new-opencode', serverId: 'server-b' });

    expect(retry.status).toBe('dispatched');
    consumeNewOpenCodeIntent('server-b');
  });

  test('keeps a committed route dispatched when navigation changes focus', async () => {
    let sourceActive = true;
    const adapter = ports({
      sourceRouteActive: () => sourceActive,
      navigate: (destination) => {
        adapter.navigations.push(destination);
        sourceActive = false;
      },
    });
    const controller = createHomeCommandController(adapter);

    const result = await controller.dispatch({
      type: 'open-opencode',
      target: { kind: 'opencode-session', serverId: 'server-a' },
    });

    expect(result.status).toBe('dispatched');
    expect(adapter.navigations).toHaveLength(1);
  });

  test('a stale operation releases its own slot without clearing a newer owner', async () => {
    const selection = deferred<boolean>();
    const staleAdapter = ports({
      selectServerNow: () => false,
      selectServer: () => selection.promise,
    });
    const load = deferred<Awaited<ReturnType<HomeCommandPorts['loadTerminalSelection']>>>();
    const liveAdapter = ports({ loadTerminalSelection: () => load.promise });
    const staleController = createHomeCommandController(staleAdapter);
    const liveController = createHomeCommandController(liveAdapter);

    const stale = staleController.dispatch({
      type: 'open-opencode',
      target: { kind: 'opencode-session', serverId: 'server-a' },
    });
    const live = liveController.dispatch({ type: 'new-terminal', serverId: 'server-a' });
    selection.resolve(true);

    expect((await stale).status).toBe('superseded');
    expect(
      (await liveController.dispatch({ type: 'new-terminal', serverId: 'server-a' })).status
    ).toBe('duplicate');
    load.resolve({
      sessionId: 'routing-a',
      choices: [{ id: 'routing-a', label: 'Main', kind: 'shell' }],
    });
    expect((await live).status).toBe('dispatched');
  });

  test('a synchronous selection still loses to an outside selection before navigation', async () => {
    const adapter = ports();
    const controller = createHomeCommandController(adapter);

    const pending = controller.dispatch({
      type: 'open-opencode',
      target: { kind: 'opencode-session', serverId: 'server-a' },
    });
    adapter.setSelected('server-b');

    expect((await pending).status).toBe('superseded');
    expect(adapter.navigations).toEqual([]);

    const retry = await controller.dispatch({
      type: 'open-opencode',
      target: { kind: 'opencode-session', serverId: 'server-a' },
    });
    expect(retry.status).toBe('dispatched');
    expect(adapter.navigations).toHaveLength(1);
  });

  test('selection changed outside the controller cancels a pending terminal route', async () => {
    const load = deferred<Awaited<ReturnType<HomeCommandPorts['loadTerminalSelection']>>>();
    const adapter = ports({ loadTerminalSelection: () => load.promise });
    const controller = createHomeCommandController(adapter);

    const pending = controller.dispatch({ type: 'new-terminal', serverId: 'server-a' });
    adapter.setSelected('server-b');
    load.resolve({
      sessionId: 'routing-a',
      choices: [{ id: 'routing-a', label: 'Main', kind: 'shell' }],
    });

    expect((await pending).status).toBe('superseded');
    expect(adapter.navigations).toEqual([]);
  });

  test('missing servers never invoke selection or navigation', async () => {
    let selections = 0;
    const adapter = ports({
      hasServer: () => false,
      selectServerNow: () => {
        selections++;
        return true;
      },
    });
    const controller = createHomeCommandController(adapter);

    const result = await controller.dispatch({ type: 'new-opencode', serverId: 'gone' });

    expect(result.status).toBe('missing-target');
    expect(selections).toBe(0);
    expect(adapter.navigations).toEqual([]);
  });

  test('new OpenCode asks the shared readiness adapter before navigation', async () => {
    const adapter = ports({
      prepareNewOpenCode: async () => ({ status: 'offline', capabilities: [], cause: 'health' }),
    });
    const controller = createHomeCommandController(adapter);

    const result = await controller.dispatch({ type: 'new-opencode', serverId: 'server-a' });

    expect(result.status).toBe('setup-required');
    expect(adapter.navigations).toEqual([]);
  });

  test('new OpenCode preserves the new intent after readiness succeeds', async () => {
    const adapter = ports({
      prepareNewOpenCode: async () => ({ status: 'ready', capabilities: ['agent_sessions'] }),
    });
    const controller = createHomeCommandController(adapter);

    const result = await controller.dispatch({
      type: 'new-opencode',
      serverId: 'server-a',
      directory: '/work/app',
    });

    expect(result.status).toBe('dispatched');
    expect(adapter.navigations).toEqual([
      {
        type: 'opencode',
        target: { kind: 'opencode-session', serverId: 'server-a', directory: '/work/app' },
        intent: 'new',
      },
    ]);
    consumeNewOpenCodeIntent('server-a', '/work/app');
  });

  test('late readiness cannot navigate over a newer Home action', async () => {
    const readiness =
      deferred<Awaited<ReturnType<NonNullable<HomeCommandPorts['prepareNewOpenCode']>>>>();
    const adapter = ports({ prepareNewOpenCode: () => readiness.promise });
    const controller = createHomeCommandController(adapter);
    const pending = controller.dispatch({ type: 'new-opencode', serverId: 'server-a' });
    await Promise.resolve();

    expect((await controller.dispatch({ type: 'manage-connections' })).status).toBe('dispatched');
    readiness.resolve({ status: 'ready', capabilities: ['agent_sessions'] });

    expect((await pending).status).toBe('superseded');
    expect(adapter.navigations).toEqual([{ type: 'manage' }]);
  });

  test('dedupes new-session route intents until the destination consumes them', async () => {
    const adapter = ports();
    const firstController = createHomeCommandController(adapter);
    const secondController = createHomeCommandController(adapter);
    const first = await firstController.dispatch({
      type: 'new-opencode',
      serverId: 'server-a',
      directory: '/work/app',
    });
    const second = await secondController.dispatch({
      type: 'new-opencode',
      serverId: 'server-a',
      directory: '/work/app',
    });

    expect(first.status).toBe('dispatched');
    expect(second.status).toBe('duplicate');
    expect(adapter.navigations).toHaveLength(1);
    expect(adapter.navigations[0]).toMatchObject({
      type: 'opencode',
      intent: 'new',
      target: { serverId: 'server-a', kind: 'opencode-session' },
    });
    consumeNewOpenCodeIntent('server-a', '/work/app');

    const retry = await firstController.dispatch({
      type: 'new-opencode',
      serverId: 'server-a',
      directory: '/work/app',
    });
    expect(retry.status).toBe('dispatched');
  });
});
