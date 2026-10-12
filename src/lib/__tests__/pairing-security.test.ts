import { describe, expect, test } from 'bun:test';

import {
  normalizeGatewayUrl,
  normalizePairingCode,
  validateClaimedPairing,
  validateGatewayUrl,
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
