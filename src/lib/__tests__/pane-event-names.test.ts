import { expect, test } from 'bun:test';

import { layoutNeedsRefresh, paneEventRole, SUBSCRIBED_EVENTS } from '../pane-event-names';

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

test('a layout event re-reads the workspace on structure or an open-pane resize, never on churn', () => {
  const pane = (id: string, over: { tab?: string; width?: number; height?: number } = {}) => ({
    id,
    tab: over.tab ?? 't1',
    workspace: 'w1',
    width: over.width ?? 80,
    height: over.height ?? 24,
  });
  const held = [pane('p1'), pane('p2')];
  const cases: [fresh: ReturnType<typeof pane>[], refresh: boolean][] = [
    // Title or command churn: the same panes, the same grid.
    [[pane('p1'), pane('p2')], false],
    // A pane opened, closed, or moved to another tab.
    [[pane('p1'), pane('p2'), pane('p3')], true],
    [[pane('p1')], true],
    [[pane('p1'), pane('p2', { tab: 't2' })], true],
    // The open pane resized; another pane's resize is not this screen's news.
    [[pane('p1', { width: 100 }), pane('p2')], true],
    [[pane('p1'), pane('p2', { height: 40 })], false],
    // A read that reports no size says nothing.
    [[pane('p1', { width: 0, height: 0 }), pane('p2')], false],
  ];
  expect(cases.map(([fresh]) => layoutNeedsRefresh(held, fresh, 'p1'))).toEqual(
    cases.map(([, refresh]) => refresh)
  );
});
