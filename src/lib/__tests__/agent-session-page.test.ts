import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as protocol from '../agent-protocol';
import * as pages from '../agent-session-page';
import * as query from '../agent-session-list-query';

const features = { ...protocol.defaultAgentFeatures(), extra: { sessionPagination: true } };
const capabilities = ['agent_session_pages_v1'];
const row = (asid: string) =>
  protocol.parseAgentSessionInfo({ asid, agent_id: 'custom-agent', title: asid, status: 'idle' })!;
const page = (ids: string[], nextCursor: string | null): pages.AgentSessionPage => ({
  sessions: ids.map(row),
  nextCursor,
  previousCursor: null,
  paginated: true,
  authoritative: true,
});

test('pages require both capability declarations and a real selected provider', () => {
  expect(pages.supportsAgentSessionPages(capabilities, features, 'custom-agent')).toBe(true);
  for (const value of [false, undefined, 'true'])
    expect(
      pages.supportsAgentSessionPages(
        capabilities,
        { ...features, extra: { sessionPagination: value } },
        'custom-agent'
      )
    ).toBe(false);
  expect(pages.supportsAgentSessionPages([], features, 'custom-agent')).toBe(false);
  expect(pages.supportsAgentSessionPages(capabilities, features, '')).toBe(false);
});

test('page contract retains provider order, opaque cursors and explicit end markers', () => {
  const parsed = pages.parseAgentSessionPage({
    data: [row('older'), row('newer')],
    cursor: { next: 'opaque+/= cursor', previous: null },
  });
  expect(parsed.sessions.map((session) => session.asid)).toEqual(['older', 'newer']);
  expect(parsed.nextCursor).toBe('opaque+/= cursor');
  expect(() => pages.parseAgentSessionPage({ data: [], cursor: {} })).toThrow();
  expect(() => pages.parseAgentSessionPage([])).toThrow();
});

test('append keeps existing row identities/order, ignores overlaps and retries only the failed cursor', async () => {
  const calls: (string | undefined)[] = [];
  const states: pages.SessionPagesState[] = [];
  let fail = true;
  const loader = pages.createSessionPageLoader(
    async (cursor) => {
      calls.push(cursor);
      if (!cursor) return page(['first', 'second'], 'next');
      if (fail) {
        fail = false;
        throw new Error('offline');
      }
      return page(['second', 'third'], null);
    },
    (state) => states.push(state)
  );
  await loader.load();
  const first = states.at(-1)!.sessions[0];
  await loader.load();
  expect(states.at(-1)!.failed).toBe(true);
  expect(states.at(-1)!.sessions.map((session) => session.asid)).toEqual(['first', 'second']);
  await loader.load();
  await loader.load();
  expect(calls).toEqual([undefined, 'next', 'next']);
  expect(states.at(-1)!.sessions.map((session) => session.asid)).toEqual([
    'first',
    'second',
    'third',
  ]);
  expect(states.at(-1)!.sessions[0]).toBe(first);
});

test('switching query owners aborts requests and ignores a late response even if transport ignores abort', async () => {
  let release!: (page: pages.AgentSessionPage) => void;
  let signal!: AbortSignal;
  const states: pages.SessionPagesState[] = [];
  const loader = pages.createSessionPageLoader(
    (_cursor, captured) => {
      signal = captured;
      return new Promise((resolve) => {
        release = resolve;
      });
    },
    (state) => states.push(state)
  );
  const pending = loader.load();
  await loader.load(); // no duplicate in-flight load
  loader.dispose();
  expect(signal.aborted).toBe(true);
  release(page(['wrong-owner'], 'wrong-cursor'));
  await pending;
  expect(states).toHaveLength(1);
  expect(states[0]!.sessions).toEqual([]);
});

test('a repeated provider cursor does not loop or discard the loaded rows', async () => {
  let state!: pages.SessionPagesState;
  const loader = pages.createSessionPageLoader(
    async () => page(['one'], 'loop'),
    (next) => {
      state = next;
    }
  );
  await loader.load();
  await loader.load();
  expect(state.failed).toBe(true);
  expect(state.sessions.map((session) => session.asid)).toEqual(['one']);
});

const require = createRequire(import.meta.url);
const code = require('@babel/core').transformSync(
  readFileSync(new URL('../agent-session.ts', import.meta.url), 'utf8'),
  {
    filename: 'agent-session.ts',
    babelrc: false,
    configFile: false,
    presets: ['@react-native/babel-preset'],
  }
).code;

