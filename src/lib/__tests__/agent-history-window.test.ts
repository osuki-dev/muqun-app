import { expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { declaration, transpile } from '../../test-support/production-source';
import { parseAgentSessionSnapshot, parseEarlierTimelinePage } from '../agent-protocol';
import type { getAgentSessionSnapshot, loadEarlierAgentTimeline } from '../agent-session';

function fixture(
  capabilities = ['agent_history_window_v1', 'agent_history_ws_v1'],
  pending: {
    serverId?: () => string;
    beforeResponse?: () => Promise<void>;
    beforeBody?: () => Promise<void>;
  } = {}
) {
  const requests: { operation: string; options: unknown }[] = [];
  const responses: { status: number; body: unknown }[] = [];
  const observations: { sourceId: string | undefined; capabilities: unknown }[] = [];
  const read = runInNewContext(
    transpile(
      declaration('src/lib/agent-session.ts', 'getAgentSessionSnapshot') +
        '\n' +
        declaration('src/lib/agent-session.ts', 'observeEnvelopeCapabilities') +
        '\n' +
        declaration('src/lib/agent-session.ts', 'loadEarlierAgentTimeline') +
        '\n({ snapshot: getAgentSessionSnapshot, earlier: loadEarlierAgentTimeline })'
    ),
    {
      usesOfflineDemo: () => false,
      configuredGatewayServerId: pending.serverId ?? (() => 'computer'),
      useServerCapabilities: {
        getState: () => ({
          byServer: { computer: capabilities },
          observe: (sourceId: string | undefined, capabilities: unknown) =>
            observations.push({ sourceId, capabilities }),
        }),
      },
      agentSnapshotRefreshQuery: (refresh: boolean) => (refresh ? '?refresh=true' : ''),
      socketHistory: async (_asid: string, operation: string, options?: unknown) => {
        requests.push({ operation, options });
        const reply = responses.shift();
        if (!reply) throw new Error('Unexpected read');
        await pending.beforeResponse?.();
        return {
          ok: reply.status === 200,
          status: reply.status,
          json: async () => {
            await pending.beforeBody?.();
            return reply.body;
          },
          text: async () => {
            await pending.beforeBody?.();
            return JSON.stringify(reply.body);
          },
        };
      },
      sessionRoute: () => '/legacy',
      asRecord: (value: unknown) => value,
      parseAgentSessionSnapshot,
      parseEarlierTimelinePage,
      envelopeData: (value: { data: unknown }) => value.data,
      readApiError: (text: string) => JSON.parse(text),
    }
  ) as { snapshot: typeof getAgentSessionSnapshot; earlier: typeof loadEarlierAgentTimeline };
  return { ...read, requests, responses, observations };
}

test('new snapshots carry a reader boundary, older Gateways retain their existing contract', async () => {
  const f = fixture();
  f.responses.push({ status: 200, body: { data: { timeline: [], history_cursor: 'first' } } });
  expect((await f.snapshot('terminal', 'session')).history_cursor).toBe('first');
  expect(f.requests[0]).toEqual({ operation: 'window', options: { refresh: undefined } });
  f.responses.push({ status: 200, body: { data: { timeline: [], history_cursor: 'older' } } });
  await f.snapshot('terminal', 'session', { historyCursor: 'older' });
  expect(f.requests[1].options).toMatchObject({ cursor: 'older' });
  const legacy = fixture(['agent_history_ws_v1']);
  legacy.responses.push({ status: 200, body: { data: { timeline: [] } } });
  expect((await legacy.snapshot('terminal', 'session')).history_cursor).toBeUndefined();
  expect(legacy.requests[0].operation).toBe('snapshot');
});

test('expired snapshot boundaries recover once with an explicit window reset', async () => {
  const f = fixture();
  f.responses.push(
    { status: 409, body: { code: 'history_cursor_lost' } },
    { status: 200, body: { data: { timeline: [], history_cursor: 'new' } } }
  );
  const result = await f.snapshot('terminal', 'session', { historyCursor: 'expired' });
  expect(result.history_reset).toBe(true);
  expect(result.history_cursor).toBe('new');
  expect(f.requests.map((r) => r.options)).toEqual([
    { cursor: 'expired', refresh: undefined },
    { refresh: undefined },
  ]);
  f.responses.push({ status: 409, body: { code: 'history_cursor_lost' } });
  await expect(f.snapshot('terminal', 'session')).rejects.toThrow('Failed to get agent session');
});

for (const boundary of ['beforeResponse', 'beforeBody'] as const) {
  test(`cursor recovery cannot move to another computer while awaiting ${boundary}`, async () => {
    let selectedServerId = 'computer';
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const f = fixture(undefined, {
      serverId: () => selectedServerId,
      [boundary]: async () => {
        entered.resolve();
        await release.promise;
      },
    });
    f.responses.push(
      { status: 409, body: { code: 'history_cursor_lost' } },
      { status: 200, body: { data: { timeline: [], history_cursor: 'other-computer' } } }
    );
    const snapshot = f.snapshot('terminal', 'session', { historyCursor: 'expired' });
    await entered.promise;
    selectedServerId = 'other-computer';
    release.resolve();
    await expect(snapshot).rejects.toThrow('The selected computer changed');
    expect(f.requests).toHaveLength(1);
    expect(f.responses).toHaveLength(1);
  });
}

test('snapshot capabilities stay with their source and a delayed body cannot cross computers', async () => {
  let selectedServerId = 'computer';
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const f = fixture(undefined, {
    serverId: () => selectedServerId,
    beforeBody: async () => {
      entered.resolve();
      await release.promise;
    },
  });
  const body = { capabilities: ['agent_history_window_v1'], data: { timeline: [] } };
  f.responses.push({ status: 200, body });
  const snapshot = f.snapshot('terminal', 'session');
  await entered.promise;
  selectedServerId = 'other-computer';
  release.resolve();
  await expect(snapshot).rejects.toThrow('The selected computer changed');
  expect(f.observations).toEqual([]);

  selectedServerId = 'computer';
  f.responses.push({ status: 200, body });
  await f.snapshot('terminal', 'session');
  expect(f.observations).toEqual([{ sourceId: 'computer', capabilities: body.capabilities }]);
});

test('page requests are scoped to the reader and lost cursors are never reported as exhausted', async () => {
  const f = fixture();
  f.responses.push({
    status: 200,
    body: { data: { items: [], exhausted: false, history_cursor: 'next' } },
  });
  expect(await f.earlier('terminal', 'session', 'current')).toEqual({
    items: [],
    exhausted: false,
    history_cursor: 'next',
  });
  expect(f.requests[0]).toEqual({ operation: 'page', options: { cursor: 'current' } });
  f.responses.push({ status: 409, body: { code: 'history_cursor_lost' } });
  expect(await f.earlier('terminal', 'session', 'expired')).toEqual({
    items: [],
    exhausted: false,
    cursorLost: true,
  });
  expect(await f.earlier('terminal', 'session', null)).toEqual({
    items: [],
    exhausted: true,
    history_cursor: null,
  });
  expect(f.requests).toHaveLength(2);
});

test('oversized snapshot reads can use HTTP without replaying a stateful history page', async () => {
  const read = runInNewContext(
    transpile(declaration('src/lib/agent-session.ts', 'socketHistory') + '\nsocketHistory'),
    {
      configuredGatewayServerId: () => 'computer',
      useServerCapabilities: {
        getState: () => ({ byServer: { computer: ['agent_history_ws_v1'] } }),
      },
      gatewaySocketFor: () => ({
        requestHistory: async () => ({ status: 413, body: { error: 'too_large' } }),
      }),
    }
  );
  expect(await read('session', 'snapshot')).toBeNull();
  expect(await read('session', 'window')).toBeNull();
  expect((await read('session', 'page', { cursor: 'boundary' })).status).toBe(413);
  expect((await read('session', 'earlier')).status).toBe(413);
});
