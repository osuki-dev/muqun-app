import { expect, test } from 'bun:test';

import { paneEventRole, SUBSCRIBED_EVENTS } from '../pane-event-names';

test('what a forwarded event is to the workspace', () => {
  const cases: [name: string, role: ReturnType<typeof paneEventRole>][] = [
    ['pane_updated', 'output'],
    ['pane_closed', 'structure'],
    // tmux's pane resize: the pane list (and its columns) is read again at once.
    ['layout_updated', 'structure'],
    ['layout.updated', 'structure'],
    ['pane_focused', null],
  ];
  expect(cases.map(([name]) => paneEventRole(name))).toEqual(cases.map(([, role]) => role));
  expect(SUBSCRIBED_EVENTS).toContain('layout.updated');
});
