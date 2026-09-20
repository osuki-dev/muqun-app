import { createStore, type StateCreator } from 'zustand/vanilla';

import {
  keepMirroredServers,
  normalizeServerAgents,
  sameServerAgents,
  type ServerAgentsIndex,
  type ServerAgentsSnapshot,
} from './server-agents';

/** The two asynchronous edges of the Home mirror, kept out of the state core. */
export type ServerAgentsPersistence = {
  load: () => Promise<ServerAgentsIndex>;
  save: (index: ServerAgentsIndex) => Promise<void>;
};

export type ServerAgentsState = {
  /** True only after the first load has settled, including a failed load. */
  hydrated: boolean;
  byServer: ServerAgentsIndex;
  hydrate: () => Promise<void>;
  record: (snapshot: ServerAgentsSnapshot) => Promise<void>;
  keepOnly: (serverIds: readonly string[]) => Promise<void>;
};

/**
 * Creates the Home mirror's state machine.
 *
 * The closure is deliberately per store. In particular, a test store and the
 * app store must never share a hydration flight or a write queue.
 */
export function createServerAgentsState(
  persistence: ServerAgentsPersistence
): StateCreator<ServerAgentsState> {
  return (set, get) => {
    let hydrationPromise: Promise<void> | undefined;
    let hydrated = false;
    let allowedServerIds: Set<string> | undefined;
    /** Records touched while the storage read was in flight. */
    const liveDuringHydration = new Set<string>();

    // Writes are coalesced to the newest in-memory index, but never overlap.
    // Each waiter resolves after the drain has observed its requested write;
    // failures are intentionally swallowed so a rejected save cannot strand
    // later saves behind a permanently rejected promise.
    let writeRequested = false;
    let writeDrain: Promise<void> | undefined;
    let writeWaiters: (() => void)[] = [];

    const requestWrite = (): Promise<void> => {
      writeRequested = true;
      const done = new Promise<void>((resolve) => writeWaiters.push(resolve));
      startWriteDrain();
      return done;
    };

    const startWriteDrain = (): void => {
      if (!hydrated || writeDrain || !writeRequested) return;
      // Put the body behind a microtask before assigning `writeDrain`. An
      // adapter is allowed to throw synchronously; without this boundary its
      // `finally` could clear the variable before the assignment completed,
      // stranding every later request behind a resolved promise.
      writeDrain = Promise.resolve().then(async () => {
        try {
          while (writeRequested) {
            writeRequested = false;
            // The current map is replaced, never mutated in place. Taking a
            // shallow copy here also prevents a persistence adapter from
            // observing a later map replacement through its argument.
            const index = { ...get().byServer };
            try {
              await persistence.save(index);
            } catch {
              // The memory mirror remains useful for this launch. Continue to
              // drain if a later mutation asks for another snapshot.
            }
          }
        } finally {
          writeDrain = undefined;
          const waiters = writeWaiters;
          writeWaiters = [];
          for (const resolve of waiters) resolve();
          // A synchronous mutation can request another write just as the
          // final await resumes. Start it after publishing this drain's end.
          startWriteDrain();
        }
      });
    };

    const hydrate = (): Promise<void> => {
      if (hydrationPromise) return hydrationPromise;

      hydrationPromise = (async () => {
        try {
          let stored: ServerAgentsIndex = {};
          try {
            stored = boundedIndex(await persistence.load());
          } catch {
            // An unreadable mirror is equivalent to an empty one. The state is
            // still hydrated: callers must not wait forever for a failed read.
            stored = {};
          }

          const beforeLoad = get().byServer;
          const storedVisible = filterAllowed(stored, allowedServerIds);
          const merged: ServerAgentsIndex = {};

          for (const [serverId, snapshot] of Object.entries(storedVisible)) {
            if (liveDuringHydration.has(serverId) && beforeLoad[serverId]) {
              merged[serverId] = beforeLoad[serverId];
            } else {
              merged[serverId] = snapshot;
            }
          }
          // A live record can introduce a server absent from storage. The
          // allowlist is authoritative if keepOnly raced the read.
          for (const [serverId, snapshot] of Object.entries(beforeLoad)) {
            if (merged[serverId]) continue;
            if (allowedServerIds && !allowedServerIds.has(serverId)) continue;
            merged[serverId] = snapshot;
          }

          const next = boundedIndex(merged);
          set({ byServer: next, hydrated: true });
          hydrated = true;

          // Only persist a real content change. A newer timestamp with identical
          // rows is useful in memory but is intentionally an equal-content write
          // suppression case.
          // Compare with the complete stored baseline. Filtering an unpaired
          // id out of `storedVisible` is itself a disk change that must be
          // written, otherwise it would return on the next launch.
          if (!sameIndexForPersistence(stored, next)) requestWrite();
        } catch {
          // Keep the public promise successful while making the state usable.
          // A failed read must not leave `hydrated` false forever.
          set({ hydrated: true });
          hydrated = true;
        }
      })();
      return hydrationPromise;
    };

    const record = (snapshot: ServerAgentsSnapshot): Promise<void> => {
      const next = normalizeServerAgents(snapshot);
      if (allowedServerIds && !allowedServerIds.has(next.serverId)) return Promise.resolve();

      const recordWasDuringHydration = !hydrated;
      const before = get().byServer;
      const previous = before[next.serverId];
      // An observation from an older poll must never regress the card. Equal
      // timestamps are accepted in call order; wall-clock ties cannot provide
      // a stronger ordering signal.
      if (previous && next.checkedAtMs < previous.checkedAtMs) return Promise.resolve();

      let replacement: ServerAgentsSnapshot;
      if (previous && sameServerAgents(previous, next)) {
        if (previous.checkedAtMs === next.checkedAtMs) return Promise.resolve();
        // Keep the existing rows array. Rows are immutable snapshots and this
        // avoids invalidating list consumers when only the age changed.
        replacement = { ...previous, checkedAtMs: next.checkedAtMs, agents: previous.agents };
      } else {
        replacement = next;
      }

      const nextIndex = boundedIndex({ ...before, [next.serverId]: replacement });
      if (nextIndex !== before) set({ byServer: nextIndex });
      if (!hydrated) liveDuringHydration.add(next.serverId);

      const contentChanged = !sameIndexForPersistence(before, nextIndex);
      const finish = async (): Promise<void> => {
        await hydrate();
        // A pending hydrate compares the complete merged map against its
        // stored baseline and schedules one write when needed. Let that single
        // comparison cover records made during the read too.
        if (recordWasDuringHydration) await writeDrain;
        else if (contentChanged) await requestWrite();
      };
      return finish();
    };

    const keepOnly = (serverIds: readonly string[]): Promise<void> => {
      // Set this before starting or joining hydrate. It is the authority that
      // filters the pending read and prevents a later record from resurrecting
      // an unpaired server.
      allowedServerIds = new Set(serverIds);
      const keepOnlyWasDuringHydration = !hydrated;
      const before = get().byServer;
      const nextIndex = boundedIndex(keepMirroredServers(before, serverIds));
      if (!sameIndexForMemory(before, nextIndex)) set({ byServer: nextIndex });
      const changed = !sameIndexForPersistence(before, nextIndex);

      const finish = async (): Promise<void> => {
        await hydrate();
        if (keepOnlyWasDuringHydration) await writeDrain;
        else if (changed) await requestWrite();
      };
      return finish();
    };

    return {
      hydrated: false,
      byServer: {},
      hydrate,
      record,
      keepOnly,
    };
  };
}

