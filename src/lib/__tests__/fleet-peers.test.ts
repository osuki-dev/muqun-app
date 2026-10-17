import { describe, expect, test } from 'bun:test';

import {
  pairingsAnswer,
  parseMintedPairingCode,
  peerLinkBody,
  removalOutcome,
} from '../fleet-peers';

describe('pairingsAnswer: a 404 means nothing to revoke only when the gateway says so', () => {
  test.each([
    ['a 404 from a gateway without the list: nothing to revoke', 'no-route', ['fleet_peers'], []],
    [
      'a 404 where the gateway has the list (a proxy): retried',
      'no-route',
      ['device_revocation'],
      null,
    ],
    ['a 404 with no capabilities this run: retried', 'no-route', null, null],
  ] as const)('%s', (_name, listed, capabilities, expected) => {
    expect(pairingsAnswer(typeof listed === 'string' ? listed : [...listed], capabilities)).toEqual(
      expected === null ? null : [...expected]
    );
  });
});

describe('removalOutcome: an unpaired computer is let go only on a confirmed removal', () => {
  test.each([
    ['delete answered 200: done', 200, 'done'],
    ['nothing there to delete (404): done', 404, 'done'],
    ['server error (500): still pending', 500, 'retry'],
    ["this device's token refused (403): still pending", 403, 'retry'],
    ['no answer: still pending', 'network', 'retry'],
  ] as const)('%s', (_name, status, outcome) => {
    expect(removalOutcome(status)).toBe(outcome);
  });
});

describe('a minted pairing code travels to the linking computer whole', () => {
  test('the pairing key a required-mode target mints rides along verbatim', () => {
    const minted = parseMintedPairingCode({
      request_id: 'req-1',
      code: 'ABCD-EFGH',
      expires_in_ms: 90_000,
      pairing_key: 'a2V5LW1hdGVyaWFs_-',
    });
    expect(minted).toEqual({
      requestId: 'req-1',
      code: 'ABCD-EFGH',
      expiresInMs: 90_000,
      pairingKey: 'a2V5LW1hdGVyaWFs_-',
    });
    expect(peerLinkBody({ url: 'http://cedar:23847', name: 'atlas', ...minted! })).toEqual({
      url: 'http://cedar:23847',
      name: 'atlas',
      request_id: 'req-1',
      code: 'ABCD-EFGH',
      pairing_key: 'a2V5LW1hdGVyaWFs_-',
    });
  });

  test('a target that minted no key is linked without the field, as before', () => {
    const minted = parseMintedPairingCode({ request_id: 'req-2', code: 'WXYZ-1234' });
    expect(minted).toEqual({ requestId: 'req-2', code: 'WXYZ-1234', expiresInMs: 60_000 });
    const body = peerLinkBody({ url: 'http://cedar:23847', name: 'atlas', ...minted! });
    expect(body).toEqual({
      url: 'http://cedar:23847',
      name: 'atlas',
      request_id: 'req-2',
      code: 'WXYZ-1234',
    });
    expect('pairing_key' in body).toBe(false);
    // An empty or non-string key is no key.
    expect(
      'pairing_key' in
        peerLinkBody({ url: 'u', name: 'n', requestId: 'r', code: 'c', pairingKey: '' })
    ).toBe(false);
    expect(
      parseMintedPairingCode({ request_id: 'r', code: 'c', pairing_key: 42 })?.pairingKey
    ).toBeUndefined();
  });

  test('an answer without a code is no code', () => {
    expect(parseMintedPairingCode({ request_id: 'req-3' })).toBeNull();
    expect(parseMintedPairingCode({ code: 'ABCD' })).toBeNull();
    expect(parseMintedPairingCode(null)).toBeNull();
  });
});
