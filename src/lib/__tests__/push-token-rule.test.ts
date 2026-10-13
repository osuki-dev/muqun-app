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
import { runInNewContext } from 'node:vm';
import * as crypto from 'node:crypto';
import { declaration, transpile } from '../../test-support/production-source';

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

describe('the weekly re-assert', () => {
  // Rules 1 to 3 all describe something changing on this device. A gateway can
  // lose its device row without anything here changing at all -- a reinstall, a
  // restore from an older backup -- and from the app that is invisible: the
  // token still looks registered and pushes just stop. So a confirmed
  // registration only speaks for a week.
  const due = (atMs: number, nowMs = now) =>
    pushTokenNeedsSending(stored({ atMs }), 'ExponentPushToken[aaa]', build, nowMs);

  test('the last millisecond inside the window is still inside it', () => {
    expect(due(now - (PUSH_TOKEN_MAX_AGE_MS - 1))).toBe(false);
  });

  test('exactly a week old is due', () => {
    expect(due(now - PUSH_TOKEN_MAX_AGE_MS)).toBe(true);
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

test('the registry reads back locale and the successful ownership receipt without persisting Gateway credentials', () => {
  const values = new Map<string, string>();
  const registry = runInNewContext(
    transpile(
      [
        declaration('src/lib/push-token-registry.ts', 'registeredPushToken'),
        declaration('src/lib/push-token-registry.ts', 'rememberRegisteredPushToken'),
        declaration('src/lib/push-token-registry.ts', 'pushPairingIdentity'),
        '({ read: registeredPushToken, remember: rememberRegisteredPushToken, identity: pushPairingIdentity })',
      ].join('\n')
    ),
    {
      QuickCrypto: crypto,
      storage: {
        getString: (key: string) => values.get(key),
        set: (key: string, value: string) => values.set(key, value),
      },
    }
  ) as {
    read: (id: string) => RegisteredPushToken | null;
    remember: (id: string, entry: Omit<RegisteredPushToken, 'atMs'>, now: number) => void;
    identity: (record: object) => string;
  };
  const pairing = {
    serverId: 'server',
    url: 'http://fixture.invalid',
    token: 'fixture-gateway-credential',
  };
  const ownerBinding = { revision: 1 as const, identity: registry.identity(pairing) };
  registry.remember('server', { token: 'expo-token', build, locale: 'zh-TW', ownerBinding }, now);
  expect(registry.read('server')).toMatchObject({
    token: 'expo-token',
    build,
    locale: 'zh-TW',
    atMs: now,
    ownerBinding,
  });
  expect(values.get('server')).not.toContain(pairing.token);
  const stored = registry.read('server');
  expect(pushTokenNeedsSending(stored, 'expo-token', build, now + 1, 'zh-TW', ownerBinding)).toBe(
    false
  );
  expect(
    pushTokenNeedsSending(stored, 'expo-token', build, now + 1, 'zh-TW', {
      ...ownerBinding,
      identity: registry.identity({ ...pairing, token: 'replacement' }),
    })
  ).toBe(true);
  values.set(
    'server',
    JSON.stringify({
      token: 'expo-token',
      build,
      locale: 'zh-TW',
      atMs: now,
      ownerBinding: { revision: 1, identity: 'invalid' },
    })
  );
  expect(registry.read('server')?.ownerBinding).toBeUndefined();
  expect(
    pushTokenNeedsSending(
      registry.read('server'),
      'expo-token',
      build,
      now + 1,
      'zh-TW',
      ownerBinding
    )
  ).toBe(true);
});
