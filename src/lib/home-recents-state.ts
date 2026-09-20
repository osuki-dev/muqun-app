import { createStore, type StateCreator } from 'zustand/vanilla';

import {
  createHomeRecentEntry,
  filterHomeRecentEntries,
  homeTargetKey,
  isHomeRecentEntryAllowed,
  MAX_HOME_RECENTS,
  parseHomeRecentsDocument,
  serializeHomeRecents,
  type HomeRecentEntry,
  type HomeRecentsAllowlist,
  type HomeSessionObservation,
  type HomeTarget,
} from './home-recents';

/** The native storage edge is injected so the state machine stays testable. */
export type HomeRecentsPersistence = {
  load: () => Promise<string | null | undefined>;
  save: (serialized: string) => Promise<void>;
};

export type HomeRecentsState = {
  /** True after the first storage read has settled, including a failed read. */
  hydrated: boolean;
  /** Newest explicit visit first; capped by `MAX_HOME_RECENTS`. */
  entries: HomeRecentEntry[];
  hydrate: () => Promise<void>;
  /** Records a user-selected destination. Token/output activity never calls this. */
  visit: (
    target: HomeTarget,
    title?: string,
    atMs?: number,
    sessionObservation?: HomeSessionObservation
  ) => Promise<void>;
  /** Updates display metadata in place without creating or reordering a visit. */
  updateTitle: (target: HomeTarget, title: string) => Promise<void>;
  /** Updates observed OpenCode status without creating or reordering a visit. */
  observeSession: (target: HomeTarget, observation: HomeSessionObservation) => Promise<void>;
  /** Removes references to unpaired servers and deleted SSH hosts. */
  keepOnly: (allowlist: HomeRecentsAllowlist) => Promise<void>;
  remove: (target: HomeTarget) => Promise<void>;
};

/**
 * Creates the bounded recent-target state machine.
 *
 * The closure owns hydration and the write queue per store. A pending read can
 * never replace a visit or resurrect a target removed while it was in flight;
 * an allowlist is installed before its read starts being merged.
 */
