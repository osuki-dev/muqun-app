import { beforeEach, describe, expect, mock, test } from 'bun:test';

mock.module('react-native-mmkv', () => ({
  createMMKV: () => {
    throw new Error('no native MMKV in tests');
  },
}));

const {
  AGENT_CACHE_SCHEMA,
  buildAgentCacheKey,
  clearAgentCache,
  dedupeInFlight,
  getCachedAgentCatalogSync,
  getCachedAgentProjectsSync,
  getCachedEntry,
  setCachedEntry,
  touchCacheEntryTimestamp,
} = await import('../agent-cache');

beforeEach(() => {
  clearAgentCache();
});

describe('buildAgentCacheKey', () => {
  test('generates normalized keys, stamped with the parser schema', () => {
    expect(buildAgentCacheKey('catalog', 'http://127.0.0.1:8080/', 'sess-1')).toBe(
      `catalog@${AGENT_CACHE_SCHEMA}:http://127.0.0.1:8080:sess-1`
    );
    expect(buildAgentCacheKey('projects', undefined, null)).toBe(
      `projects@${AGENT_CACHE_SCHEMA}:default_gateway:global`
    );
  });

  test('a variant is part of the key, so two listings cannot share an ETag', () => {
    const all = buildAgentCacheKey('sessions', null, 'sess-1', 'all');
    const scoped = buildAgentCacheKey('sessions', null, 'sess-1', '?directory=/tmp/x');
    expect(all).not.toBe(scoped);
    expect(scoped.endsWith(':?directory=/tmp/x')).toBe(true);
  });

  test('the schema stamp retires what an older parser wrote', () => {
    // The cache holds parsed objects and is refreshed against the *host's*
    // ETag, which says nothing about what this app has learned to read.
    expect(buildAgentCacheKey('catalog', null, null)).toContain(`@${AGENT_CACHE_SCHEMA}`);
    expect(AGENT_CACHE_SCHEMA).toBeGreaterThan(1);
  });
});

describe('agent cache storage and memory fallback', () => {
  test('stores and retrieves catalog synchronously', () => {
    const key = 'catalog:test:global';
    expect(getCachedAgentCatalogSync(key)).toBeNull();

    const mockCatalog = {
      models: [{ id: 'gemini-3.8', name: 'Gemini', provider_id: 'google', enabled: true }],
      agents: [{ id: 'build', name: 'Build' }],
      mcp: [],
      skills: [],
      providers: [],
      commands: [],
      defaults: {},
    };

    setCachedEntry(key, mockCatalog, '"etag-123"');
    const retrieved = getCachedAgentCatalogSync(key);
    expect(retrieved).toEqual(mockCatalog);

    const entry = getCachedEntry(key);
    expect(entry?.etag).toBe('"etag-123"');
    expect(typeof entry?.timestamp).toBe('number');
  });

  test('stores and retrieves projects synchronously', () => {
    const key = 'projects:test:global';
    expect(getCachedAgentProjectsSync(key)).toBeNull();

    const mockProjects = [{ id: 'proj-1', name: 'App', canonical: '/home/user/app' }];

    setCachedEntry(key, mockProjects);
    expect(getCachedAgentProjectsSync(key)).toEqual(mockProjects);
  });

  test('touchCacheEntryTimestamp updates timestamp', async () => {
    const key = 'catalog:test:touch';
    setCachedEntry(key, {
      models: [],
      agents: [],
      mcp: [],
      skills: [],
      providers: [],
      commands: [],
      defaults: {},
    });
    const t1 = getCachedEntry(key)?.timestamp ?? 0;

    await new Promise((r) => setTimeout(r, 15));
    touchCacheEntryTimestamp(key);
    const t2 = getCachedEntry(key)?.timestamp ?? 0;
    expect(t2).toBeGreaterThan(t1);
  });
});

describe('dedupeInFlight', () => {
  test('collapses concurrent calls for the same key into a single invocation', async () => {
    let callCount = 0;
    const worker = async () => {
      callCount += 1;
      await new Promise((r) => setTimeout(r, 20));
      return 'done';
    };

    const [r1, r2, r3] = await Promise.all([
      dedupeInFlight('test-req', worker),
      dedupeInFlight('test-req', worker),
      dedupeInFlight('test-req', worker),
    ]);

    expect(callCount).toBe(1);
    expect(r1).toBe('done');
    expect(r2).toBe('done');
    expect(r3).toBe('done');

    // Subsequent call after settling executes again
    const r4 = await dedupeInFlight('test-req', worker);
    expect(callCount).toBe(2);
    expect(r4).toBe('done');
  });
});
