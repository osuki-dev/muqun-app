// Where a bearer token may travel in the clear, and where it may not.
//
// The rule these tests hold down: an unsealed request carries a token only to
// the configured gateway's own origin, except on the explicit plain route for
// a stored record that has no transport key. A stored record *with* a key is
// sealed with it whichever computer the shared client is pointed at -- the
// catalog loaders used to strip a record down to URL and token and so sent the
// token unsealed whenever that record was not the selected one.
import { describe, expect, test } from 'bun:test';

import {
  bearerLeavesGateway,
  carriesBearerToken,
  CLEARTEXT_TOKEN_REFUSAL,
  endpointCredentialRoute,
} from '../gateway-request-policy';
import { GATEWAY_TRANSPORT } from '../gateway-transport-id';

const GATEWAY = 'http://10.0.2.2:23847';
const BEARER = { Authorization: 'Bearer tok-1' };

describe('bearerLeavesGateway', () => {
  test('a token to the configured origin stays home', () => {
    expect(bearerLeavesGateway(`${GATEWAY}/api/agent-catalog`, GATEWAY, BEARER)).toBe(false);
    expect(bearerLeavesGateway(`${GATEWAY}/health`, `${GATEWAY}/`, BEARER)).toBe(false);
  });

  test('a token to any other origin leaves', () => {
    expect(bearerLeavesGateway('http://mini.tail:23847/api/agent-catalog', GATEWAY, BEARER)).toBe(
      true
    );
    // Same host, other port: a different origin, and a different gateway.
    expect(bearerLeavesGateway('http://10.0.2.2:23900/health', GATEWAY, BEARER)).toBe(true);
    expect(bearerLeavesGateway('https://10.0.2.2:23847/health', GATEWAY, BEARER)).toBe(true);
  });

  test('with nothing configured every absolute origin is foreign', () => {
    expect(bearerLeavesGateway(`${GATEWAY}/health`, '', BEARER)).toBe(true);
  });

  test('a relative path resolves against the configured gateway', () => {
    expect(bearerLeavesGateway('/api/agent-catalog', GATEWAY, BEARER)).toBe(false);
    expect(bearerLeavesGateway('/api/agent-catalog', '', BEARER)).toBe(false);
  });

  test('a request with no token has nothing to leak', () => {
    expect(bearerLeavesGateway('http://elsewhere:1/health', GATEWAY, {})).toBe(false);
    expect(
      bearerLeavesGateway('http://elsewhere:1/health', GATEWAY, { 'X-Muqun-Locale': 'en' })
    ).toBe(false);
  });

  test('the header is found in any letter case', () => {
    expect(carriesBearerToken({ authorization: 'Bearer x' })).toBe(true);
    expect(carriesBearerToken({ AUTHORIZATION: 'Bearer x' })).toBe(true);
    expect(carriesBearerToken({ 'X-Authorization-Hint': 'x' })).toBe(false);
  });

  test('the refusal names no network word a failure classifier would misread', () => {
    for (const word of ['host', 'network', 'fetch', 'connect', 'socket', 'internet', 'timed out']) {
      expect(CLEARTEXT_TOKEN_REFUSAL.toLowerCase()).not.toContain(word);
    }
  });
});

describe('endpointCredentialRoute', () => {
  const sealed = {
    transport: GATEWAY_TRANSPORT,
    deviceId: 'dev-1',
    transportKey: 'a2V5',
  };

  test('a record with a transport key is sealed, whichever computer is selected', () => {
    expect(endpointCredentialRoute(sealed)).toBe('sealed');
  });

  test('a record paired before encryption, holding no key, takes the plain route', () => {
    expect(endpointCredentialRoute({})).toBe('plain');
    expect(endpointCredentialRoute({ transport: GATEWAY_TRANSPORT })).toBe('plain');
    expect(endpointCredentialRoute({ transport: GATEWAY_TRANSPORT, deviceId: 'dev-1' })).toBe(
      'plain'
    );
  });

  test('a key under a transport this build does not speak is not something to seal with', () => {
    expect(endpointCredentialRoute({ ...sealed, transport: 'muqun-future-v9' })).toBe('plain');
  });
});
