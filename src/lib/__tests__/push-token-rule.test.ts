// When the gateway is owed a push token, and when it is not.
//
// The defect: the registration remembered one token in a closure local, the
// effect it lived in is keyed on the connection record, and the connection
// store hands back a new record object on select, rename and edit. So renaming
// a server -- or any other re-render that produced a new record for the same
// machine -- tore the effect down, lost the local, and posted a token the
// gateway already had.
//
// Erring the other way is worse than a wasted request, so the two directions
// are both pinned here: an unchanged token must be silent, and a changed token,
// a new server or a new app binary must not be.
import { describe, expect, test } from 'bun:test';

import {
  PUSH_TOKEN_MAX_AGE_MS,
  pushTokenNeedsSending,
  type RegisteredPushToken,
} from '../push-token-rule';

const build = '3.0.0+41';
const now = 1_700_000_000_000;
const stored = (over: Partial<RegisteredPushToken> = {}): RegisteredPushToken => ({
  token: 'ExponentPushToken[aaa]',
  build,
  atMs: now,
  ...over,
});

describe('when the gateway must be told', () => {
  test('a server this device has never registered with', () => {
    // Also the fresh-install case: nothing is stored for anyone.
    expect(pushTokenNeedsSending(null, 'ExponentPushToken[aaa]', build, now)).toBe(true);
  });

  test('a token Expo has reissued', () => {
    // A gateway left holding the old one would push into a void.
    expect(pushTokenNeedsSending(stored(), 'ExponentPushToken[bbb]', build, now)).toBe(true);
  });

  test('a launch on a newer app binary', () => {
    expect(pushTokenNeedsSending(stored(), 'ExponentPushToken[aaa]', '3.1.0+42', now)).toBe(true);
  });

  test('a build number bump alone, with the same version', () => {
    expect(pushTokenNeedsSending(stored(), 'ExponentPushToken[aaa]', '3.0.0+42', now)).toBe(true);
  });
});

describe('when it must not', () => {
  test('the same token, the same server, the same binary', () => {
    // The whole point: a re-render, a rename, a reselect or a return to the
    // foreground is not news.
    expect(pushTokenNeedsSending(stored(), 'ExponentPushToken[aaa]', build, now)).toBe(false);
  });

  test('there is no token to send', () => {
    // Permission refused, or no project id. Nothing to say, so nothing is said.
    expect(pushTokenNeedsSending(null, '', build, now)).toBe(false);
    expect(pushTokenNeedsSending(stored(), '', build, now)).toBe(false);
  });
});

describe('the per-server half of the rule', () => {
  test('one server being up to date says nothing about another', () => {
    // The store is keyed by server id, so this is what a second gateway sees:
    // no record of its own, and therefore a post owed.
    const serverA = stored();
    const serverB = null;
    expect(pushTokenNeedsSending(serverA, 'ExponentPushToken[aaa]', build, now)).toBe(false);
    expect(pushTokenNeedsSending(serverB, 'ExponentPushToken[aaa]', build, now)).toBe(true);
  });
});

describe('the weekly re-assert', () => {
  // Rules 1 to 3 all describe something changing on this device. A gateway can
  // lose its device row without anything here changing at all -- a reinstall, a
  // restore from an older backup -- and from the app that is invisible: the
  // token still looks registered and pushes just stop. So a confirmed
  // registration only speaks for a week.
  const due = (atMs: number, nowMs = now) =>
    pushTokenNeedsSending(stored({ atMs }), 'ExponentPushToken[aaa]', build, nowMs);

  test('a registration from a minute ago says nothing', () => {
    expect(due(now - 60_000)).toBe(false);
  });

  test('a registration from six days ago still says nothing', () => {
    // It must not compete with rules 1 to 3, and must never read as a
    // per-launch cost for anyone who opens the app daily.
    expect(due(now - 6 * 24 * 60 * 60 * 1000)).toBe(false);
  });

  test('the last millisecond inside the window is still inside it', () => {
    expect(due(now - (PUSH_TOKEN_MAX_AGE_MS - 1))).toBe(false);
  });

  test('exactly a week old is due', () => {
    expect(due(now - PUSH_TOKEN_MAX_AGE_MS)).toBe(true);
  });

  test('older than a week is due, and that is the bound on a wrong gateway', () => {
    expect(due(now - 30 * 24 * 60 * 60 * 1000)).toBe(true);
  });

  test('a stored time in the future is overdue, not a week of credit', () => {
    // A clock moved back, or a backup restored onto a device whose clock is
    // behind the one that wrote the record.
    expect(due(now + 60_000)).toBe(true);
    expect(due(now + PUSH_TOKEN_MAX_AGE_MS * 10)).toBe(true);
  });

  test('a record with no usable time reads as long overdue', () => {
    // What `registeredPushToken` produces for a stored entry missing `atMs`.
    expect(due(0)).toBe(true);
  });

  test('the age rule never resurrects a token there is nothing to send', () => {
    expect(pushTokenNeedsSending(stored({ atMs: 0 }), '', build, now)).toBe(false);
  });

  test('a week is well clear of any normal usage pattern', () => {
    expect(PUSH_TOKEN_MAX_AGE_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

test('a language the gateway was not told about is a post that is owed', () => {
  // The gateway writes the push in the locale recorded with the token, so a
  // reader who switches to Thai must be re-registered at once -- not in a week.
  const at = 1_000_000;
  const stored = {
    token: 'ExponentPushToken[aaa]',
    build: '3.0.0 (41)',
    atMs: at,
    locale: 'zh-TW',
  };
  expect(pushTokenNeedsSending(stored, stored.token, stored.build, at + 1, 'zh-TW')).toBe(false);
  expect(pushTokenNeedsSending(stored, stored.token, stored.build, at + 1, 'th')).toBe(true);
  // An entry written before the field existed is unknown, and is sent once.
  const legacy = { token: stored.token, build: stored.build, atMs: at };
  expect(pushTokenNeedsSending(legacy, stored.token, stored.build, at + 1, 'th')).toBe(true);
  // A caller that names no language keeps the rule it was written against.
  expect(pushTokenNeedsSending(legacy, stored.token, stored.build, at + 1)).toBe(false);
});
