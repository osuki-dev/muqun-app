import { expect, test } from 'bun:test';
import { AudioPlaybackPool } from '../audio-playback-pool';
import type { AudioPlaybackRuntime } from '../audio-playback-session';

test('recycled controls reuse paused audio and session teardown releases it', async () => {
  const pool = new AudioPlaybackPool();
  const calls: string[] = [];
  const runtime = (): AudioPlaybackRuntime => ({
    async prepare() {
      calls.push('prepare');
    },
    async start(progress) {
      calls.push('start');
      progress(2500, 8000);
    },
    async pause() {
      calls.push('pause');
    },
    async resume() {
      calls.push('resume');
    },
    async seek() {},
    async stop() {
      calls.push('stop');
    },
    release() {
      calls.push('release');
    },
  });
  const first = pool.acquire('server:session', 'row:audio', runtime);
  await first.session.play();
  await first.session.setVisible(false);
  const returned = pool.acquire('server:session', 'row:audio', runtime);
  expect(returned).toBe(first);
  expect(returned.store.getState().playback).toEqual({
    phase: 'paused',
    position: 2500,
    duration: 8000,
  });
  await returned.session.setVisible(true);
  expect(calls).toEqual(['prepare', 'start', 'pause']);
  await returned.session.play();
  expect(calls.at(-1)).toBe('resume');
  await pool.clear('server:session');
  expect(calls.slice(-2)).toEqual(['stop', 'release']);
  expect(pool.acquire('server:session', 'row:audio', runtime)).not.toBe(first);
  await pool.clear('server:session');
});

test('identical file paths do not share playback across servers or sessions', async () => {
  const pool = new AudioPlaybackPool();
  const runtime = (): AudioPlaybackRuntime => ({
    async prepare() {},
    async start() {},
    async pause() {},
    async resume() {},
    async seek() {},
    async stop() {},
    release() {},
  });
  const first = pool.acquire('server-a:session', 'row:audio', runtime);
  const other = pool.acquire('server-b:session', 'row:audio', runtime);
  expect(other).not.toBe(first);
  await pool.clear('server-a:session');
  expect(pool.acquire('server-b:session', 'row:audio', runtime)).toBe(other);
  await pool.clear('server-b:session');
});
