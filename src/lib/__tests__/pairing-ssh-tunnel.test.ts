// A pairing that ran through an SSH tunnel must not remember the tunnel's
// loopback address: the record keeps the gateway's own advertised URL and the
// tunnel spec, and reaches the one through the other next time.
import { describe, expect, test } from 'bun:test';

import { validateClaimedPairing, type PairingPayload, type ResolvedPairingOffer } from '../pairing';

const PAYLOAD: PairingPayload = {
  kind: 'muqun-gateway',
  server_id: 'server-1',
  label: 'Build box',
  url: 'http://127.0.0.1:23847',
  token: 'a'.repeat(43),
  device_id: 'device-1',
  transport_key: 'k'.repeat(43),
  transport: 'muqun-aes-256-gcm-v1',
};

const TUNNEL = { hostId: 'host-9', remoteHost: '127.0.0.1', remotePort: 23847 };

describe('pairing through an SSH tunnel', () => {
  test('the stored url is the advertised one, not the ephemeral forward', () => {
    const offer: ResolvedPairingOffer = {
      url: 'http://127.0.0.1:51234',
      serverId: 'server-1',
      verifyAdvertisedUrl: false,
      transportRequired: true,
      sshTunnel: TUNNEL,
    };
    expect(validateClaimedPairing(offer, PAYLOAD).url).toBe('http://127.0.0.1:23847');
  });

  test('a typed address without a tunnel still keeps the address the reader typed', () => {
    const offer: ResolvedPairingOffer = {
      url: 'http://100.64.0.9:23847',
      serverId: 'server-1',
      verifyAdvertisedUrl: false,
      transportRequired: true,
    };
    expect(validateClaimedPairing(offer, PAYLOAD).url).toBe('http://100.64.0.9:23847');
  });

  test('the tunnel pairing still requires the encrypted transport', () => {
    const offer: ResolvedPairingOffer = {
      url: 'http://127.0.0.1:51234',
      serverId: 'server-1',
      verifyAdvertisedUrl: false,
      transportRequired: true,
      sshTunnel: TUNNEL,
    };
    const { transport: _t, transport_key: _k, device_id: _d, ...stripped } = PAYLOAD;
    expect(() => validateClaimedPairing(offer, stripped as PairingPayload)).toThrow(
      'Gateway did not enable encrypted transport.'
    );
  });
});
