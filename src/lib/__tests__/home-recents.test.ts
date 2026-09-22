import { describe, expect, test } from 'bun:test';

import {
  HOME_RECENTS_STORAGE_VERSION,
  MAX_HOME_RECENTS,
  homeTargetKey,
  parseHomeRecentsDocument,
  serializeHomeRecents,
  type HomeRecentEntry,
  type HomeTarget,
} from '../home-recents';
import { createHomeRecentsStore } from '../home-recents-state';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function terminal(serverId: string, paneId = `${serverId}-pane`): HomeTarget {
  return {
    kind: 'gateway-terminal',
    serverId,
    sessionId: `${serverId}-routing`,
    paneId,
  };
}

function opencode(serverId: string, asid = `${serverId}-asid`): HomeTarget {
  return {
    kind: 'opencode-session',
    serverId,
    sessionId: `${serverId}-routing`,
    directory: '/work/project',
    asid,
  };
}

function ssh(hostId: string): HomeTarget {
  return { kind: 'ssh-host', hostId };
}

function entry(target: HomeTarget, title = 'Terminal', atMs = 1): HomeRecentEntry {
  const parsed = parseHomeRecentsDocument(
    serializeHomeRecents([{ key: homeTargetKey(target), target, title, atMs }])
  );
  if (parsed.kind !== 'valid' || !parsed.entries[0]) throw new Error('invalid test entry');
  return parsed.entries[0];
}

