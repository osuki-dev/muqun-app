import { expect, test } from 'bun:test';

import { STREAM_IDLE_LIMIT_MS, streamIsStalled } from '../stream-watchdog';

test('a stream that heard a keep-alive within the limit is alive', () => {
  // The gateway's keep-alive is every 15 s; two may be missed.
  expect(streamIsStalled(0, 15_000)).toBe(false);
  expect(streamIsStalled(0, 30_000)).toBe(false);
  expect(streamIsStalled(0, STREAM_IDLE_LIMIT_MS - 1)).toBe(false);
});

test('silence for the whole limit is a dead stream', () => {
  expect(streamIsStalled(0, STREAM_IDLE_LIMIT_MS)).toBe(true);
  expect(streamIsStalled(1000, 1000 + 60_000)).toBe(true);
});
