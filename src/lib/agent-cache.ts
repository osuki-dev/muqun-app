import { createMMKV } from 'react-native-mmkv';
import type { AgentCatalog, AgentProject } from './agent-session';

const STORE_ID = 'muqun.agent-cache';

export const CATALOG_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const PROJECTS_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface AgentCacheEntry<T> {
  data: T;
  etag?: string;
  timestamp: number;
}

const storage = (() => {
  try {
    return createMMKV({ id: STORE_ID });
  } catch {
    return null;
  }
})();

// Memory cache for synchronous instant L1 lookups
const memoryCache = new Map<string, AgentCacheEntry<unknown>>();

// In-flight promise deduplication to prevent concurrent identical network requests
const inFlightRequests = new Map<string, Promise<unknown>>();

export function dedupeInFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inFlightRequests.get(key);
  if (existing) {
    return existing as Promise<T>;
  }

  const promise = fn().finally(() => {
    inFlightRequests.delete(key);
  });
  inFlightRequests.set(key, promise);
  return promise;
}

/**
 * What this app's parsers understand, stamped into every cache key.
 *
 * The cache holds *parsed* objects, and the conditional request that refreshes
 * it is the host's ETag -- which says whether the catalog changed on the host,
 * not whether this app has learned to read more of it. So a build whose parser
 * grew a field (`skills[].slash`, say) asked with the old ETag, was told `304`,
 * and went on handing out an object parsed by the previous version: the new
 * field was missing until something changed on the host. Bumping this number
 * retires every entry written by an older parser in one line.
 */
export const AGENT_CACHE_SCHEMA = 2;

export function buildAgentCacheKey(
  type: 'catalog' | 'projects' | 'sessions',
  endpointKey?: string | null,
  sessionId?: string | null,
  /**
   * What distinguishes two reads of the same route -- the sessions list's own
   * query, which scopes it to a workspace and bounds it.
   *
   * Without it a scoped listing and an unscoped one share a key, so the second
   * one's `If-None-Match` carries the first one's ETag and a `304` hands back
   * the wrong list entirely.
   */
  variant?: string | null
): string {
  const ep = endpointKey ? endpointKey.replace(/\/$/, '') : 'default_gateway';
  const sid = sessionId || 'global';
  const base = `${type}@${AGENT_CACHE_SCHEMA}:${ep}:${sid}`;
  return variant ? `${base}:${variant}` : base;
}

export function getCachedEntry<T>(key: string): AgentCacheEntry<T> | null {
  const mem = memoryCache.get(key);
  if (mem) {
    return mem as AgentCacheEntry<T>;
  }

  try {
    const raw = storage?.getString(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AgentCacheEntry<T>;
    if (parsed && typeof parsed.timestamp === 'number' && parsed.data !== undefined) {
      memoryCache.set(key, parsed);
      return parsed;
    }
  } catch {
    // Malformed cache entry
  }
  return null;
}

export function setCachedEntry<T>(key: string, data: T, etag?: string): void {
  const entry: AgentCacheEntry<T> = {
    data,
    etag: etag || undefined,
    timestamp: Date.now(),
  };

  memoryCache.set(key, entry);

  try {
    storage?.set(key, JSON.stringify(entry));
  } catch {
    // MMKV write failure fallback
  }
}

export function touchCacheEntryTimestamp(key: string): void {
  const entry = getCachedEntry(key);
  if (entry) {
    entry.timestamp = Date.now();
    memoryCache.set(key, entry);
    try {
      storage?.set(key, JSON.stringify(entry));
    } catch {
      // MMKV write failure fallback
    }
  }
}

export function getCachedAgentCatalogSync(key: string): AgentCatalog | null {
  const entry = getCachedEntry<AgentCatalog>(key);
  return entry ? entry.data : null;
}

export function getCachedAgentProjectsSync(key: string): AgentProject[] | null {
  const entry = getCachedEntry<AgentProject[]>(key);
  return entry ? entry.data : null;
}

export function clearAgentCache(): void {
  memoryCache.clear();
  try {
    storage?.clearAll();
  } catch {
    // ignore
  }
}
