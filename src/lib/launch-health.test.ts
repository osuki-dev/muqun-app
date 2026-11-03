import { describe, expect, test } from 'bun:test';
import {
  createLaunchHealth,
  FAILED_LAUNCH_LIMIT,
  LAUNCH_HEALTH_KEY,
  type LaunchHealthStore,
  type LaunchHealthUpdater,
} from './launch-health';

const BUILT_IN = '00000000-0000-0000-0000-000000000000';
const DOWNLOADED = '0199ab12-0000-7000-8000-000000000001';

function memoryStore(initial?: string): LaunchHealthStore & { raw: () => string | undefined } {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(LAUNCH_HEALTH_KEY, initial);
  return {
    getString: (key) => values.get(key),
    set: (key, value) => void values.set(key, value),
    raw: () => values.get(LAUNCH_HEALTH_KEY),
  };
}

function fakeUpdater(bundleId: string, resetChannel: () => Promise<boolean> = async () => true) {
  const calls: string[] = [];
  const updater: LaunchHealthUpdater = {
    getBundleId: () => bundleId,
    getMinBundleId: () => BUILT_IN,
    notifyAppReady: () => {
      calls.push('notifyAppReady');
      return { status: 'RECOVERED', fromBundleId: DOWNLOADED, toBundleId: BUILT_IN };
    },
    resetChannel: () => {
      calls.push('resetChannel');
      return resetChannel();
    },
    reload: async () => {
      calls.push('reload');
    },
  };
  return { updater, calls };
}

describe('launch health', () => {
  test('a settled launch reads the native launch report and forgives earlier failures', () => {
    const store = memoryStore(JSON.stringify({ bundleId: DOWNLOADED, failures: 1 }));
    const { updater, calls } = fakeUpdater(DOWNLOADED);
    const log: string[] = [];
    const health = createLaunchHealth({ updater, store, log: (m) => log.push(m) });
    expect(store.raw()).toBe(JSON.stringify({ bundleId: DOWNLOADED, failures: 1 }));

    health.markHealthy();
    expect(calls).toEqual(['notifyAppReady']);
    expect(store.raw()).toBe(JSON.stringify({ bundleId: DOWNLOADED, failures: 0 }));
    expect(log.at(-1)).toBe(`launch healthy, report=RECOVERED from=${DOWNLOADED} to=${BUILT_IN}`);
  });

  test('a downloaded bundle is rolled back once its failures reach the limit', async () => {
    // The count survives the process: one failure per launch, or the boundary's own retry.
    const paths = [
      { name: 'across launches', launches: [1, 1] },
      { name: 'retried in one launch', launches: [FAILED_LAUNCH_LIMIT] },
    ];
    for (const path of paths) {
      const store = memoryStore();
      let last: ReturnType<typeof fakeUpdater> | undefined;
      for (const failures of path.launches) {
        last = fakeUpdater(DOWNLOADED);
        const health = createLaunchHealth({ updater: last.updater, store });
        for (let i = 0; i < failures; i += 1) await health.reportRenderFailure();
      }
      expect({ path: path.name, calls: last?.calls }).toEqual({
        path: path.name,
        calls: ['resetChannel', 'reload'],
      });
    }
  });

  test('a failure before the limit, after settling, or of another bundle rolls nothing back', async () => {
    const cases = [
      { name: 'first failure', stored: undefined, bundleId: DOWNLOADED, settled: false },
      {
        name: 'another bundle failed before',
        stored: { bundleId: 'older-bundle', failures: 5 },
        bundleId: DOWNLOADED,
        settled: false,
      },
      {
        name: 'a screen fails after the launch settled',
        stored: { bundleId: DOWNLOADED, failures: 1 },
        bundleId: DOWNLOADED,
        settled: true,
      },
      {
        name: 'the built-in bundle has nothing to fall back to',
        stored: { bundleId: BUILT_IN, failures: 9 },
        bundleId: BUILT_IN,
        settled: false,
      },
    ];
    for (const c of cases) {
      const store = memoryStore(c.stored && JSON.stringify(c.stored));
      const { updater, calls } = fakeUpdater(c.bundleId);
      const health = createLaunchHealth({ updater, store });
      if (c.settled) health.markHealthy();
      await health.reportRenderFailure();
      expect({ case: c.name, calls: calls.filter((call) => call !== 'notifyAppReady') }).toEqual({
        case: c.name,
        calls: [],
      });
    }
  });

  test('a failing rollback, a corrupt record, or no updater never throws into the boundary', async () => {
    const refused = fakeUpdater(DOWNLOADED, async () => false);
    const corrupt = createLaunchHealth({ updater: refused.updater, store: memoryStore('{nope') });
    await corrupt.reportRenderFailure();
    await corrupt.reportRenderFailure();
    expect(refused.calls).toEqual(['resetChannel']);

    const throwing = fakeUpdater(DOWNLOADED, () => Promise.reject(new Error('busy')));
    const failing = createLaunchHealth({
      updater: throwing.updater,
      store: memoryStore(JSON.stringify({ bundleId: DOWNLOADED, failures: 1 })),
    });
    expect(await failing.reportRenderFailure()).toBeUndefined();
    expect(throwing.calls).toEqual(['resetChannel']);

    const none = createLaunchHealth({ updater: null, store: memoryStore() });
    none.markHealthy();
    expect(await none.reportRenderFailure()).toBeUndefined();
  });
});
