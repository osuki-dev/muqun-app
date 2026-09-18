import { describe, expect, mock, test } from 'bun:test';

import {
  agentCatalogCacheVariant,
  agentCatalogPath,
  normalizeCatalogDirectory,
  shouldRefetchAgentCatalog,
} from '../agent-catalog-scope';

// `agent-cache` reaches for MMKV at import time and there is no native store
// in a unit test. `mock.module` is process-wide and first registration wins,
// so this is the same fake `agent-cache.test.ts` registers.
mock.module('react-native-mmkv', () => ({
  createMMKV: () => {
    throw new Error('no native MMKV in tests');
  },
}));

const { AGENT_CACHE_SCHEMA, buildAgentCacheKey } = await import('../agent-cache');

describe('agentCatalogPath', () => {
  test('names the workspace, so project-scoped entries can come back', () => {
    // This is the bug: without `?directory=` OpenCode answers with the global
    // agents only and a user's own `.opencode/agent` entry is never listed.
    expect(agentCatalogPath(undefined, '/home/ryu/Work/muqun/app')).toBe(
      '/api/agent-catalog?directory=%2Fhome%2Fryu%2FWork%2Fmuqun%2Fapp'
    );
  });

  test('the directory is encoded, spaces and all', () => {
    const path = agentCatalogPath('sess-1', '/Users/ryu/My Projects/a&b');
    expect(path).toBe(
      '/api/sessions/sess-1/agent-catalog?directory=%2FUsers%2Fryu%2FMy%20Projects%2Fa%26b'
    );
    // Decodable back to exactly what was asked for.
    expect(decodeURIComponent(path.split('directory=')[1])).toBe('/Users/ryu/My Projects/a&b');
  });

  test('a caller with no directory asks the route it always did', () => {
    expect(agentCatalogPath()).toBe('/api/agent-catalog');
    expect(agentCatalogPath('sess-1')).toBe('/api/sessions/sess-1/agent-catalog');
    expect(agentCatalogPath('sess-1', '   ')).toBe('/api/sessions/sess-1/agent-catalog');
  });
});

describe('the cache key carries the directory', () => {
  test('two workspaces on one host never share a cached catalog', () => {
    const a = buildAgentCacheKey(
      'catalog',
      null,
      'sess-1',
      agentCatalogCacheVariant('/home/ryu/a')
    );
    const b = buildAgentCacheKey(
      'catalog',
      null,
      'sess-1',
      agentCatalogCacheVariant('/home/ryu/b')
    );
    expect(a).not.toBe(b);
    // The key is also the in-flight dedupe key, so two workspaces asking at
    // once are two requests rather than one answer handed to both.
    expect(a).toBe(`catalog@${AGENT_CACHE_SCHEMA}:default_gateway:sess-1:dir=/home/ryu/a`);
  });

  test('no directory keeps the key a caller without one always had', () => {
    expect(agentCatalogCacheVariant(undefined)).toBeNull();
    expect(agentCatalogCacheVariant('  ')).toBeNull();
    expect(buildAgentCacheKey('catalog', null, 'sess-1', agentCatalogCacheVariant())).toBe(
      buildAgentCacheKey('catalog', null, 'sess-1')
    );
  });

  test('a scoped read and an unscoped one are different entries', () => {
    expect(buildAgentCacheKey('catalog', null, 'sess-1', agentCatalogCacheVariant('/x'))).not.toBe(
      buildAgentCacheKey('catalog', null, 'sess-1')
    );
  });
});

describe('normalizeCatalogDirectory', () => {
  test('whitespace is no directory', () => {
    expect(normalizeCatalogDirectory('  /x  ')).toBe('/x');
    expect(normalizeCatalogDirectory('')).toBeUndefined();
    expect(normalizeCatalogDirectory(undefined)).toBeUndefined();
  });
});

describe('shouldRefetchAgentCatalog', () => {
  test('the first read happens before any directory is known', () => {
    expect(shouldRefetchAgentCatalog(null, { sessionId: 'sess-1' })).toBe(true);
  });

  test('the directory arriving is what fetches the project catalog', () => {
    expect(
      shouldRefetchAgentCatalog({ sessionId: 'sess-1' }, { sessionId: 'sess-1', directory: '/a' })
    ).toBe(true);
  });

  test('a workspace switch refetches', () => {
    expect(
      shouldRefetchAgentCatalog(
        { sessionId: 'sess-1', directory: '/a' },
        { sessionId: 'sess-1', directory: '/b' }
      )
    ).toBe(true);
  });

  test('the same workspace again does not', () => {
    expect(
      shouldRefetchAgentCatalog(
        { sessionId: 'sess-1', directory: '/a' },
        { sessionId: 'sess-1', directory: '/a' }
      )
    ).toBe(false);
  });

  test('losing the directory keeps the project catalog on screen', () => {
    // `activeDirectory` is `undefined` between a session leaving and the next
    // snapshot stating one. Re-reading there would put the global list back
    // and then fetch the project's again a moment later.
    expect(
      shouldRefetchAgentCatalog({ sessionId: 'sess-1', directory: '/a' }, { sessionId: 'sess-1' })
    ).toBe(false);
  });

  test('another gateway session is another host, so it always refetches', () => {
    expect(
      shouldRefetchAgentCatalog(
        { sessionId: 'sess-1', directory: '/a' },
        { sessionId: 'sess-2', directory: '/a' }
      )
    ).toBe(true);
    expect(shouldRefetchAgentCatalog({ sessionId: 'sess-1' }, { sessionId: undefined })).toBe(true);
  });
});
