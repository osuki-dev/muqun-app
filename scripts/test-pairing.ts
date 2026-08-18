import {
  normalizeGatewayUrl,
  parsePairingOffer,
  validateClaimedPairing,
  validateGatewayUrl,
  validateServerId,
} from '../src/lib/pairing';
import { isSafeExternalLink } from '../src/lib/safe-link';

// Links come from untrusted terminal and agent output.
for (const value of ['http://example.com', 'https://example.com/a?b=c']) {
  equal(isSafeExternalLink(value), true);
}
for (const value of [
  'intent://scan/#Intent;scheme=zxing;package=com.example;end',
  'javascript:alert(1)',
  'file:///etc/passwd',
  'muqun://pair?u=http%3A%2F%2Fevil',
  'not a url',
  '',
]) {
  equal(isSafeExternalLink(value), false);
}

equal(validateGatewayUrl('http://100.64.0.1:7347/'), 'http://100.64.0.1:7347');
equal(normalizeGatewayUrl('100.64.0.1:7347'), 'http://100.64.0.1:7347');
throws(() => normalizeGatewayUrl('ftp://example.com'));
equal(validateServerId('8ab68d3f-8b1f-4c36-91a3-206a4ba1bd88'), '8ab68d3f-8b1f-4c36-91a3-206a4ba1bd88');
equal(
  JSON.stringify(parsePairingOffer('muqun://pair?u=http%3A%2F%2F100.64.0.1%3A7347&s=server-1')),
  JSON.stringify({ url: 'http://100.64.0.1:7347', serverId: 'server-1' })
);

for (const value of [
  'ftp://100.64.0.1/file',
  'http://user:password@100.64.0.1:7347',
  'http://100.64.0.1:7347?token=secret',
  'http://100.64.0.1:7347/#fragment',
]) {
  throws(() => validateGatewayUrl(value));
}

for (const value of ['', '../other-server', 'server id', 'x'.repeat(81)]) {
  throws(() => validateServerId(value));
}

const token = 't'.repeat(43);
const transportKey = 'k'.repeat(43);
const manualOffer = {
  url: 'http://100.64.0.1:7347',
  serverId: 'server-1',
  verifyAdvertisedUrl: false,
  transportRequired: true,
};

throws(() => validateClaimedPairing(manualOffer, {
  kind: 'muqun-gateway',
  server_id: 'server-1',
  label: 'Gateway',
  url: 'http://100.64.0.1:7347',
  token,
}));

equal(
  validateClaimedPairing(manualOffer, {
    kind: 'muqun-gateway',
    server_id: 'server-1',
    label: ' Gateway ',
    url: 'http://gateway-advertised.invalid:7347',
    token,
    device_id: 'device-1',
    transport_key: transportKey,
    transport: 'muqun-aes-256-gcm-v1',
  }).url,
  manualOffer.url
);

// A keyless QR is the explicit compatibility path for owner-selected Disabled
// mode. Manual entry above is intentionally stricter and cannot use this path.
equal(
  validateClaimedPairing({
    url: 'http://100.64.0.1:7347',
    serverId: 'server-1',
    verifyAdvertisedUrl: true,
    transportRequired: false,
  }, {
    kind: 'muqun-gateway',
    server_id: 'server-1',
    label: 'Gateway',
    url: 'http://100.64.0.1:7347',
    token,
  }).token,
  token
);

console.log('pairing security: all checks passed');

function equal(actual: unknown, expected: unknown): void {
  if (actual !== expected) throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
}

function throws(callback: () => unknown): void {
  try {
    callback();
  } catch {
    return;
  }
  throw new Error('Expected callback to throw.');
}
