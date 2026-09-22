import { expect, test } from 'bun:test';

import {
  HOME_CONTINUE_INITIAL_LIMIT,
  shouldShowHomeContinueOverflow,
  visibleHomeContinueEntries,
  type HomeContinueEntry,
} from '../home-continue';

const entries = (count: number): HomeContinueEntry[] =>
  Array.from({ length: count }, (_, index) => ({
    key: String(index),
    title: `Session ${index}`,
    atMs: index,
    destination: {
      type: 'recent',
      target: {
        kind: 'gateway-terminal',
        serverId: 'server',
        sessionId: 'session',
        paneId: String(index),
      },
    },
  }));

test('Home recent sessions keeps ten visible and only exposes overflow after ten', () => {
  expect(HOME_CONTINUE_INITIAL_LIMIT).toBe(10);
  expect(shouldShowHomeContinueOverflow(entries(10))).toBe(false);
  expect(shouldShowHomeContinueOverflow(entries(11))).toBe(true);
  expect(visibleHomeContinueEntries(entries(12), false)).toHaveLength(10);
  expect(visibleHomeContinueEntries(entries(12), true)).toHaveLength(12);
  expect(visibleHomeContinueEntries(entries(12), false).map((entry) => entry.key)).toEqual(
    entries(12)
      .slice(0, 10)
      .map((entry) => entry.key)
  );
});
