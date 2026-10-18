import { describe, expect, test } from 'bun:test';

import {
  normalizeGatewayUrl,
  normalizePairingCode,
  validateClaimedPairing,
  validateGatewayUrl,
  validatePairingTransport,
  validateServerId,
  type PairingPayload,
  type ResolvedPairingOffer,
} from '../pairing';
import { isSafeExternalLink } from '../safe-link';

test('untrusted output can open only HTTP links', () => {
  for (const value of ['http://example.com', 'https://example.com/a?b=c']) {
    expect(isSafeExternalLink(value)).toBe(true);
  }
  for (const value of [
    'intent://scan/#Intent;scheme=zxing;package=com.example;end',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'muqun://pair?u=http%3A%2F%2Fevil',
    'not a url',
    '',
  ]) {
    expect(isSafeExternalLink(value)).toBe(false);
  }
});

test('gateway addresses reject credentials, unsupported schemes, queries and fragments', () => {
  for (const value of [
    'ftp://100.64.0.1/file',
    'http://user:password@100.64.0.1:7347',
    'http://100.64.0.1:7347?token=secret',
    'http://100.64.0.1:7347/#fragment',
  ]) {
    expect(() => validateGatewayUrl(value)).toThrow();
  }
});

test('server identities reject paths and malformed identifiers', () => {
  for (const value of ['', '../other-server', 'server id', 'x'.repeat(81)]) {
    expect(() => validateServerId(value)).toThrow();
  }
});

describe('pairing transport boundary', () => {
  test('manual and QR pairing accept HTTP and HTTPS without host allowlists', () => {
    for (const url of [
      'https://gateway.invalid:7347',
      'https://192.168.1.2:7347',
      'http://127.0.0.1:51234',
      'http://127.2.3.4:51234',
      'http://[::1]:51234',
      'http://gateway.invalid:7347',
      'http://192.168.1.2:7347',
      'http://10.0.0.2:7347',
      'http://100.64.0.1:7347',
      'http://gateway.tailnet.ts.net:7347',
      'http://gateway:7347',
      'http://localhost:7347',
      'http://127.gateway.invalid:7347',
      'http://127.0.0.1.gateway.invalid:7347',
    ]) {
      expect(validatePairingTransport(url)).toBe(url);
      expect(validatePairingTransport(url, 'k'.repeat(43))).toBe(url);
    }
  });

  test('a supplied QR bootstrap key must be valid', () => {
    const url = 'http://gateway.invalid:7347';
    expect(validatePairingTransport(url, 'k'.repeat(43))).toBe(url);
    for (const key of ['', 'x'.repeat(42), 'x'.repeat(43), 'k'.repeat(43) + '=']) {
      expect(() => validatePairingTransport(url, key)).toThrow('invalid encryption key');
    }
  });
});

const token = 't'.repeat(43);
const transportKey = 'k'.repeat(43);
const manualOffer: ResolvedPairingOffer = {
  url: 'http://100.64.0.1:7347',
  serverId: 'server-1',
  verifyAdvertisedUrl: false,
  transportRequired: true,
};

function payload(overrides: Partial<PairingPayload> = {}): PairingPayload {
  return {
    kind: 'muqun-gateway',
    server_id: 'server-1',
    label: 'Gateway',
    url: 'http://100.64.0.1:7347',
    token,
    ...overrides,
  };
}

describe('manual pairing encryption policy', () => {
  test('rejects a plaintext token-only claim instead of silently downgrading', () => {
    expect(() => validateClaimedPairing(manualOffer, payload())).toThrow(
      'Gateway did not enable encrypted transport.'
    );
  });

  test('accepts encrypted transport fields and preserves the address that was reached', () => {
    const result = validateClaimedPairing(
      manualOffer,
      payload({
        label: ' Gateway ',
        url: 'http://gateway-advertised.invalid:7347',
        device_id: 'device-1',
        transport_key: transportKey,
        transport: 'muqun-aes-256-gcm-v1',
      })
    );

    expect(result.url).toBe(manualOffer.url);
    expect(result.label).toBe('Gateway');
  });

  test('keeps keyless QR pairing as the explicit legacy compatibility path', () => {
    const result = validateClaimedPairing(
      {
        url: 'http://100.64.0.1:7347',
        serverId: 'server-1',
        verifyAdvertisedUrl: true,
        transportRequired: false,
      },
      payload()
    );

    expect(result.token).toBe(token);
  });
});

test('an explicit unsupported URL scheme is not rewritten as an HTTP hostname', () => {
  expect(() => normalizeGatewayUrl('ftp://example.com')).toThrow(
    'Gateway URL must use http:// or https://.'
  );
});

describe('pasted manual pairing input', () => {
  test('trims surrounding URL whitespace before validation', () => {
    expect(normalizeGatewayUrl(' \n100.64.0.1:7347\t ')).toBe('http://100.64.0.1:7347');
  });

  test('filters before limiting the pairing code so whitespace cannot consume a slot', () => {
    expect(normalizePairingCode(' \nMUQ2-3456\t ')).toBe('MUQ2-3456');
  });
});
