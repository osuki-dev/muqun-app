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

export function buildAgentCacheKey(
  type: 'catalog' | 'projects',
  endpointKey?: string | null,
  sessionId?: string | null
): string {
  const ep = endpointKey ? endpointKey.replace(/\/$/, '') : 'default_gateway';
  const sid = sessionId || 'global';
  return `${type}:${ep}:${sid}`;
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
