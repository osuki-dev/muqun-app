import { expect, test } from 'bun:test';

import { paneEventRole, paneGeometryChanged, SUBSCRIBED_EVENTS } from '../pane-event-names';

test('what a forwarded event is to the workspace', () => {
  const cases: [name: string, role: ReturnType<typeof paneEventRole>][] = [
    ['pane_updated', 'output'],
    ['pane_closed', 'structure'],
    // tmux's fingerprint: only the open pane's size is checked, not the workspace.
    ['layout_updated', 'layout'],
    ['layout.updated', 'layout'],
    ['pane_focused', null],
  ];
  expect(cases.map(([name]) => paneEventRole(name))).toEqual(cases.map(([, role]) => role));
  expect(SUBSCRIBED_EVENTS).toContain('layout.updated');
});

test('a layout event re-reads the workspace only when the open pane changed size', () => {
  const held = { width: 80, height: 24 };
  const cases: [fresh: { width: number; height: number }, changed: boolean][] = [
    // Title or command churn: the same grid.
    [{ width: 80, height: 24 }, false],
    [{ width: 100, height: 24 }, true],
    [{ width: 80, height: 40 }, true],
    // A read that reports no size says nothing.
    [{ width: 0, height: 0 }, false],
  ];
  expect(cases.map(([fresh]) => paneGeometryChanged(held, fresh))).toEqual(
    cases.map(([, changed]) => changed)
  );
});