describe('home recents domain', () => {
  test('keys every target field with a structured discriminant', () => {
    expect(homeTargetKey(terminal('server:one', 'pane/two'))).not.toBe(
      homeTargetKey(terminal('server', 'one:pane/two'))
    );
    expect(homeTargetKey(opencode('same', 'session'))).not.toBe(
      homeTargetKey(terminal('same', 'session'))
    );
    expect(homeTargetKey(ssh('host-1'))).not.toBe(homeTargetKey(ssh('host-2')));
  });

  test('parses only the versioned safe whitelist', () => {
    const parsed = parseHomeRecentsDocument(
      JSON.stringify({
        version: HOME_RECENTS_STORAGE_VERSION,
        entries: [
          {
            target: opencode('server-1'),
            title: '  Build\u0000 notes  ',
            atMs: 12,
            transcript: 'do not persist this',
            password: 'do not persist this either',
          },
        ],
      })
    );
    expect(parsed.kind).toBe('valid');
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0]).toMatchObject({ title: 'Build notes', atMs: 12 });
    expect(serializeHomeRecents(parsed.entries)).not.toContain('do not persist');
  });

  test('round-trips only valid OpenCode observations and remains backward compatible', () => {
    const valid = entry(opencode('server-1'), 'Build', 12);
    valid.sessionObservation = { status: 'retry', observedAtMs: 20 };
    const parsed = parseHomeRecentsDocument(serializeHomeRecents([valid]));
    expect(parsed.kind).toBe('valid');
    expect(parsed.entries[0]?.sessionObservation).toEqual({ status: 'retry', observedAtMs: 20 });

    const malformed = parseHomeRecentsDocument(
      JSON.stringify({
        version: HOME_RECENTS_STORAGE_VERSION,
        entries: [
          { target: opencode('server-2'), title: 'Old', atMs: 3 },
          {
            target: opencode('server-3'),
            title: 'Bad',
            atMs: 4,
            sessionObservation: { status: 'invented', observedAtMs: 5 },
          },
          {
            target: terminal('server-4'),
            title: 'Pane',
            atMs: 5,
            sessionObservation: { status: 'busy', observedAtMs: 6 },
          },
        ],
      })
    );
    expect(malformed.entries.map((item) => item.sessionObservation)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  test('falls back for unknown data and future versions without throwing', () => {
    expect(parseHomeRecentsDocument('not json')).toMatchObject({ kind: 'invalid', entries: [] });
    expect(parseHomeRecentsDocument(JSON.stringify({ version: 99, entries: [] }))).toMatchObject({
      kind: 'future',
      entries: [],
    });
    expect(parseHomeRecentsDocument(JSON.stringify({ version: 1, entries: 'wrong' }))).toEqual({
      kind: 'valid',
      entries: [],
    });
  });

  test('preserves explicit order, scopes duplicate titles, and caps the index', async () => {
    const store = createHomeRecentsStore({
      load: async () => null,
      save: async () => {},
    });
    await store.getState().hydrate();
    await store.getState().visit(terminal('server-a'), 'Logs', 10);
    await store.getState().visit(terminal('server-b'), 'Logs', 1);
    expect(store.getState().entries.map((item) => item.title)).toEqual(['Logs', 'Logs']);
    expect(store.getState().entries[0]?.target).toEqual(terminal('server-b'));

    for (let index = 0; index < MAX_HOME_RECENTS + 2; index++) {
      await store.getState().visit(ssh(`host-${index}`), `Host ${index}`, index + 20);
    }
    expect(store.getState().entries).toHaveLength(MAX_HOME_RECENTS);
    expect(store.getState().entries[0]?.target).toEqual(ssh(`host-${MAX_HOME_RECENTS + 1}`));
    expect(store.getState().entries.at(-1)?.target).toEqual(ssh('host-2'));
  });

  test('uses explicit visit order even when a revisit has an older timestamp', async () => {
    const store = createHomeRecentsStore({
      load: async () => null,
      save: async () => {},
    });
    await store.getState().visit(terminal('first'), 'First', 200);
    await store.getState().visit(terminal('second'), 'Second', 300);
    await store.getState().visit(terminal('first'), 'First again', 100);

    expect(store.getState().entries.map((item) => item.target)).toEqual([
      terminal('first'),
      terminal('second'),
    ]);
    expect(store.getState().entries[0]?.atMs).toBe(100);
  });

  test('updates a title in place without creating or reordering a recent visit', async () => {
    const saved: string[] = [];
    const store = createHomeRecentsStore({
      load: async () => null,
      save: async (value) => {
        saved.push(value);
      },
    });
    await store.getState().hydrate();
    await store.getState().visit(terminal('first'), 'ses_first', 10);
    await store.getState().visit(terminal('second'), 'Second', 20);

    await store.getState().updateTitle(terminal('first'), '  Real\u0000 title  ');

    expect(store.getState().entries.map((item) => item.title)).toEqual(['Second', 'Real title']);
    expect(store.getState().entries[1]).toMatchObject({
      key: homeTargetKey(terminal('first')),
      target: terminal('first'),
      atMs: 10,
    });
    await store.getState().updateTitle(terminal('missing'), 'Should not appear');
    expect(store.getState().entries).toHaveLength(2);
    expect(JSON.parse(saved.at(-1) as string).entries[1]).toMatchObject({
      target: terminal('first'),
      title: 'Real title',
      atMs: 10,
    });
  });
});

describe('home recents state', () => {
  test('observes a stored OpenCode recent after cold hydration without reordering it', async () => {
    const target = opencode('stored');
    const saved: string[] = [];
    const store = createHomeRecentsStore({
      load: async () =>
        serializeHomeRecents([
          entry(ssh('newer'), 'Newer', 20),
          entry(target, 'Stored session', 10),
        ]),
      save: async (value) => {
        saved.push(value);
      },
    });

    await store.getState().observeSession(target, { status: 'busy', observedAtMs: 30 });

    expect(store.getState().entries.map((item) => item.title)).toEqual(['Newer', 'Stored session']);
    expect(store.getState().entries[1]).toMatchObject({
      atMs: 10,
      sessionObservation: { status: 'busy', observedAtMs: 30 },
    });
    expect(JSON.parse(saved.at(-1) as string).entries[1].sessionObservation).toEqual({
      status: 'busy',
      observedAtMs: 30,
    });
  });

  test('observations never create visits or replace a newer observation', async () => {
    const target = opencode('observed');
    const store = createHomeRecentsStore({ load: async () => null, save: async () => {} });
    await store.getState().observeSession(target, { status: 'busy', observedAtMs: 5 });
    expect(store.getState().entries).toEqual([]);

    await store.getState().visit(target, 'Observed', 1, {
      status: 'idle',
      observedAtMs: 20,
    });
    await store.getState().observeSession(target, { status: 'failed', observedAtMs: 10 });
    expect(store.getState().entries[0]).toMatchObject({
      atMs: 1,
      sessionObservation: { status: 'idle', observedAtMs: 20 },
    });
  });

  test('caps a hydrated merge while keeping every newer explicit visit first', async () => {
    const load = deferred<string | null>();
    const store = createHomeRecentsStore({ load: () => load.promise, save: async () => {} });
    const stored = Array.from({ length: MAX_HOME_RECENTS }, (_, index) =>
      entry(ssh(`stored-${index}`))
    );
    const hydrating = store.getState().hydrate();
    const firstVisit = store.getState().visit(ssh('new-first'), 'First', 2);
    const secondVisit = store.getState().visit(ssh('new-second'), 'Second', 3);
    load.resolve(serializeHomeRecents(stored));
    await Promise.all([hydrating, firstVisit, secondVisit]);

    expect(store.getState().entries).toHaveLength(MAX_HOME_RECENTS);
    expect(store.getState().entries.map((item) => item.target)).toEqual([
      ssh('new-second'),
      ssh('new-first'),
      ...stored.slice(0, MAX_HOME_RECENTS - 2).map((item) => item.target),
    ]);
  });

  test('keeps an explicit visit made while hydration is pending', async () => {
    const load = deferred<string | null>();
    const store = createHomeRecentsStore({
      load: () => load.promise,
      save: async () => {},
    });
    const stored = serializeHomeRecents([entry(terminal('stored'), 'Stored', 1)]);
    const hydrating = store.getState().hydrate();
    const visiting = store.getState().visit(terminal('visited'), 'Visited', 2);
    load.resolve(stored);
    await Promise.all([hydrating, visiting]);

    expect(store.getState().entries.map((item) => item.title)).toEqual(['Visited', 'Stored']);
  });

  test('does not resurrect an unpaired target when keepOnly races a pending read', async () => {
    const load = deferred<string | null>();
    const saved: string[] = [];
    const store = createHomeRecentsStore({
      load: () => load.promise,
      save: async (value) => {
        saved.push(value);
      },
    });
    const hydrating = store.getState().hydrate();
    const pruning = store.getState().keepOnly({ serverIds: ['kept'], hostIds: ['host-kept'] });
    load.resolve(
      serializeHomeRecents([
        entry(terminal('kept'), 'Kept', 3),
        entry(terminal('removed'), 'Removed', 2),
        entry(ssh('host-kept'), 'Host', 1),
        entry(ssh('host-removed'), 'Old host', 0),
      ])
    );
    await Promise.all([hydrating, pruning]);

    expect(store.getState().entries.map((item) => item.title)).toEqual(['Kept', 'Host']);
    expect(saved).toHaveLength(1);
    expect(JSON.parse(saved[0] as string).entries).toHaveLength(2);
  });

  test('a remove made during hydration wins over the stored row', async () => {
    const load = deferred<string | null>();
    const store = createHomeRecentsStore({
      load: () => load.promise,
      save: async () => {},
    });
    const hydrating = store.getState().hydrate();
    const removing = store.getState().remove(terminal('removed'));
    load.resolve(serializeHomeRecents([entry(terminal('removed'), 'Gone', 3)]));
    await Promise.all([hydrating, removing]);
    expect(store.getState().entries).toEqual([]);
  });

  test('a title update cannot revive a row removed during hydration', async () => {
    const load = deferred<string | null>();
    const saved: string[] = [];
    const store = createHomeRecentsStore({
      load: () => load.promise,
      save: async (value) => {
        saved.push(value);
      },
    });
    const target = terminal('removed-title');
    const hydrating = store.getState().hydrate();
    const removing = store.getState().remove(target);
    const updating = store.getState().updateTitle(target, 'New title');
    load.resolve(serializeHomeRecents([entry(target, 'Old title', 3)]));

    await Promise.all([hydrating, removing, updating]);

    expect(store.getState().entries).toEqual([]);
    expect(JSON.parse(saved.at(-1) as string).entries).toEqual([]);
  });

  test('a title update made during hydration keeps the current order and timestamp', async () => {
    const load = deferred<string | null>();
    const saved: string[] = [];
    const store = createHomeRecentsStore({
      load: () => load.promise,
      save: async (value) => {
        saved.push(value);
      },
    });
    const target = terminal('renamed-title');
    const hydrating = store.getState().hydrate();
    const visiting = store.getState().visit(target, 'ses_renamed-title', 8);
    const updating = store.getState().updateTitle(target, 'Real title');
    load.resolve(
      serializeHomeRecents([entry(target, 'Old title', 2), entry(ssh('other'), 'Other')])
    );

    await Promise.all([hydrating, visiting, updating]);

    expect(store.getState().entries[0]).toMatchObject({
      target,
      title: 'Real title',
      atMs: 8,
    });
    expect(store.getState().entries[1]?.target).toEqual(ssh('other'));
    expect(JSON.parse(saved.at(-1) as string).entries[0]).toMatchObject({
      target,
      title: 'Real title',
      atMs: 8,
    });
  });

  test('read failure still hydrates and later writes recover after a save error', async () => {
    let attempts = 0;
    const saved: string[] = [];
    const store = createHomeRecentsStore({
      load: async () => {
        throw new Error('keychain unavailable');
      },
      save: async (value) => {
        attempts++;
        if (attempts === 1) throw new Error('temporary save failure');
        saved.push(value);
      },
    });

    await store.getState().hydrate();
    expect(store.getState().hydrated).toBe(true);
    await store.getState().visit(terminal('first'), 'First', 1);
    await store.getState().visit(terminal('second'), 'Second', 2);
    expect(attempts).toBe(2);
    expect(JSON.parse(saved[0] as string).entries[0].target).toEqual(terminal('second'));
  });

  test('does not overwrite a future document after in-memory mutations', async () => {
    const future = JSON.stringify({ version: HOME_RECENTS_STORAGE_VERSION + 1, entries: [] });
    const saved: string[] = [];
    const store = createHomeRecentsStore({
      load: async () => future,
      save: async (value) => {
        saved.push(value);
      },
    });

    await store.getState().hydrate();
    await store.getState().visit(terminal('future'), 'Future', 1);
    await store.getState().remove(terminal('future'));
    await store.getState().keepOnly({ serverIds: [], hostIds: [] });
    expect(store.getState().entries).toEqual([]);
    expect(saved).toEqual([]);
  });

  test('offline or missing state does not delete recents without an allowlist', async () => {
    const store = createHomeRecentsStore({
      load: async () => serializeHomeRecents([entry(terminal('offline'), 'Offline', 1)]),
      save: async () => {},
    });
    await store.getState().hydrate();
    expect(store.getState().entries[0]?.target).toEqual(terminal('offline'));
  });
});
