import { expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import {
  declaration,
  productionSource,
  transpile,
  walk,
} from '../../test-support/production-source';
import { recoverWith, settleAfter } from '../compiler-safe-control-flow';
import { SessionPreparationFlights } from '../foreground-session-activation';
import { assertDeliveryCurrent } from '../bound-delivery';
import { isTransientPreparationError } from '../agent-request-error';

type Reply = { status: number; body?: string } | Error;

function harness(
  data: unknown = { data: { prepared: true } },
  status = 200,
  replies: Reply[] = []
) {
  const calls: { endpoint: unknown; url: string; init: RequestInit }[] = [];
  const api = runInNewContext(
    transpile(
      [
        declaration('src/lib/agent-session-prepare.ts', 'sessionPreparationSource'),
        declaration('src/lib/agent-session-prepare.ts', 'prepareAgentSessionAt'),
        declaration('src/lib/agent-session-prepare.ts', 'isAgentSessionPreparingAt'),
      ].join('\n') + '\n({prepare: prepareAgentSessionAt, preparing: isAgentSessionPreparingAt})'
    ),
    {
      flights: new SessionPreparationFlights(),
      assertDeliveryCurrent,
      isTransientPreparationError,
      PREPARE_RETRY_DELAYS_MS: [0, 0],
      setTimeout,
      isGatewayEncryptionDisabled: () => false,
      withRecordBaseUrl: (record: { url: string }, body: (base: string) => Promise<void>) =>
        body(record.url.replace(/\/$/, '')),
      gatewayEndpointFetch: async (endpoint: unknown, url: string, init: RequestInit) => {
        calls.push({ endpoint, url, init });
        const reply = replies.shift();
        if (reply instanceof Error) throw reply;
        const code = reply?.status ?? status;
        return {
          ok: code === 200,
          status: code,
          json: async () => data,
          text: async () => reply?.body ?? 'refused',
        };
      },
    }
  ) as {
    prepare: (options: {
      serverId: string;
      agentId: string;
      asid: string;
      record: { url: string; token: string; deviceId: string };
      current: () => boolean;
      capabilities?: string[];
    }) => Promise<void>;
    preparing: (input: typeof options) => boolean;
  };
  return { calls, ...api };
}
const options = {
  serverId: 'server',
  agentId: 'opaque/agent',
  asid: 'opaque/session',
  record: { url: 'https://captured.invalid/', token: 'fixture', deviceId: 'device' },
  current: () => true,
};

test('activation posts to the provider-scoped route with captured credentials and no prompt', async () => {
  const run = harness();
  await run.prepare({ ...options, capabilities: ['agent_session_resume_v1'] });
  expect(run.calls).toHaveLength(1);
  expect(run.calls[0].url).toBe(
    'https://captured.invalid/api/agents/opaque%2Fagent/sessions/opaque%2Fsession/prepare'
  );
  expect(run.calls[0].init.method).toBe('POST');
  expect(run.calls[0].init.body).toBeUndefined();
  expect(run.calls[0].endpoint).toEqual({
    ...options.record,
    url: 'https://captured.invalid',
    sshTunnel: undefined,
    transport: undefined,
  });
  expect(run.calls[0].init.headers).toEqual({ Authorization: 'Bearer fixture' });
});

test('legacy capability absence sends nothing; refusal and malformed acknowledgments remain errors', async () => {
  const old = harness();
  await old.prepare(options);
  expect(old.calls).toHaveLength(0);
  const refused = harness({}, 503);
  await expect(
    refused.prepare({ ...options, capabilities: ['agent_session_resume_v1'] })
  ).rejects.toThrow('503');
  expect(refused.calls).toHaveLength(1);
  const malformed = harness({ data: { prepared: false } });
  await expect(
    malformed.prepare({ ...options, capabilities: ['agent_session_resume_v1'] })
  ).rejects.toThrow('unreadable response');
});

test('the actual post-activation snapshot callback fences late pairing and restart responses', async () => {
  const source = productionSource('src/components/agent-workbench.tsx');
  let callback = '';
  walk(source.program, (node) => {
    if (
      node.type === 'VariableDeclarator' &&
      node.id.type === 'Identifier' &&
      node.id.name === 'loadSnapshot' &&
      node.init?.type === 'CallExpression'
    ) {
      const argument = node.init.arguments[0];
      if (argument?.type === 'ArrowFunctionExpression') callback = source.code(argument);
    }
  });
  if (!callback) throw new Error('Missing snapshot reader');
  for (const intent of ['stale-before-start', 'stale-after-read', 'ordinary-read']) {
    let current = intent !== 'stale-before-start';
    let reads = 0;
    let snapshotTouches = 0;
    const mounted = { current: true };
    const reply = Promise.withResolvers<unknown>();
    const load = runInNewContext(transpile(callback), {
      activeAsid: 'session',
      activeAsidRef: { current: 'session' },
      mountedRef: mounted,
      ownerGenerationRef: { current: 1 },
      globalOwnerRef: { current: null },
      snapshotReadRef: { current: 0 },
      serverId: 'computer',
      sessionId: 'route',
      readPreparationSource: () => null,
      historyCursorRef: { current: undefined },
      useGatewayConnectionStore: { getState: () => ({ record: { serverId: 'computer' } }) },
      useServerCapabilities: { getState: () => ({ byServer: {} }) },
      useHomeAttention: { getState: () => ({ reserve: () => 1 }) },
      recoverWith,
      settleAfter,
      getAgentSessionSnapshot: () => {
        reads++;
        return reply.promise;
      },
    }) as (mode: 'silent', guard?: () => boolean) => Promise<void>;
    const pending = load('silent', intent === 'ordinary-read' ? undefined : () => current);
    if (intent === 'ordinary-read') mounted.current = false;
    else current = false;
    reply.resolve({
      get history_cursor() {
        snapshotTouches++;
        return undefined;
      },
    });
    await pending;
    expect(reads).toBe(intent === 'stale-before-start' ? 0 : 1);
    expect(snapshotTouches).toBe(0);
  }
});

test('pending prepare is source/provider/session scoped and ends after acknowledgment, cancellation or refusal', async () => {
  const ack = Promise.withResolvers<unknown>();
  const run = harness(ack.promise);
  let current = true;
  const request = { ...options, current: () => current, capabilities: ['agent_session_resume_v1'] };
  expect(run.preparing(request)).toBe(false);
  const pending = run.prepare(request);
  expect(run.preparing(request)).toBe(true);
  expect(run.preparing({ ...request, asid: 'different' })).toBe(false);
  expect(run.preparing({ ...request, agentId: 'different' })).toBe(false);
  expect(run.preparing({ ...request, record: { ...request.record, token: 'new-pairing' } })).toBe(
    false
  );
  current = false;
  expect(run.preparing(request)).toBe(false);
  current = true;
  ack.resolve({ data: { prepared: true } });
  await pending;
  expect(run.preparing(request)).toBe(false);
  const refused = harness({}, 502);
  await expect(refused.prepare(request)).rejects.toThrow('502');
  expect(refused.preparing(request)).toBe(false);
});

test('preparation retries only a gateway still attaching agents or a request with no answer', async () => {
  const unavailable = {
    status: 503,
    body: '{"error":{"code":"agent_unavailable","message":"Agent \'qoder\' is not available"}}',
  };
  const network = Object.assign(new Error('Network request failed'), { name: 'NetworkError' });
  const refusal = { status: 502, body: '{"error":{"code":"agent_error","message":"no"}}' };
  for (const [replies, calls, settles] of [
    [[unavailable], 2, true],
    [[network, unavailable], 3, true],
    [[unavailable, unavailable, unavailable], 3, false],
    [[refusal], 1, false],
    [[{ status: 503, body: 'refused' }], 1, false],
    [[new Error('Request timed out')], 1, false],
  ] as [Reply[], number, boolean][]) {
    const run = harness(undefined, 200, [...replies]);
    const result = run.prepare({ ...options, capabilities: ['agent_session_resume_v1'] });
    if (settles) await result;
    else await expect(result).rejects.toThrow();
    expect(run.calls).toHaveLength(calls);
  }
});
