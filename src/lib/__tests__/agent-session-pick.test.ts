import { describe, expect, test } from 'bun:test';

import type { AgentSessionInfo } from '../agent-protocol';
import { latestSession, pickSessionToOpen } from '../agent-session-pick';

function session(asid: string, updated_ms: number): AgentSessionInfo {
  return {
    asid,
    backend_session_id: `backend-${asid}`,
    title: asid,
    model: null,
    status: 'idle',
    updated_ms,
  };
}

/**
 * The reported bug, as a list: the reader opened B, and while they were on
 * Home an agent finished a turn in A -- so A has the newest activity and B is
 * still the session they chose.
 */
const a = session('a', 200);
const b = session('b', 100);
const list = [a, b];

describe('pickSessionToOpen', () => {
  test('the session the reader last opened, even when another one just moved', () => {
    expect(pickSessionToOpen(list, 'b')).toBe(b);
  });

  test('newest activity when the remembered session is gone', () => {
    // Deleted, moved to another workspace, or off the end of a bounded
    // listing: all the same answer, and none of them an error.
    expect(pickSessionToOpen(list, 'deleted')).toBe(a);
  });

  test('newest activity when nothing is remembered', () => {
    expect(pickSessionToOpen(list, undefined)).toBe(a);
    expect(pickSessionToOpen(list, '')).toBe(a);
  });

  test('an empty list opens nothing, remembered or not', () => {
    expect(pickSessionToOpen([], 'b')).toBeNull();
    expect(pickSessionToOpen([], undefined)).toBeNull();
  });
});

describe('latestSession', () => {
  test('the newest activity wins, whatever the list order', () => {
    expect(latestSession([b, a])).toBe(a);
  });

  test('a session that never stated a time still beats nothing', () => {
    // `updated_ms` is required on the wire, so this is a host that sent it as
    // zero: still a session, and the only one there is.
    const untimed = session('c', 0);
    expect(latestSession([untimed])).toBe(untimed);
    expect(latestSession([])).toBeNull();
  });
});
