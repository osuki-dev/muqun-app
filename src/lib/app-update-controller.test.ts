import { describe, expect, test } from 'bun:test';
import {
  createAppUpdateController,
  type UpdateClient,
  type UpdateSnapshot,
} from './app-update-controller';

function fixture(check: UpdateClient['checkForUpdate']) {
  const states: UpdateSnapshot[] = [];
  let listener = (_event: { progress: number }) => {};
  let removed = 0;
  let time = 0;
  const controller = createAppUpdateController(
    {
      checkForUpdate: check,
      addListener: (_name, callback) => {
        listener = callback;
        return () => {
          removed++;
        };
      },
    },
    (state) => states.push(state),
    () => time
  );
  return {
    controller,
    states,
    emit: (progress: number) => listener({ progress }),
    removed: () => removed,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

describe('OTA staging lifecycle', () => {
  test('actual server notes survive measured progress and staging, without creating version text', async () => {
    const f = fixture(async () => ({
      message: '  ## Fixed\n- Restore drafts\n',
      updateBundle: async () => {
        f.emit(0.42);
        return true;
      },
    }));
    await f.controller.check();
    expect(f.states.slice(1)).toEqual([
      { phase: 'downloading', progress: 0, releaseNotes: '## Fixed\n- Restore drafts' },
      { phase: 'downloading', progress: 0.42, releaseNotes: '## Fixed\n- Restore drafts' },
      { phase: 'ready', progress: 1, releaseNotes: '## Fixed\n- Restore drafts' },
    ]);
  });
  test('failed staging and a later empty response remove stale release metadata', async () => {
    let first = true;
    const f = fixture(async () => {
      if (!first) return null;
      first = false;
      return { message: 'Unstaged change', updateBundle: async () => false };
    });
    await f.controller.check();
    expect(f.states.at(-1)).toEqual({ phase: 'failed', progress: 0 });
    f.advance(60_000);
    await f.controller.check();
    expect(f.states.at(-1)).toEqual({ phase: 'idle', progress: 0 });
  });
  test('missing and blank server notes never fabricate release contents', async () => {
    for (const message of [undefined, null, ' \n ']) {
      const f = fixture(async () => ({ message, updateBundle: async () => true }));
      await f.controller.check();
      expect(f.states.at(-1)).toEqual({ phase: 'ready', progress: 1 });
    }
  });
  test('same-artifact release adoption stays quiet and permits later checks', async () => {
    let checks = 0;
    const f = fixture(async () => {
      checks++;
      return { transitionKind: 'ADOPT_RELEASE', updateBundle: async () => true };
    });
    await f.controller.check();
    expect(f.states).toEqual([
      { phase: 'checking', progress: 0 },
      { phase: 'idle', progress: 0 },
    ]);
    f.advance(15 * 60_000);
    await f.controller.check();
    expect(checks).toBe(2);
  });
  test('a rollback to the embedded artifact is staged for the next launch', async () => {
    const f = fixture(async () => ({
      transitionKind: 'USE_BUILTIN',
      updateBundle: async () => true,
    }));
    await f.controller.check();
    expect(f.states.at(-1)).toEqual({ phase: 'ready', progress: 1 });
  });
  test('native listener registration failure is contained and can retry', async () => {
    const states: UpdateSnapshot[] = [];
    let attempts = 0;
    let now = 0;
    const controller = createAppUpdateController(
      {
        checkForUpdate: async () => null,
        addListener: () => {
          attempts++;
          throw new Error('native module unavailable');
        },
      },
      (state) => states.push(state),
      () => now
    );
    await controller.check();
    expect(states.at(-1)?.phase).toBe('failed');
    now = 60_000;
    await controller.check();
    expect(attempts).toBe(2);
  });
  test('native listener cleanup failure does not reject or discard a staged bundle', async () => {
    const states: UpdateSnapshot[] = [];
    const controller = createAppUpdateController(
      {
        checkForUpdate: async () => ({ updateBundle: async () => true }),
        addListener: () => () => {
          throw new Error('native module torn down');
        },
      },
      (state) => states.push(state)
    );
    await controller.check();
    expect(states.at(-1)).toEqual({ phase: 'ready', progress: 1 });
  });
  test('disabled client performs no work', async () => {
    const states: UpdateSnapshot[] = [];
    await createAppUpdateController(null, (state) => states.push(state)).check();
    expect(states).toEqual([]);
  });
  test('deduplicates concurrent checks, publishes real progress, never reloads', async () => {
    let finish = (_staged: boolean) => {};
    let checks = 0;
    const f = fixture(async () => {
      checks++;
      return {
        updateBundle: () =>
          new Promise<boolean>((resolve) => {
            finish = resolve;
          }),
      };
    });
    const first = f.controller.check();
    expect(f.controller.check()).toBe(first);
    await Promise.resolve();
    f.emit(0.42);
    expect(f.states.at(-1)).toEqual({ phase: 'downloading', progress: 0.42 });
    f.emit(Number.NaN);
    expect(f.states.at(-1)?.progress).toBe(0.42);
    finish(true);
    await first;
    expect(f.states.at(-1)).toEqual({ phase: 'ready', progress: 1 });
    f.advance(3_600_000);
    await f.controller.check();
    expect(checks).toBe(1);
    expect(f.removed()).toBe(1);
  });
  test.each(['reject', 'callback', 'false'] as const)(
    'failed %s path retries only after cooldown',
    async (failure) => {
      let checks = 0;
      const f = fixture(async ({ onError }) => {
        checks++;
        if (failure === 'reject') throw new Error('offline');
        if (failure === 'callback') {
          onError(new Error('offline'));
          return null;
        }
        return { updateBundle: async () => false };
      });
      await f.controller.check();
      expect(f.states.at(-1)?.phase).toBe('failed');
      await f.controller.check();
      expect(checks).toBe(1);
      f.advance(60_000);
      await f.controller.check();
      expect(checks).toBe(2);
      expect(f.removed()).toBe(2);
    }
  );
  test('no update is distinct from failure and checks at most every fifteen minutes', async () => {
    let checks = 0;
    const f = fixture(async () => {
      checks++;
      return null;
    });
    await f.controller.check();
    expect(f.states.at(-1)?.phase).toBe('idle');
    f.advance(60_000);
    await f.controller.check();
    expect(checks).toBe(1);
    f.advance(14 * 60_000);
    await f.controller.check();
    expect(checks).toBe(2);
  });
});