/** Create a standalone vanilla store for unit tests and non-React callers. */
export function createServerAgentsStore(persistence: ServerAgentsPersistence) {
  return createStore<ServerAgentsState>(createServerAgentsState(persistence));
}

function boundedIndex(index: ServerAgentsIndex | undefined): ServerAgentsIndex {
  if (!index) return {};
  return keepMirroredServers(index, Object.keys(index));
}

function filterAllowed(
  index: ServerAgentsIndex,
  allowed: Set<string> | undefined
): ServerAgentsIndex {
  if (!allowed) return index;
  return keepMirroredServers(index, [...allowed]);
}

/** Equal-content comparison for persistence suppression; timestamps are age metadata. */
function sameIndexForPersistence(a: ServerAgentsIndex, b: ServerAgentsIndex): boolean {
  const aIds = Object.keys(a);
  const bIds = Object.keys(b);
  if (aIds.length !== bIds.length) return false;
  return aIds.every(
    (serverId) => Boolean(b[serverId]) && sameServerAgents(a[serverId], b[serverId])
  );
}

/** Detects a map replacement even when rows are content-identical but timestamped newer. */
function sameIndexForMemory(a: ServerAgentsIndex, b: ServerAgentsIndex): boolean {
  const aIds = Object.keys(a);
  const bIds = Object.keys(b);
  if (aIds.length !== bIds.length) return false;
  return aIds.every((serverId) => {
    const left = a[serverId];
    const right = b[serverId];
    return (
      left === right ||
      (Boolean(left) &&
        Boolean(right) &&
        left.checkedAtMs === right.checkedAtMs &&
        sameServerAgents(left, right))
    );
  });
}
