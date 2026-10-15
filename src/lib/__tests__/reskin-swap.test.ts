import { expect, test } from 'bun:test';

import { runReskinSwap } from '../reskin-swap';
import { ThemeRepository } from '@/theme/repository';

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
  expect(events).toEqual(['covered', 'prepared', 'applied', 'painted', 'reveal', 'released']);
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
  await Promise.resolve();
  current = false;
  ready.resolve();
  await pending;
  expect(events).toEqual(['covered', 'released']);
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
  expect(events).toEqual([]);
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
  expect(events).toEqual(['covered', 'prepared', 'released']);
});

test('failed persisted theme selections skip the painted step and retain selection until retry', async () => {
  for (const target of ['builtin', 'default'] as const) {
    let fail = false;
    let writes = 0;
    const repository = new ThemeRepository(
      {
        read: () => undefined,
        write: () => {
          writes += 1;
          if (fail) throw new Error('disk full');
        },
      },
      () => 'unused'
    );
    repository.apply({ kind: 'builtin', id: 'catppuccin' });
    const before = repository.snapshot();
    const events: string[] = [];
    const select = () =>
      swap(events, {
        apply: () => {
          if (target === 'builtin') repository.apply({ kind: 'builtin', id: 'osuki' });
          else repository.resetToDefault();
        },
        painted: async () => {
          events.push('dismissed');
        },
      }).catch(() => {
        events.push('error');
      });
    fail = true;
    await select();
    expect(events).toEqual(['covered', 'prepared', 'released', 'error']);
    expect(repository.snapshot()).toEqual(before);
    expect(writes).toBe(2);

    fail = false;
    events.length = 0;
    await select();
    expect(events).toEqual(['covered', 'prepared', 'dismissed', 'reveal', 'released']);
    expect(repository.snapshot().selection).toEqual(
      target === 'builtin' ? { kind: 'builtin', id: 'osuki' } : null
    );
    expect(writes).toBe(3);
  }
});

test('holds the cover while the new renderers are pending', async () => {
  const events: string[] = [];
  const drawn = deferred();
  const applied = deferred();
  const pending = swap(events, {
    apply: () => applied.resolve(),
    painted: () => drawn.promise,
  });
  await applied.promise;
  expect(events).toEqual(['covered', 'prepared']);
  drawn.resolve();
  await pending;
  expect(events).toEqual(['covered', 'prepared', 'reveal', 'released']);
});
