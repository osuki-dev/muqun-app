import * as bunTest from 'bun:test';

const { beforeEach, expect, mock, test } = bunTest;

type Call = { kind: string; sessionId?: string; paneId?: string };
let calls: Call[] = [];
let sessionList: { id: string; name?: string }[] = [];
let failOn: string | null = null;
/** Whether the fake gateway has the batched `/snapshot` route. */
let batched = true;

/**
 * The shape `normalizeGatewayEntities` produces, `raw` included.
 *
 * It used to be `{ id, type, fields }` and that was enough while the loader only
 * carried these lists around. The warm path now runs `reconcileSelection` over
 * them to find the pane it should prefetch, and that reads `raw.focused` -- so a
 * fake without `raw` threw inside the prefetch, the warm was abandoned, and the
 * test saw nothing cached. Production entities always have it.
 */
function entity(id: string, fields: Record<string, string> = {}) {
  return { id, type: 'pane', fields, raw: { id, ...fields } };
}

// What the loader touches, plus the handful another suite's store reaches for.
// `mock.module` is process-wide: whichever fake registers first is the one every
// suite gets, so each has to carry the other's surface as well as its own.
mock.module('@/lib/gateway-client', () => ({
  // The warm path reads the landing pane's screen so the terminal paints on the
  // first frame. Recorded like every other call so a test can assert it was
  // made -- and so a failure here is the prefetch's, not the fake's.
  INITIAL_PANE_OUTPUT_LINES: 240,
  readPaneOutput: async (sessionId: string, paneId: string) => {
    calls.push({ kind: 'paneOutput', sessionId, paneId });
    if (failOn === 'paneOutput') throw new Error('gateway is away');
    return `screen of ${paneId}`;
  },
  configureGateway: () => {},
  setGatewayLabel: async () => {},
  revokeOwnGatewayPairing: async () => {},
  gatewayTransport: {
    loadHealth: async () => {
      calls.push({ kind: 'health' });
      if (failOn === 'health') throw new Error('gateway is away');
      return { ok: true };
    },
    loadSessions: async () => {
      calls.push({ kind: 'sessions' });
      if (failOn === 'sessions') throw new Error('gateway is away');
      return { sessions: sessionList };
    },
    // Workspaces, tabs and panes in one answer. `null` is how a gateway too old
    // to have the batched route reports itself, and the three calls below are
    // what happens then -- both paths are exercised by `batched` on/off.
    loadSessionSnapshot: async (sessionId: string) => {
      calls.push({ kind: 'snapshot', sessionId });
      if (!batched) return null;
      return {
        workspaces: [entity(`w:${sessionId}`)],
        tabs: [entity(`t:${sessionId}`, { workspace_id: `w:${sessionId}` })],
        panes: [entity(`p:${sessionId}`, { tab_id: `t:${sessionId}` })],
      };
    },
    loadWorkspaces: async (sessionId: string) => {
      calls.push({ kind: 'workspaces', sessionId });
      return [entity(`w:${sessionId}`)];
    },
    loadTabs: async (sessionId: string) => {
      calls.push({ kind: 'tabs', sessionId });
      return [entity(`t:${sessionId}`, { workspace_id: `w:${sessionId}` })];
    },
    loadPanes: async (sessionId: string) => {
      calls.push({ kind: 'panes', sessionId });
      return [entity(`p:${sessionId}`, { tab_id: `t:${sessionId}` })];
    },
    loadAgents: async (sessionId: string) => {
      calls.push({ kind: 'agents', sessionId });
      return [entity(`a:${sessionId}`)];
    },
  },
}));

const { loadWorkspaceSnapshot, warmConfiguredWorkspace } = await import('@/lib/workspace-snapshot');
const { forgetWarmWorkspace, warmWorkspace } = await import('@/lib/server-warm-cache');

beforeEach(() => {
  calls = [];
  failOn = null;
  batched = true;
  sessionList = [{ id: 'alpha' }, { id: 'beta' }];
  forgetWarmWorkspace();
});

