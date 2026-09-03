import { createMMKV } from 'react-native-mmkv';

/**
 * MMKV is a native module. An over-the-air update can reach a binary built
 * before it was added -- every current install, until the new build ships --
 * and creating the store there throws. Falling back to an in-memory store keeps
 * the app running: usage ordering simply does not persist across launches until
 * the native binary catches up, which is a feature degrading, not a crash.
 */
type KeyValueStore = {
  getString: (key: string) => string | undefined;
  set: (key: string, value: string) => void;
};

function openStore(): KeyValueStore {
  try {
    return createMMKV({ id: 'muqun.shortcut-usage' });
  } catch {
    const memory = new Map<string, string>();
    return {
      getString: (key) => memory.get(key),
      set: (key, value) => {
        memory.set(key, value);
      },
    };
  }
}

/**
 * How often each key and command has been used, so the row and the quick action
 * list lead with what this developer actually reaches for.
 *
 * Counts are scoped per server *and* per agent profile: `ctrl+t` matters in a
 * Claude pane and means nothing in a shell, and two machines rarely get used
 * the same way.
 *
 * Stored in MMKV rather than the keychain: this is a tally of button presses,
 * not a secret, and it is written on a tap. MMKV's reads and writes are
 * synchronous and memory-mapped, so the ordering is available on first render
 * with no async round-trip and no keychain work on the tap path.
 */
const STORAGE_KEY = 'muqun.shortcut-usage.v1';

/**
 * Kept small on purpose. Secure storage is not sized for bulk data, and an
 * ordering is settled long before this many entries: a pane offers around 20
 * keys, and nobody works across a dozen machines at once.
 */
const MAX_SCOPES = 32;
const MAX_ENTRIES_PER_SCOPE = 48;

let storageInstance: KeyValueStore | null = null;
function store(): KeyValueStore {
  if (!storageInstance) storageInstance = openStore();
  return storageInstance;
}

type UsageCounts = Record<string, number>;
type UsageTable = Record<string, UsageCounts>;

let cache: UsageTable | null = null;

export function usageScope(serverId: string, profile: string, kind: 'keys' | 'commands'): string {
  return `${serverId}::${profile}::${kind}`;
}

export function loadUsage(): UsageTable {
  if (cache) return cache;
  try {
    const value = store().getString(STORAGE_KEY);
    cache = value ? (JSON.parse(value) as UsageTable) : {};
  } catch {
    cache = {};
  }
  return cache;
}

/** Records one use. MMKV writes are synchronous and cheap, so there is nothing
 * to batch and nothing to lose on a crash. */
export function recordUsage(scope: string, id: string): void {
  const table = loadUsage();
  const counts = table[scope] ?? {};
  counts[id] = (counts[id] ?? 0) + 1;
  table[scope] = counts;
  persist();
}

function persist(): void {
  if (!cache) return;
  const scopes = Object.entries(cache).slice(-MAX_SCOPES);
  const trimmed: UsageTable = {};
  for (const [scope, counts] of scopes) {
    trimmed[scope] = Object.fromEntries(
      Object.entries(counts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, MAX_ENTRIES_PER_SCOPE)
    );
  }
  cache = trimmed;
  try {
    store().set(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // A tally is not worth surfacing an error for.
  }
}

/**
 * Orders by use, most used first, falling back to the order the gateway gave.
 *
 * Deliberately not applied on every tap: a row that rearranges itself under a
 * thumb is worse than one that is slightly out of date. Callers memoise this on
 * the pane, so the order settles when you switch panes and holds while you work.
 */
export function orderByUsage<T>(
  items: T[],
  counts: UsageCounts | undefined,
  identify: (item: T) => string
): T[] {
  if (!counts) return items;
  return items
    .map((item, index) => ({ item, index, uses: counts[identify(item)] ?? 0 }))
    .sort((a, b) => b.uses - a.uses || a.index - b.index)
    .map((entry) => entry.item);
}