export function createHomeRecentsState(
  persistence: HomeRecentsPersistence
): StateCreator<HomeRecentsState> {
  return (set, get) => {
    let hydrationPromise: Promise<void> | undefined;
    let hydrated = false;
    // A newer app owns a future document. Keep this store useful in memory,
    // but never let a v1 write replace bytes this version cannot understand.
    let persistenceWritable = true;
    let allowed: NormalizedAllowlist | undefined;
    const changedDuringHydration = new Set<string>();
    const removedDuringHydration = new Set<string>();

    let writeRequested = false;
    let writeDrain: Promise<void> | undefined;
    let writeWaiters: (() => void)[] = [];

    const requestWrite = (): Promise<void> => {
      if (!persistenceWritable) return Promise.resolve();
      writeRequested = true;
      const done = new Promise<void>((resolve) => writeWaiters.push(resolve));
      startWriteDrain();
      return done;
    };

    const startWriteDrain = (): void => {
      if (!hydrated || writeDrain || !writeRequested) return;
      // Keep the adapter call behind a microtask. An adapter may throw before
      // returning a promise, and assigning the drain before that call makes
      // its finally path reliable in that case too.
      writeDrain = Promise.resolve().then(async () => {
        try {
          while (writeRequested) {
            writeRequested = false;
            const serialized = serializeHomeRecents(get().entries);
            try {
              await persistence.save(serialized);
            } catch {
              // Memory remains useful for this launch. A later visit can still
              // ask the adapter to save again; a failed write must not wedge it.
            }
          }
        } finally {
          writeDrain = undefined;
          const waiters = writeWaiters;
          writeWaiters = [];
          for (const resolve of waiters) resolve();
          startWriteDrain();
        }
      });
    };

    const hydrate = (): Promise<void> => {
      if (hydrationPromise) return hydrationPromise;

      hydrationPromise = (async () => {
        let parsed: ReturnType<typeof parseHomeRecentsDocument> = {
          kind: 'invalid',
          entries: [],
        };
        try {
          parsed = parseHomeRecentsDocument(await persistence.load());
          if (parsed.kind === 'future') persistenceWritable = false;
        } catch {
          // A failed read is an empty in-memory index, but not evidence that
          // existing targets were deleted. The first explicit visit can still
          // establish a fresh valid document.
          parsed = { kind: 'invalid', entries: [] };
        }

        const stored = parsed.entries;
        const current = get().entries;
        const merged = mergeHydratedEntries(stored, current, changedDuringHydration, allowed);
        set({ entries: merged, hydrated: true });
        hydrated = true;

        const changedFromStored = !sameHomeRecentEntries(stored, merged);
        const hasLocalMutation = changedDuringHydration.size > 0 || removedDuringHydration.size > 0;
        // Unknown and future versions are intentionally left alone. A valid
        // document can be rewritten to prune invalid/old rows and apply an
        // authoritative unpair allowlist. A read failure has no safe baseline
        // to rewrite, but a concurrent explicit mutation is still persistable.
        if (
          (parsed.kind === 'valid' && changedFromStored) ||
          ((parsed.kind === 'empty' || parsed.kind === 'invalid') && hasLocalMutation)
        ) {
          requestWrite();
        }
        changedDuringHydration.clear();
        removedDuringHydration.clear();
      })().catch(() => {
        // Parsing is defensive, but keep the store usable if an unexpected
        // adapter or merge failure reaches this boundary.
        set({ hydrated: true });
        hydrated = true;
        changedDuringHydration.clear();
        removedDuringHydration.clear();
      });
      return hydrationPromise;
    };

    const visit = async (
      target: HomeTarget,
      title = '',
      atMs?: number,
      sessionObservation?: HomeSessionObservation
    ): Promise<void> => {
      const entry = createHomeRecentEntry(target, title, atMs, sessionObservation);
      if (!entry) return;
      if (allowed && !isHomeRecentEntryAllowed(entry, allowed)) return;

      const visitWasDuringHydration = !hydrated;
      if (visitWasDuringHydration) changedDuringHydration.add(entry.key);
      removedDuringHydration.delete(entry.key);

      const before = get().entries;
      const next = [entry, ...before.filter((item) => item.key !== entry.key)].slice(
        0,
        MAX_HOME_RECENTS
      );
      set({ entries: next });

      await hydrate();
      if (visitWasDuringHydration) await writeDrain;
      else await requestWrite();
    };

    const observeSession = async (
      target: HomeTarget,
      observation: HomeSessionObservation
    ): Promise<void> => {
      const normalized = createHomeRecentEntry(target, '', 0, observation);
      if (!normalized?.sessionObservation) return;
      if (allowed && !isHomeRecentEntryAllowed(normalized, allowed)) return;

      let before = get().entries;
      let index = before.findIndex((item) => item.key === normalized.key);
      if (index < 0) {
        await hydrate();
        if (allowed && !isHomeRecentEntryAllowed(normalized, allowed)) return;
        before = get().entries;
        index = before.findIndex((item) => item.key === normalized.key);
        if (index < 0) return;
      }
      const current = before[index];
      const previous = current?.sessionObservation;
      if (
        !current ||
        (previous && previous.observedAtMs > normalized.sessionObservation.observedAtMs) ||
        (previous?.status === normalized.sessionObservation.status &&
          previous.observedAtMs === normalized.sessionObservation.observedAtMs)
      ) {
        await hydrate();
        return;
      }

      const observationWasDuringHydration = !hydrated;
      if (observationWasDuringHydration) changedDuringHydration.add(normalized.key);
      const next = before.slice();
      next[index] = { ...current, sessionObservation: normalized.sessionObservation };
      set({ entries: next });

      await hydrate();
      if (observationWasDuringHydration) await writeDrain;
      else await requestWrite();
    };

    const updateTitle = async (target: HomeTarget, title: string): Promise<void> => {
      const normalized = createHomeRecentEntry(target, title, 0);
      if (!normalized) return;
      if (allowed && !isHomeRecentEntryAllowed(normalized, allowed)) return;

      const before = get().entries;
      const index = before.findIndex((item) => item.key === normalized.key);
      if (index < 0) return;
      const current = before[index];
      if (!current || current.title === normalized.title) {
        await hydrate();
        return;
      }

      const titleWasDuringHydration = !hydrated;
      if (titleWasDuringHydration) changedDuringHydration.add(normalized.key);
      const next = before.slice();
      next[index] = { ...current, title: normalized.title };
      set({ entries: next });

      await hydrate();
      if (titleWasDuringHydration) await writeDrain;
      else await requestWrite();
    };

    const remove = async (target: HomeTarget): Promise<void> => {
      const normalized = createHomeRecentEntry(target, '', 0);
      if (!normalized) return;
      const key = normalized.key;
      const removeWasDuringHydration = !hydrated;
      if (removeWasDuringHydration) {
        changedDuringHydration.add(key);
        removedDuringHydration.add(key);
      }

      const before = get().entries;
      const next = before.filter((item) => item.key !== key);
      if (next.length !== before.length) set({ entries: next });

      await hydrate();
      if (removeWasDuringHydration) await writeDrain;
      else if (next.length !== before.length) await requestWrite();
    };

    const keepOnly = async (allowlist: HomeRecentsAllowlist): Promise<void> => {
      allowed = normalizeAllowlist(allowlist);
      const keepOnlyWasDuringHydration = !hydrated;
      const before = get().entries;
      const next = filterHomeRecentEntries(before, allowed);
      if (!sameHomeRecentEntries(before, next)) set({ entries: next });

      await hydrate();
      if (keepOnlyWasDuringHydration) await writeDrain;
      else if (!sameHomeRecentEntries(before, next)) await requestWrite();
    };

    return {
      hydrated: false,
      entries: [],
      hydrate,
      visit,
      updateTitle,
      observeSession,
      keepOnly,
      remove,
    };
  };
}

