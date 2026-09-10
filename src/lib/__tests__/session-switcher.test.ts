/**
 * The three rules the session switcher is allowed to have an opinion about:
 * when it is drawn at all, what order it draws, and where a choice that no
 * longer exists lands. Everything else about switching sessions is navigation,
 * and navigation is the workspace's own reconciliation.
 */
import { describe, expect, test } from 'bun:test';

import {
  encodeSessionChoices,
  FALLBACK_SESSION_ID,
  MAX_REMEMBERED_SERVERS,
  parseServerSessionIndex,
  parseSessionChoices,
  rememberServerSession,
  resolveSessionId,
  sameSessionChoices,
  sessionChoices,
  shouldShowSessionSwitcher,
  withSessionAvailability,
  type ServerSessionIndex,
} from '../session-switcher';

const two = [
  { id: 'default', label: 'Alpha tmux', socket_path: '/tmp/a.sock', backend: 'tmux' },
  { id: 'bravo', label: 'Bravo tmux', socket_path: '/tmp/b.sock', backend: 'tmux' },
];

describe('running backends, not configured backends', () => {
  test('after reboot, stopped tmux is not a switch target', () => {
    const choices = sessionChoices([
      { ...two[0], connected: false },
      { ...two[1], backend: 'herdr', connected: true },
    ]);
    expect(choices.map((choice) => choice.id)).toEqual(['bravo']);
    expect(shouldShowSessionSwitcher(choices)).toBe(false);
  });
  test('starting the second backend makes the switch available on the next read', () => {
    expect(
      shouldShowSessionSwitcher(
        sessionChoices(two.map((session) => ({ ...session, connected: true })))
      )
    ).toBe(true);
    expect(shouldShowSessionSwitcher([])).toBe(false);
    expect(shouldShowSessionSwitcher(sessionChoices([two[0]]), 2)).toBe(true);
  });
  test('older gateway health identifies stopped sessions by ID, not backend kind', () => {
    const result = withSessionAvailability(
      { sessions: two },
      {
        backends: [
          { sessionId: 'default', kind: 'tmux', connected: false },
          { sessionId: 'bravo', kind: 'tmux', connected: true },
        ],
      }
    );
    expect(sessionChoices(result.sessions).map((choice) => choice.id)).toEqual(['bravo']);
    expect(sessionChoices(result.sessions, true)).toHaveLength(2);
  });
  test('explicit current session connectivity wins over an older health result', () => {
    const result = withSessionAvailability(
      { sessions: [{ ...two[0], connected: true }] },
      { backends: [{ sessionId: 'default', kind: 'tmux', connected: false }] }
    );
    expect(sessionChoices(result.sessions)).toHaveLength(1);
  });
});

describe('session normalization', () => {
  test('a gateway may name no sessions', () => {
    expect(sessionChoices(undefined)).toEqual([]);
    expect(sessionChoices([])).toEqual([]);
  });
  test('a duplicated id is one session, not two', () => {
    const duplicated = [two[0], { ...two[0], label: 'Alpha again' }];
    expect(sessionChoices(duplicated)).toHaveLength(1);
  });

  test('a session with no usable id is not a choice', () => {
    const broken = [two[0], { id: '   ', label: 'Nameless', socket_path: '/tmp/c.sock' }];
    expect(sessionChoices(broken)).toHaveLength(1);
  });
});

describe('what the rows say', () => {
  test('the gateway order is kept exactly as it arrived', () => {
    expect(sessionChoices(two).map((choice) => choice.id)).toEqual(['default', 'bravo']);
    expect(sessionChoices([two[1], two[0]]).map((choice) => choice.id)).toEqual([
      'bravo',
      'default',
    ]);
  });

  test('an unlabelled session is named by its id rather than left blank', () => {
    const [choice] = sessionChoices([{ id: 'bravo', label: '  ', socket_path: '/tmp/b.sock' }]);
    expect(choice.label).toBe('bravo');
  });

  test('a session with no backend named is a Herdr one', () => {
    const [choice] = sessionChoices([
      { id: 'default', label: 'Herdr', socket_path: '/tmp/h.sock' },
    ]);
    expect(choice.kind).toBe('herdr');
  });

  test('a backend the gateway named is carried through untranslated', () => {
    expect(sessionChoices(two)[1].kind).toBe('tmux');
  });
});

