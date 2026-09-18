import * as bunTest from 'bun:test';

const { beforeEach, expect, mock, test } = bunTest;

type Call = { kind: string; sessionId?: string; paneId?: string };
let calls: Call[] = [];
let sessionList: { id: string; name?: string }[] = [];
let failOn: string | null = null;
/**
 * Which of the three gateways the fake is being this test.
 *
 *  * `announced` -- has the batched route and says so in `/health`, so its
 *    agents are the real agent list and one request is the whole entity load.
 *  * `unannounced` -- has the route but says nothing, so its agents are derived
 *    from panes and `/agents` is asked beside it.
 *  * `legacy` -- no batched route at all.
 */
let gateway: 'announced' | 'unannounced' | 'legacy' = 'announced';

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
      return health();
    },
    loadSessions: async () => {
      calls.push({ kind: 'sessions' });
      if (failOn === 'sessions') throw new Error('gateway is away');
      return { sessions: sessionList };
    },
    // The batched answer. `null` is how a gateway with no such route reports
    // itself; `agents: null` is how one that has the route but does not
    // announce it reports that its agents are derived and must not be used.
    loadSessionSnapshot: async (sessionId: string, given: { capabilities?: string[] } | null) => {
      calls.push({ kind: 'snapshot', sessionId });
      if (gateway === 'legacy') return null;
      const serves = Boolean(given?.capabilities?.includes('session_snapshot'));
      return {
        workspaces: [entity(`w:${sessionId}`)],
        tabs: [entity(`t:${sessionId}`, { workspace_id: `w:${sessionId}` })],
        panes: [entity(`p:${sessionId}`, { tab_id: `t:${sessionId}` })],
        agents: serves ? [entity(`a:${sessionId}`)] : null,
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

/** The `/health` the fake gateway answers with, per gateway kind. */
function health() {
  return gateway === 'announced'
    ? { ok: true, capabilities: ['session_snapshot'] }
    : { ok: true, capabilities: [] };
}

const { loadWorkspaceSnapshot, warmConfiguredWorkspace } = await import('@/lib/workspace-snapshot');
const { forgetWarmWorkspace, warmWorkspace } = await import('@/lib/server-warm-cache');

beforeEach(() => {
  calls = [];
  failOn = null;
  gateway = 'announced';
  sessionList = [{ id: 'alpha' }, { id: 'beta' }];
  forgetWarmWorkspace();
});

test('a preference that names a live session is honoured', async () => {
  const { snapshot } = await loadWorkspaceSnapshot('beta');
  expect(snapshot.sessionId).toBe('beta');
  // Every entity read is for the session that was resolved, never for the
  // preference as written -- on whichever gateway, since each asks a different
  // set and all of them have to get this right.
  for (const kind of ['announced', 'unannounced', 'legacy'] as const) {
    calls = [];
    gateway = kind;
    forgetWarmWorkspace();
    await loadWorkspaceSnapshot('beta');
    const entityReads = calls.filter((call) => call.kind !== 'health' && call.kind !== 'sessions');
    expect(entityReads.length).toBeGreaterThan(0);
    for (const call of entityReads) expect(call.sessionId).toBe('beta');
  }
});

test('a gateway announcing the capability answers the whole entity load at once', () => {
  return loadWorkspaceSnapshot('beta').then(({ snapshot }) => {
    // One request for all four lists. `/agents` is not asked at all, because
    // this gateway's batched agents are the agent list -- same array, same
    // backend call, `instance_id` and `target` included.
    expect(calls.map((call) => call.kind)).toEqual(['health', 'sessions', 'snapshot']);
    expect(snapshot.workspaces.map((item) => item.id)).toEqual(['w:beta']);
    expect(snapshot.tabs.map((item) => item.id)).toEqual(['t:beta']);
    expect(snapshot.panes.map((item) => item.id)).toEqual(['p:beta']);
    expect(snapshot.agents.map((item) => item.id)).toEqual(['a:beta']);
  });
});

test('a gateway with the route but no announcement still has its agents asked for', async () => {
  gateway = 'unannounced';
  const { snapshot } = await loadWorkspaceSnapshot('beta');
  // The batched answer is used for the shape and its agents are refused: they
  // are derived from panes there, so they carry no `instance_id` and no
  // `target`, and an assignment built from one would be dropped on the floor.
  expect(calls.map((call) => call.kind)).toEqual(['health', 'sessions', 'snapshot', 'agents']);
  expect(snapshot.panes.map((item) => item.id)).toEqual(['p:beta']);
  expect(snapshot.agents.map((item) => item.id)).toEqual(['a:beta']);
});

test('a gateway with no batched route at all still gets the separate reads', async () => {
  gateway = 'legacy';
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
  // And all three results are indistinguishable, which is the whole point: no
  // caller may branch on which gateway answered.
  expect(snapshot.workspaces.map((item) => item.id)).toEqual(['w:beta']);
  expect(snapshot.tabs.map((item) => item.id)).toEqual(['t:beta']);
  expect(snapshot.panes.map((item) => item.id)).toEqual(['p:beta']);
  expect(snapshot.agents.map((item) => item.id)).toEqual(['a:beta']);
});

test('the batched route is asked once, never twice, whichever gateway it is', async () => {
  // The announced path falls back when the announcement does not hold, and the
  // fallback must not re-ask the route that just refused it.
  for (const kind of ['announced', 'unannounced', 'legacy'] as const) {
    calls = [];
    gateway = kind;
    forgetWarmWorkspace();
    await loadWorkspaceSnapshot('beta');
    expect(calls.filter((call) => call.kind === 'snapshot')).toHaveLength(1);
  }
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