test('a preference that names a live session is honoured', () => {
  return loadWorkspaceSnapshot('beta').then(({ snapshot }) => {
    expect(snapshot.sessionId).toBe('beta');
    // Every entity list is fetched for the session that was resolved, never for
    // the preference as written.
    for (const kind of ['snapshot', 'agents'])
      expect(calls.find((call) => call.kind === kind)?.sessionId).toBe('beta');
  });
});

test('a gateway with the batched route is asked twice, not four times', () => {
  return loadWorkspaceSnapshot('beta').then(({ snapshot }) => {
    // Workspaces, tabs and panes arrive together; agents stay their own call
    // because the batched answer derives them from panes and so carries no
    // `instance_id` or `target`. See `loadSessionSnapshot`.
    expect(calls.map((call) => call.kind)).toEqual(['health', 'sessions', 'snapshot', 'agents']);
    expect(snapshot.workspaces.map((item) => item.id)).toEqual(['w:beta']);
    expect(snapshot.tabs.map((item) => item.id)).toEqual(['t:beta']);
    expect(snapshot.panes.map((item) => item.id)).toEqual(['p:beta']);
    expect(snapshot.agents.map((item) => item.id)).toEqual(['a:beta']);
  });
});

test('a gateway without the batched route still gets the three separate reads', async () => {
  batched = false;
  const { snapshot } = await loadWorkspaceSnapshot('beta');
  expect(calls.map((call) => call.kind)).toEqual([
    'health',
    'sessions',
    'snapshot',
    'agents',
    'workspaces',
    'tabs',
    'panes',
  ]);
  // And the result is indistinguishable from the batched one, which is the
  // whole point: no caller may branch on which gateway answered.
  expect(snapshot.workspaces.map((item) => item.id)).toEqual(['w:beta']);
  expect(snapshot.tabs.map((item) => item.id)).toEqual(['t:beta']);
  expect(snapshot.panes.map((item) => item.id)).toEqual(['p:beta']);
});

test('a preference naming a session that has gone falls through to the first', async () => {
  const { snapshot } = await loadWorkspaceSnapshot('vanished');
  expect(snapshot.sessionId).toBe('alpha');
});

test('no preference at all lands on the first session', async () => {
  const { snapshot } = await loadWorkspaceSnapshot(undefined);
  expect(snapshot.sessionId).toBe('alpha');
});

test('health already in hand costs no second round trip', async () => {
  await loadWorkspaceSnapshot('alpha', { ok: true } as never);
  expect(calls.some((call) => call.kind === 'health')).toBe(false);
  expect(calls.some((call) => call.kind === 'sessions')).toBe(true);
});

test('the choices come back alongside the snapshot, in the gateway order', async () => {
  const { choices } = await loadWorkspaceSnapshot(undefined);
  expect(choices.map((choice) => choice.id)).toEqual(['alpha', 'beta']);
});

test('warming stores a snapshot the workspace can paint from', async () => {
  await warmConfiguredWorkspace('s1', 'beta');
  expect(warmWorkspace('s1')?.sessionId).toBe('beta');
});

test('the warmed screen records the one shape the prefetch reads it under', async () => {
  await warmConfiguredWorkspace('s1', 'beta');
  // Both halves of the contract the terminal screen checks on arrival: the pane
  // `reconcileSelection` chose, and the shape that window is a window *of*. The
  // screen builds the same string from the pane entity and declines the seed
  // when it differs -- a pane that has since handed its tty to an editor is
  // read another way -- so a change to either side has to be a change to both.
  expect(warmWorkspace('s1')?.firstPane).toEqual({
    paneId: 'p:beta',
    output: 'screen of p:beta',
    shape: 'ansi:recent-unwrapped:main',
  });
});

test('warming a server that is already warm asks the gateway nothing', async () => {
  await warmConfiguredWorkspace('s1', 'beta');
  calls = [];
  await warmConfiguredWorkspace('s1', 'beta');
  expect(calls).toEqual([]);
});

test('a gateway that is away leaves no snapshot and raises nothing', async () => {
  failOn = 'sessions';
  await warmConfiguredWorkspace('s1', 'beta');
  expect(warmWorkspace('s1')).toBeNull();
});

test('a server with no id is never warmed', async () => {
  await warmConfiguredWorkspace('', 'beta');
  expect(calls).toEqual([]);
});
