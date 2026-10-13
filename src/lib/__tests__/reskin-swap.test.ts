import { expect, test } from 'bun:test';

import { runReskinSwap } from '../reskin-swap';

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function swap(events: string[], overrides: Partial<Parameters<typeof runReskinSwap>[0]> = {}) {
  return runReskinSwap({
    prepare: async () => {
      events.push('prepared');
      return () => {
        events.push('released');
      };
    },
    cover: async () => {
      events.push('covered');
    },
    apply: () => {
      events.push('applied');
    },
    painted: async () => {
      events.push('painted');
    },
    reveal: () => {
      events.push('reveal');
    },
    current: () => true,
    ...overrides,
  });
}

test('retains resources through the covered commit and first painted frame', async () => {
  const events: string[] = [];
  await swap(events);
  expect(events).toEqual(['prepared', 'covered', 'applied', 'painted', 'reveal', 'released']);
});

test('a dismissed or superseded preparation never applies its theme', async () => {
  const events: string[] = [];
  const ready = deferred();
  let current = true;
  const pending = swap(events, {
    prepare: async () => {
      await ready.promise;
      return () => {
        events.push('released');
      };
    },
    current: () => current,
  });
  current = false;
  ready.resolve();
  await pending;
  expect(events).toEqual(['released']);
});

test('supersession during capture does not commit the stale selection', async () => {
  const events: string[] = [];
  let current = true;
  await swap(events, {
    current: () => current,
    cover: async () => {
      current = false;
    },
  });
  expect(events).toEqual(['prepared', 'released']);
});

test('apply failure releases prepared assets without revealing a half-applied theme', async () => {
  const events: string[] = [];
  await expect(
    swap(events, {
      apply: () => {
        throw new Error('save failed');
      },
    })
  ).rejects.toThrow('save failed');
  expect(events).toEqual(['prepared', 'covered', 'released']);
});