describe('which session opens', () => {
  const choices = sessionChoices(two);

  test('the one the reader asked for', () => {
    expect(resolveSessionId(choices, 'bravo')).toBe('bravo');
  });

  test('the gateway first when nothing was asked for', () => {
    expect(resolveSessionId(choices, undefined)).toBe('default');
    expect(resolveSessionId(choices, null)).toBe('default');
    expect(resolveSessionId(choices, '')).toBe('default');
  });

  test('a remembered session that is gone falls back rather than failing', () => {
    expect(resolveSessionId(choices, 'charlie')).toBe('default');
    expect(resolveSessionId(sessionChoices([two[1]]), 'default')).toBe('bravo');
  });

  test('a gateway that named nothing still yields an id to build a URL from', () => {
    expect(resolveSessionId([], 'bravo')).toBe(FALLBACK_SESSION_ID);
    expect(resolveSessionId([], undefined)).toBe(FALLBACK_SESSION_ID);
  });
});

describe('the list the sheet is handed', () => {
  test('survives the round trip through a route param', () => {
    const choices = sessionChoices(two);
    expect(parseSessionChoices(encodeSessionChoices(choices))).toEqual(choices);
  });

  test('two readings of the same list are the same list', () => {
    expect(sameSessionChoices(sessionChoices(two), sessionChoices(two))).toBe(true);
    expect(sameSessionChoices(sessionChoices(two), sessionChoices([two[0]]))).toBe(false);
    expect(sameSessionChoices(sessionChoices(two), sessionChoices([two[1], two[0]]))).toBe(false);
  });

  test('a param this build cannot read is an empty sheet, not a crash', () => {
    expect(parseSessionChoices(undefined)).toEqual([]);
    expect(parseSessionChoices('')).toEqual([]);
    expect(parseSessionChoices('not json')).toEqual([]);
    expect(parseSessionChoices('{"sessions":[]}')).toEqual([]);
    expect(parseSessionChoices('[null,3,{"label":"no id"}]')).toEqual([]);
  });
});

describe('the remembered choice', () => {
  test('reads back what was written', () => {
    expect(parseServerSessionIndex('{"s1":"bravo"}')).toEqual({ s1: 'bravo' });
  });

  test('anything that is not an id-to-id map is no memory at all', () => {
    expect(parseServerSessionIndex('not json')).toEqual({});
    expect(parseServerSessionIndex('["bravo"]')).toEqual({});
    expect(parseServerSessionIndex('{"s1":7,"s2":"","s3":"ok"}')).toEqual({ s3: 'ok' });
  });

  test('writing one server leaves the others alone', () => {
    const index = rememberServerSession({ s1: 'bravo' }, 's2', 'default');
    expect(index).toEqual({ s1: 'bravo', s2: 'default' });
  });

  test('writing the same answer twice does not make a new object to persist', () => {
    const index = { s1: 'bravo' };
    expect(rememberServerSession(index, 's1', 'bravo')).toBe(index);
  });

  test('the oldest servers drop off once the cap is reached', () => {
    let index: ServerSessionIndex = {};
    for (let n = 0; n <= MAX_REMEMBERED_SERVERS; n += 1) {
      index = rememberServerSession(index, `s${n}`, 'bravo');
    }
    expect(Object.keys(index)).toHaveLength(MAX_REMEMBERED_SERVERS);
    expect(index.s0).toBeUndefined();
    expect(index[`s${MAX_REMEMBERED_SERVERS}`]).toBe('bravo');
  });
});