/** Create a standalone vanilla store for tests and non-React callers. */
export function createHomeRecentsStore(persistence: HomeRecentsPersistence) {
  return createStore<HomeRecentsState>(createHomeRecentsState(persistence));
}

type NormalizedAllowlist = {
  serverIds: readonly string[];
  hostIds: readonly string[];
};

function normalizeAllowlist(allowlist: HomeRecentsAllowlist): NormalizedAllowlist {
  return {
    serverIds: uniqueStrings(allowlist.serverIds),
    hostIds: uniqueStrings(allowlist.hostIds),
  };
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter((value) => Boolean(value)))];
}

function mergeHydratedEntries(
  stored: readonly HomeRecentEntry[],
  current: readonly HomeRecentEntry[],
  changedKeys: ReadonlySet<string>,
  allowed: NormalizedAllowlist | undefined
): HomeRecentEntry[] {
  const merged: HomeRecentEntry[] = [];
  const seen = new Set<string>();
  const append = (entry: HomeRecentEntry): void => {
    if (merged.length >= MAX_HOME_RECENTS) return;
    if (seen.has(entry.key) || (allowed && !isHomeRecentEntryAllowed(entry, allowed))) return;
    seen.add(entry.key);
    merged.push(entry);
  };

  // Current entries are only authoritative for keys explicitly touched while
  // the read was pending. Stored rows keep their persisted order otherwise.
  for (const entry of current) {
    if (changedKeys.has(entry.key)) append(entry);
  }
  for (const entry of stored) {
    if (!changedKeys.has(entry.key)) append(entry);
  }
  return merged;
}

function sameHomeRecentEntries(
  left: readonly HomeRecentEntry[],
  right: readonly HomeRecentEntry[]
): boolean {
  if (left.length !== right.length) return false;
  return left.every((entry, index) => {
    const other = right[index];
    return (
      entry.key === other.key &&
      entry.title === other.title &&
      entry.atMs === other.atMs &&
      entry.sessionObservation?.status === other.sessionObservation?.status &&
      entry.sessionObservation?.observedAtMs === other.sessionObservation?.observedAtMs &&
      homeTargetKey(entry.target) === homeTargetKey(other.target)
    );
  });
}
