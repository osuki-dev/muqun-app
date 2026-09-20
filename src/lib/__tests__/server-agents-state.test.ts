import { describe, expect, test } from 'bun:test';

import type { ServerAgentsIndex, ServerAgentsSnapshot } from '../server-agents';
import { createServerAgentsStore } from '../server-agents-state';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function snapshot(serverId: string, checkedAtMs: number, name = 'Codex'): ServerAgentsSnapshot {
  return {
    serverId,
    checkedAtMs,
    agents: [
      {
        id: `${serverId}-agent`,
        name,
        status: 'idle',
        hasAgent: true,
      },
    ],
  };
}

function emptySnapshot(serverId: string, checkedAtMs: number): ServerAgentsSnapshot {
  return { serverId, checkedAtMs, agents: [] };
}

function persistence(
  initial: ServerAgentsIndex = {},
  save: (index: ServerAgentsIndex) => Promise<void> = async () => {}
) {
  return {
    load: async () => initial,
    save,
  };
}

describe('server agents state', () => {
  test('a record before hydration waits for its merged snapshot to finish saving', async () => {
    const saving = deferred<void>();
    const started = deferred<void>();
    const store = createServerAgentsStore({
      load: async () => ({}),
      save: async () => {
        started.resolve();
        await saving.promise;
      },
    });
    let finished = false;
    const recorded = store
      .getState()
      .record(snapshot('live', 20))
      .then(() => {
        finished = true;
      });
    await started.promise;
    await Promise.resolve();
    expect(finished).toBe(false);
    saving.resolve();
    await recorded;
    expect(finished).toBe(true);
  });

  test('keeps a record made during a deferred hydrate and preserves unrelated stored servers', async () => {
    const load = deferred<ServerAgentsIndex>();
    const saved: ServerAgentsIndex[] = [];
    const store = createServerAgentsStore({
      load: () => load.promise,
      save: async (index) => {
        saved.push(index);
      },
    });

    const hydrating = store.getState().hydrate();
    const recorded = store.getState().record(snapshot('live', 20));
    expect(store.getState().hydrated).toBe(false);
    expect(store.getState().byServer.live).toBeDefined();
    load.resolve({ old: snapshot('old', 10), live: snapshot('live', 10, 'stored') });

    await Promise.all([hydrating, recorded]);
    expect(Object.keys(store.getState().byServer).sort()).toEqual(['live', 'old']);
    expect(store.getState().byServer.live.agents[0].name).toBe('Codex');
    expect(saved).toHaveLength(1);
    expect(saved.at(-1)).toEqual(store.getState().byServer);
  });

  test('applies keepOnly to a pending load and persists the unpair', async () => {
    const load = deferred<ServerAgentsIndex>();
    const saved: ServerAgentsIndex[] = [];
    const store = createServerAgentsStore({
      load: () => load.promise,
      save: async (index) => {
        saved.push(index);
      },
    });

    const hydrating = store.getState().hydrate();
    const unpairing = store.getState().keepOnly(['paired']);
    load.resolve({ paired: snapshot('paired', 2), removed: snapshot('removed', 3) });

    await Promise.all([hydrating, unpairing]);
    expect(Object.keys(store.getState().byServer)).toEqual(['paired']);
    expect(saved).toHaveLength(1);
    expect(Object.keys(saved[0])).toEqual(['paired']);
  });

  test('concurrent hydrate callers share one read and one promise', async () => {
    const load = deferred<ServerAgentsIndex>();
    let reads = 0;
    const store = createServerAgentsStore({
      load: () => {
        reads++;
        return load.promise;
      },
      save: async () => {},
    });

    const first = store.getState().hydrate();
    const second = store.getState().hydrate();
    expect(first).toBe(second);
    expect(reads).toBe(1);
    load.resolve({});
    await first;
    expect(store.getState().hydrated).toBe(true);
  });

  test('marks hydration complete after a read failure and later writes still work', async () => {
    const saved: ServerAgentsIndex[] = [];
    const store = createServerAgentsStore({
      load: async () => {
        throw new Error('keychain unavailable');
      },
      save: async (index) => {
        saved.push(index);
      },
    });

    await store.getState().hydrate();
    expect(store.getState().hydrated).toBe(true);
    await store.getState().record(snapshot('s1', 4));
    expect(saved).toHaveLength(1);
    expect(saved[0].s1).toBeDefined();
  });

  test('serializes overlapping saves and leaves the newest snapshot last after a write error', async () => {
    const writes: ServerAgentsIndex[] = [];
    const firstWrite = deferred<void>();
    const secondWrite = deferred<void>();
    const store = createServerAgentsStore(
      persistence({}, async (index) => {
        writes.push(index);
        if (writes.length === 1) {
          await firstWrite.promise;
          throw new Error('transient keychain error');
        }
        await secondWrite.promise;
      })
    );
    await store.getState().hydrate();

    const first = store.getState().record(snapshot('s1', 1));
    await Promise.resolve();
    await Promise.resolve();
    expect(writes).toHaveLength(1);
    const second = store.getState().record(snapshot('s1', 2, 'newer'));
    expect(writes).toHaveLength(1);
    firstWrite.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(writes).toHaveLength(2);
    secondWrite.resolve();
    // The first failed save is swallowed and the queued latest state proceeds.
    await Promise.all([first, second]);
    expect(writes[0].s1.agents[0].name).toBe('Codex');
    expect(writes[1].s1.agents[0].name).toBe('newer');
  });

  test('does not regress on an older observation, accepts an equal-time tie in call order, and reuses rows', async () => {
    const store = createServerAgentsStore(persistence());
    await store.getState().hydrate();
    await store.getState().record(snapshot('s1', 20, 'new'));
    const rows = store.getState().byServer.s1.agents;
    await store.getState().record(snapshot('s1', 19, 'old'));
    expect(store.getState().byServer.s1.checkedAtMs).toBe(20);
    await store.getState().record(snapshot('s1', 21, 'new'));
    expect(store.getState().byServer.s1.agents).toBe(rows);
    await store.getState().record(snapshot('s1', 21, 'tie'));
    expect(store.getState().byServer.s1.agents[0].name).toBe('tie');
  });

  test('refreshes only the timestamp in memory without writing equal rows again', async () => {
    const saved: ServerAgentsIndex[] = [];
    const store = createServerAgentsStore(
      persistence({}, async (index) => {
        saved.push(index);
      })
    );
    await store.getState().hydrate();
    await store.getState().record(snapshot('s1', 10));
    const rows = store.getState().byServer.s1.agents;
    await store.getState().record(snapshot('s1', 11));
    expect(saved).toHaveLength(1);
    expect(store.getState().byServer.s1.checkedAtMs).toBe(11);
    expect(store.getState().byServer.s1.agents).toBe(rows);
  });

  test('recovers from a synchronous save throw on the next write', async () => {
    const saved: ServerAgentsIndex[] = [];
    let attempts = 0;
    const store = createServerAgentsStore({
      load: async () => ({}),
      save: (index) => {
        attempts++;
        if (attempts === 1) throw new Error('synchronous keychain error');
        saved.push(index);
        return Promise.resolve();
      },
    });
    await store.getState().hydrate();
    await store.getState().record(snapshot('s1', 1));
    await store.getState().record(snapshot('s1', 2, 'second'));
    expect(attempts).toBe(2);
    expect(saved.at(-1)?.s1.agents[0].name).toBe('second');
  });

  test('keeps an explicit empty snapshot distinct from a missing server', async () => {
    const saved: ServerAgentsIndex[] = [];
    const store = createServerAgentsStore(
      persistence({}, async (index) => {
        saved.push(index);
      })
    );
    await store.getState().hydrate();
    await store.getState().record(emptySnapshot('empty', 7));
    expect(store.getState().byServer.empty).toEqual(emptySnapshot('empty', 7));
    expect(saved.at(-1)?.empty).toEqual(emptySnapshot('empty', 7));
    expect(store.getState().byServer.missing).toBeUndefined();
  });

  test('does not resurrect an unpaired server until a later keepOnly re-allows it', async () => {
    const saved: ServerAgentsIndex[] = [];
    const store = createServerAgentsStore(
      persistence({ removed: snapshot('removed', 1) }, async (index) => {
        saved.push(index);
      })
    );
    await store.getState().keepOnly([]);
    await store.getState().record(snapshot('removed', 2, 'blocked'));
    expect(store.getState().byServer.removed).toBeUndefined();
    await store.getState().keepOnly(['removed']);
    await store.getState().record(snapshot('removed', 3, 'allowed'));
    expect(store.getState().byServer.removed?.agents[0].name).toBe('allowed');
    expect(saved.at(-1)?.removed?.agents[0].name).toBe('allowed');
  });
});
