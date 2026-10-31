import { expect, test } from 'bun:test';
import { runReskinSwap } from '../reskin-swap';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function deferred() {
  return Promise.withResolvers<void>();
}

test('a covered setting commits once and reveals only after the live UI is ready', async () => {
  const draw = deferred();
  const events: string[] = [];
  const run = runReskinSwap({
    current: () => true,
    cover: async () => {
      events.push('cover-ready');
    },
    prepare: async () => {
      events.push('prepared');
      return () => events.push('release');
    },
    apply: () => {
      events.push('apply');
    },
    painted: async () => {
      events.push('waiting-for-live');
      await draw.promise;
    },
    reveal: () => {
      events.push('reveal');
    },
  });
  await tick();
  expect(events).toEqual(['cover-ready', 'prepared', 'apply', 'waiting-for-live']);
  draw.resolve();
  await run;
  expect(events).toEqual([
    'cover-ready',
    'prepared',
    'apply',
    'waiting-for-live',
    'reveal',
    'release',
  ]);
});

test('a dismissed preparation releases its lease without applying or revealing', async () => {
  const assets = deferred();
  let current = true;
  let released = 0;
  const events: string[] = [];
  const run = runReskinSwap({
    current: () => current,
    cover: async () => {},
    prepare: async () => {
      await assets.promise;
      return () => released++;
    },
    apply: () => {
      events.push('apply');
    },
    painted: async () => {
      events.push('paint');
    },
    reveal: () => {
      events.push('reveal');
    },
  });
  await tick();
  current = false;
  assets.resolve();
  await run;
  expect(events).toEqual([]);
  expect(released).toBe(1);
});

test('a superseded draw cannot reveal over the newer change', async () => {
  const oldDraw = deferred();
  let generation = 1;
  const events: string[] = [];
  const start = (id: number, painted: () => Promise<void>) =>
    runReskinSwap({
      current: () => generation === id,
      cover: async () => {},
      prepare: async () => () => {
        events.push(`release-${id}`);
      },
      apply: () => {
        events.push(`apply-${id}`);
      },
      painted,
      reveal: () => {
        events.push(`reveal-${id}`);
      },
    });
  const first = start(1, () => oldDraw.promise);
  await tick();
  generation = 2;
  await start(2, async () => {});
  oldDraw.resolve();
  await first;
  expect(events).toEqual(['apply-1', 'apply-2', 'reveal-2', 'release-2', 'release-1']);
});

test('failed writes release preparation without navigation paint or reveal', async () => {
  const events: string[] = [];
  await expect(
    runReskinSwap({
      current: () => true,
      cover: async () => {},
      prepare: async () => () => {
        events.push('release');
      },
      apply: () => {
        throw new Error('storage refused');
      },
      painted: async () => {
        events.push('paint');
      },
      reveal: () => {
        events.push('reveal');
      },
    })
  ).rejects.toThrow('storage refused');
  expect(events).toEqual(['release']);
});
