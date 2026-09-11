import * as bunTest from 'bun:test';

const { beforeEach, expect, mock, test } = bunTest;

type Call = { kind: string; sessionId?: string };
let calls: Call[] = [];
let sessionList: { id: string; name?: string }[] = [];
let failOn: string | null = null;

function entity(id: string) {
  return { id, type: 'pane', fields: {} };
}

// What the loader touches, plus the handful another suite's store reaches for.
// `mock.module` is process-wide: whichever fake registers first is the one every
// suite gets, so each has to carry the other's surface as well as its own.
mock.module('@/lib/gateway-client', () => ({
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
    loadWorkspaces: async (sessionId: string) => {
      calls.push({ kind: 'workspaces', sessionId });
      return [entity(`w:${sessionId}`)];
    },
    loadTabs: async (sessionId: string) => {
      calls.push({ kind: 'tabs', sessionId });
      return [entity(`t:${sessionId}`)];
    },
    loadPanes: async (sessionId: string) => {
      calls.push({ kind: 'panes', sessionId });
      return [entity(`p:${sessionId}`)];
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
  sessionList = [{ id: 'alpha' }, { id: 'beta' }];
  forgetWarmWorkspace();
});

test('a preference that names a live session is honoured', () => {
  return loadWorkspaceSnapshot('beta').then(({ snapshot }) => {
    expect(snapshot.sessionId).toBe('beta');
    // Every entity list is fetched for the session that was resolved, never for
    // the preference as written.
    for (const kind of ['workspaces', 'tabs', 'panes', 'agents'])
      expect(calls.find((call) => call.kind === kind)?.sessionId).toBe('beta');
  });
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
