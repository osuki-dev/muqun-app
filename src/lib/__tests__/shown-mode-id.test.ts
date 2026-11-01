import { describe, expect, test } from 'bun:test';

import { shownModeId } from '@/lib/agent-session-defaults';
import type { ModeInfo } from '@/lib/agent-protocol';

const claude: ModeInfo[] = [
  { id: 'default', name: 'Manual' },
  { id: 'plan', name: 'Plan' },
  { id: 'background', name: 'Background', hidden: true },
];

describe('shownModeId', () => {
  test.each([
    ['another agent’s selection is dropped', { selected: 'build' }, undefined],
    ['… and the catalog default stands in', { selected: 'build', catalogDefault: 'plan' }, 'plan'],
    ['a selection this agent offers wins', { selected: 'plan', sessionMode: 'default' }, 'plan'],
    [
      'the session’s own mode before the default',
      { sessionMode: 'default', catalogDefault: 'plan' },
      'default',
    ],
    [
      'a session mode the picker hides is still the session’s',
      { sessionMode: 'background' },
      'background',
    ],
    ['a selected mode the picker hides is not shown', { selected: 'background' }, undefined],
    ['a decorated session mode is the catalog’s entry', { sessionMode: 'plan[]' }, 'plan'],
    ['a session mode the catalog does not list is not shown', { sessionMode: 'build' }, undefined],
    ['a default the catalog does not list is not shown', { catalogDefault: 'build' }, undefined],
  ] as const)('%s', (_name, input, expected) => {
    expect(shownModeId({ ...input, modes: claude, catalogRead: true })).toBe(expected);
  });

  test('a catalog with no modes names none', () => {
    expect(
      shownModeId({ selected: 'build', sessionMode: 'default', modes: [], catalogRead: true })
    ).toBeUndefined();
  });

  test('before the catalog answers, only the session’s own mode is shown', () => {
    expect(shownModeId({ selected: 'build', modes: [], catalogRead: false })).toBeUndefined();
    expect(
      shownModeId({ selected: 'build', sessionMode: 'default', modes: [], catalogRead: false })
    ).toBe('default');
  });
});
