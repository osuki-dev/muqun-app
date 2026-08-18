import { describe, expect, test } from 'bun:test';

import {
  normalizeGatewayUrl,
  normalizePairingCode,
  validateClaimedPairing,
  type PairingPayload,
  type ResolvedPairingOffer,
} from '../pairing';

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
    const result = validateClaimedPairing(manualOffer, payload({
      label: ' Gateway ',
      url: 'http://gateway-advertised.invalid:7347',
      device_id: 'device-1',
      transport_key: transportKey,
      transport: 'muqun-aes-256-gcm-v1',
    }));

    expect(result.url).toBe(manualOffer.url);
    expect(result.label).toBe('Gateway');
  });

  test('keeps keyless QR pairing as the explicit legacy compatibility path', () => {
    const result = validateClaimedPairing({
      url: 'http://100.64.0.1:7347',
      serverId: 'server-1',
      verifyAdvertisedUrl: true,
      transportRequired: false,
    }, payload());

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
    expect(normalizeGatewayUrl(' \n100.64.0.1:7347\t ')).toBe(
      'http://100.64.0.1:7347'
    );
  });

  test('filters before limiting the pairing code so whitespace cannot consume a slot', () => {
    expect(normalizePairingCode(' \nMUQ2-3456\t ')).toBe('MUQ2-3456');
  });
});
