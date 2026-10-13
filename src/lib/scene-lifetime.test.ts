import { expect, test } from 'bun:test';
import { createSceneLifetimes } from './scene-lifetime';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

test('late initialization is disposed before the same canvas can be mounted again', async () => {
  const startScene = createSceneLifetimes();
  const events: string[] = [];
  let initialized = () => {};
  const ready = new Promise<void>((resolve) => {
    initialized = resolve;
  });
  const stop = startScene(
    1,
    async (isLive) => {
      events.push('start');
      await ready;
      expect(isLive()).toBe(false);
      return async () => {
        events.push('dispose');
      };
    },
    () => events.push('error')
  );
  await tick();
  stop();
  const stopNext = startScene(
    1,
    async () => {
      events.push('next');
      return async () => {
        events.push('dispose next');
      };
    },
    () => events.push('error')
  );
  expect(events).toEqual(['start']);
  initialized();
  await tick();
  expect(events).toEqual(['start', 'dispose', 'next']);
  stopNext();
  await tick();
  expect(events.at(-1)).toBe('dispose next');
});

test('cancelled StrictMode setup creates no native resources', async () => {
  const events: string[] = [];
  const stop = createSceneLifetimes()(
    1,
    async () => {
      events.push('start');
      return async () => {};
    },
    () => events.push('error')
  );
  stop();
  await tick();
  expect(events).toEqual([]);
});
