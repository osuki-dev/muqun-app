import { expect, test } from 'bun:test';

import { seenThroughRoutes } from '../route-presentation';

/**
 * Returning from Quick actions flashed the pane: the sheet blurred the screen,
 * the event stream was gated on focus and closed, and the pane slid back into
 * view on the frame it had when the sheet rose, then jumped once the socket was
 * back. The pane is in view the whole time a sheet is over it.
 */
test('a phone sheet leaves the screen underneath in view', () => {
  expect(seenThroughRoutes(['commands'], false)).toBe(true);
  expect(seenThroughRoutes(['git-diff'], false)).toBe(true);
  expect(seenThroughRoutes(['artifacts'], false)).toBe(true);
  expect(seenThroughRoutes(['panels'], false)).toBe(true);
});

test('nothing over the screen is in view', () => {
  expect(seenThroughRoutes([], false)).toBe(true);
});

test('a full-screen route takes the screen away', () => {
  expect(seenThroughRoutes(['settings'], false)).toBe(false);
  expect(seenThroughRoutes(['servers/[serverId]'], false)).toBe(false);
  expect(seenThroughRoutes(['custom-theme'], false)).toBe(false);
  expect(seenThroughRoutes(['commands', 'settings'], false)).toBe(false);
});

test('a work surface a Pad shows full-screen takes it away; a picker does not', () => {
  expect(seenThroughRoutes(['git-diff'], true)).toBe(false);
  expect(seenThroughRoutes(['commands'], true)).toBe(true);
});
