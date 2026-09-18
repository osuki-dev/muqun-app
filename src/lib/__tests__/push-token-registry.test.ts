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

import { pushTokenNeedsSending, type RegisteredPushToken } from '../push-token-registry';

const build = '3.0.0+41';
const stored = (over: Partial<RegisteredPushToken> = {}): RegisteredPushToken => ({
  token: 'ExponentPushToken[aaa]',
  build,
  ...over,
});

describe('when the gateway must be told', () => {
  test('a server this device has never registered with', () => {
    // Also the fresh-install case: nothing is stored for anyone.
    expect(pushTokenNeedsSending(null, 'ExponentPushToken[aaa]', build)).toBe(true);
  });

  test('a token Expo has reissued', () => {
    // A gateway left holding the old one would push into a void.
    expect(pushTokenNeedsSending(stored(), 'ExponentPushToken[bbb]', build)).toBe(true);
  });

  test('a launch on a newer app binary', () => {
    expect(pushTokenNeedsSending(stored(), 'ExponentPushToken[aaa]', '3.1.0+42')).toBe(true);
  });

  test('a build number bump alone, with the same version', () => {
    expect(pushTokenNeedsSending(stored(), 'ExponentPushToken[aaa]', '3.0.0+42')).toBe(true);
  });
});

describe('when it must not', () => {
  test('the same token, the same server, the same binary', () => {
    // The whole point: a re-render, a rename, a reselect or a return to the
    // foreground is not news.
    expect(pushTokenNeedsSending(stored(), 'ExponentPushToken[aaa]', build)).toBe(false);
  });

  test('there is no token to send', () => {
    // Permission refused, or no project id. Nothing to say, so nothing is said.
    expect(pushTokenNeedsSending(null, '', build)).toBe(false);
    expect(pushTokenNeedsSending(stored(), '', build)).toBe(false);
  });
});

describe('the per-server half of the rule', () => {
  test('one server being up to date says nothing about another', () => {
    // The store is keyed by server id, so this is what a second gateway sees:
    // no record of its own, and therefore a post owed.
    const serverA = stored();
    const serverB = null;
    expect(pushTokenNeedsSending(serverA, 'ExponentPushToken[aaa]', build)).toBe(false);
    expect(pushTokenNeedsSending(serverB, 'ExponentPushToken[aaa]', build)).toBe(true);
  });
});