/** Native boundary fixture executes the production reader, query and parser. */
function transportFixture() {
  let serverId = 'server-a';
  const requests: { url: string; init: RequestInit }[] = [];
  const cache = new Map<string, { data: unknown; etag?: string; timestamp: number }>();
  let nextResponse = () =>
    Response.json(
      {
        schema_version: '1.5.0',
        data: { data: [row('one')], cursor: { next: 'opaque+/=', previous: null } },
      },
      { headers: { etag: 'page-one' } }
    );
  const exports: Record<string, unknown> = {};
  runInNewContext(code, {
    exports,
    URLSearchParams,
    require: (name: string) => {
      if (name.startsWith('@babel/runtime/')) return require(name);
      if (name === './agent-protocol') return protocol;
      if (name === './agent-session-page') return pages;
      if (name === './agent-session-list-query') return query;
      if (name === './gateway-client')
        return {
          configuredGatewayServerId: () => serverId,
          gatewayUrl: (path: string) => `https://${serverId}${path}`,
          gatewayAuthHeaders: () => ({ Authorization: `Bearer ${serverId}` }),
          isGatewayConfigured: () => true,
          gatewayFetch: async (url: string, init: RequestInit) => {
            requests.push({ url, init });
            return nextResponse();
          },
        };
      if (name === './agent-cache')
        return {
          buildAgentCacheKey: (...values: unknown[]) => JSON.stringify(values),
          getCachedEntry: (key: string) => cache.get(key),
          setCachedEntry: (key: string, data: unknown, etag?: string) =>
            cache.set(key, { data, etag, timestamp: 1 }),
          touchCacheEntryTimestamp: () => {},
          dedupeInFlight: (_key: string, read: () => unknown) => read(),
        };
      return {};
    },
  });
  return {
    read: exports.listAgentSessionPage as typeof import('../agent-session').listAgentSessionPage,
    requests,
    respond: (response: () => Response) => {
      nextResponse = response;
    },
    switchServer: () => {
      serverId = 'server-b';
    },
  };
}

test('reader uses the global scoped page endpoint and isolates ETags by cursor, filter and server', async () => {
  const fixture = transportFixture();
  const options = { serverId: 'server-a', capabilities, features };
  const scope = {
    agentId: 'custom-agent',
    roots: true,
    limit: 50,
    order: 'desc' as const,
    directory: '/workspace',
    search: 'title',
  };
  const result = await fixture.read('terminal-id', scope, options);
  expect(result.nextCursor).toBe('opaque+/=');
  expect(fixture.requests[0]!.url).toContain('/api/agent-sessions/page?');
  expect(new URL(fixture.requests[0]!.url).searchParams.get('agent_id')).toBe('custom-agent');
  fixture.respond(() => new Response(null, { status: 304 }));
  expect((await fixture.read('terminal-id', scope, options)).sessions[0]!.asid).toBe('one');
  expect(new Headers(fixture.requests[1]!.init.headers).get('If-None-Match')).toBe('page-one');
  fixture.respond(() =>
    Response.json({ data: { data: [], cursor: { next: null, previous: null } } })
  );
  await fixture.read('terminal-id', { ...scope, cursor: 'opaque+/=' }, options);
  expect(new URL(fixture.requests[2]!.url).searchParams.get('cursor')).toBe('opaque+/=');
  expect(new Headers(fixture.requests[2]!.init.headers).get('If-None-Match')).toBeNull();
  await fixture.read('terminal-id', { ...scope, search: 'changed' }, options);
  expect(new Headers(fixture.requests[3]!.init.headers).get('If-None-Match')).toBeNull();
  fixture.switchServer();
  await expect(fixture.read('terminal-id', scope, options)).rejects.toThrow('owner changed');
  await fixture.read('terminal-id', scope, { ...options, serverId: 'server-b' });
  expect(new Headers(fixture.requests[4]!.init.headers).get('If-None-Match')).toBeNull();
});

test('unsupported providers retain the legacy array reader without broadcasting a cursor', async () => {
  const fixture = transportFixture();
  fixture.respond(() => Response.json({ data: [row('legacy')] }));
  const result = await fixture.read(
    'terminal-id',
    { agentId: 'custom-agent', cursor: 'private-cursor', limit: 50 },
    { serverId: 'server-a', capabilities: [], features }
  );
  expect(result.paginated).toBe(false);
  expect(result.sessions[0]!.asid).toBe('legacy');
  expect(fixture.requests[0]!.url).toContain('/api/sessions/terminal-id/agent-sessions?');
  expect(new URL(fixture.requests[0]!.url).searchParams.has('cursor')).toBe(false);
});
