import { expect, test } from 'bun:test';
import {
  createHomeCommandController,
  embeddedResumeRoute,
  type HomeCommandPorts,
  type HomeNavigation,
} from '../home-commands';

function harness() {
  let selected = 'a';
  let active = true;
  const navigations: HomeNavigation[] = [];
  const ports: HomeCommandPorts = {
    hasServer: () => true,
    selectServerNow: (id) => {
      selected = id;
      return true;
    },
    selectServer: async (id) => {
      selected = id;
      return true;
    },
    selectedServerId: () => selected,
    sourceRouteActive: () => active,
    loadTerminalSelection: async () => null,
    navigate: (destination) => navigations.push(destination),
  };
  return {
    ports,
    navigations,
    blur: () => {
      active = false;
    },
  };
}

test('an inactive Home operation cannot block the same action from a new owner', async () => {
  const old = harness();
  let release!: () => void;
  old.ports.loadTerminalSelection = () =>
    new Promise((resolve) => {
      release = () => resolve(null);
    });
  const first = createHomeCommandController(old.ports);
  const pending = first.dispatch({ type: 'new-terminal', serverId: 'a' });
  await Promise.resolve();
  old.blur();
  const next = harness();
  const second = createHomeCommandController(next.ports);
  const result = await second.dispatch({ type: 'new-terminal', serverId: 'a' });
  release();
  expect((await pending).status).toBe('superseded');
  expect(result.status).toBe('unavailable');
  first.dispose();
  second.dispose();
});

test('a late terminal lookup cannot navigate after a different computer session opens', async () => {
  const state = harness();
  let release!: () => void;
  state.ports.loadTerminalSelection = () =>
    new Promise((resolve) => {
      release = () =>
        resolve({ sessionId: 'same', choices: [{ id: 'same', label: 'terminal', kind: 'tmux' }] });
    });
  const controller = createHomeCommandController(state.ports);
  const pending = controller.dispatch({ type: 'new-terminal', serverId: 'a' });
  await Promise.resolve();
  await controller.dispatch({
    type: 'open-agent',
    target: { kind: 'agent-session', serverId: 'b', asid: 'same' },
  });
  release();
  expect((await pending).status).toBe('superseded');
  expect(state.navigations).toEqual([
    {
      type: 'agent',
      intent: 'existing',
      target: { kind: 'agent-session', serverId: 'b', asid: 'same' },
    },
  ]);
  controller.dispose();
});

test('route-bound workspaces compare their owner, not the newly selected gateway', () => {
  expect(
    embeddedResumeRoute({ routeBound: true, workspaceServerId: 'a', targetServerId: 'b' })
  ).toBe('route');
  expect(
    embeddedResumeRoute({ routeBound: true, workspaceServerId: 'a', targetServerId: 'a' })
  ).toBe('handoff');
});

test('leaving Home releases its pending action and stale completion cannot block a revisit', async () => {
  const state = harness();
  let release!: () => void;
  state.ports.loadTerminalSelection = () =>
    new Promise((resolve) => {
      release = () => resolve(null);
    });
  const controller = createHomeCommandController(state.ports);
  const pending = controller.dispatch({ type: 'new-terminal', serverId: 'a' });
  await Promise.resolve();
  controller.cancel();
  state.ports.loadTerminalSelection = async () => null;
  expect((await controller.dispatch({ type: 'new-terminal', serverId: 'a' })).status).toBe(
    'unavailable'
  );
  release();
  expect((await pending).status).toBe('superseded');
  controller.dispose();
});

test('disposing an older owner does not cancel another layouts newer navigation', async () => {
  const old = createHomeCommandController(harness().ports);
  const next = harness();
  let release!: () => void;
  next.ports.loadTerminalSelection = () =>
    new Promise((resolve) => {
      release = () =>
        resolve({ sessionId: 'same', choices: [{ id: 'same', label: 'terminal', kind: 'tmux' }] });
    });
  const controller = createHomeCommandController(next.ports);
  const pending = controller.dispatch({ type: 'new-terminal', serverId: 'b' });
  await Promise.resolve();
  old.cancel();
  old.dispose();
  release();
  expect((await pending).status).toBe('dispatched');
  expect(next.navigations[0]).toMatchObject({ type: 'panels', serverId: 'b' });
  controller.dispose();
});

test('settings and pairing keep one navigation claim until Home leaves', async () => {
  for (const type of ['manage-connections', 'pair-gateway'] as const) {
    const state = harness();
    const controller = createHomeCommandController(state.ports);
    expect((await controller.dispatch({ type })).status).toBe('dispatched');
    expect((await controller.dispatch({ type })).status).toBe('duplicate');
    expect(state.navigations).toHaveLength(1);
    state.blur();
    expect((await controller.dispatch({ type })).status).toBe('superseded');
    expect(state.navigations).toHaveLength(1);
    controller.cancel();
    controller.dispose();
    const returned = harness();
    const next = createHomeCommandController(returned.ports);
    expect((await next.dispatch({ type })).status).toBe('dispatched');
    expect(returned.navigations).toHaveLength(1);
    next.dispose();
  }
});
