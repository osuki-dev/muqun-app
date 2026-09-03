// The gateway record on the round trip, with the SSH tunnel field added: a
// record sealed without it must load unchanged (back-compat), a good tunnel
// spec must survive, and a malformed one must degrade to a plain direct
// gateway rather than dropping the record. Node's crypto stands in for the
// phone's; a map stands in for the keychain.
import * as bunTest from 'bun:test';

import { fakeQuickCrypto, fakeSecureStore, resetVault } from './gateway-vault';

const { beforeEach, describe, expect, test } = bunTest;
const { module: mockModule } = (
  bunTest as unknown as { mock: { module: (id: string, factory: () => unknown) => void } }
).mock;

// One shared fake, so the store test that also needs real record storage cannot
// end up owning the vault this suite resets. See `gateway-vault.ts`.
mockModule('expo-secure-store', () => fakeSecureStore);
mockModule('react-native-quick-crypto', () => fakeQuickCrypto);

const storage = await import('../gateway-storage');
const { normalizeGatewaySshTunnel, saveGateway, loadGateways } = storage;

beforeEach(resetVault);

const PAYLOAD = {
  kind: 'muqun-gateway' as const,
  server_id: 'server-1',
  label: 'Build box',
  url: 'http://127.0.0.1:23847',
  token: 'a'.repeat(43),
  device_id: 'device-1',
  transport_key: 'k'.repeat(43),
  transport: 'muqun-aes-256-gcm-v1' as const,
};

describe('normalizeGatewaySshTunnel', () => {
  test('a well-formed tunnel spec passes through, trimming the host', () => {
    expect(
      normalizeGatewaySshTunnel({ hostId: 'host-9', remoteHost: ' 127.0.0.1 ', remotePort: 23847 })
    ).toEqual({
      hostId: 'host-9',
      remoteHost: '127.0.0.1',
      remotePort: 23847,
    });
  });

  test('anything malformed is dropped', () => {
    expect(normalizeGatewaySshTunnel(undefined)).toBeUndefined();
    expect(normalizeGatewaySshTunnel(null)).toBeUndefined();
    expect(normalizeGatewaySshTunnel('nope')).toBeUndefined();
    expect(
      normalizeGatewaySshTunnel({ hostId: '', remoteHost: '127.0.0.1', remotePort: 23847 })
    ).toBeUndefined();
    expect(
      normalizeGatewaySshTunnel({ hostId: 'h', remoteHost: '', remotePort: 23847 })
    ).toBeUndefined();
    expect(
      normalizeGatewaySshTunnel({ hostId: 'h', remoteHost: '127.0.0.1', remotePort: 0 })
    ).toBeUndefined();
    expect(
      normalizeGatewaySshTunnel({ hostId: 'h', remoteHost: '127.0.0.1', remotePort: 70000 })
    ).toBeUndefined();
    expect(
      normalizeGatewaySshTunnel({ hostId: 'h', remoteHost: '127.0.0.1', remotePort: 1.5 })
    ).toBeUndefined();
  });
});

describe('back-compat on load', () => {
  test('a record sealed without sshTunnel loads unchanged', async () => {
    await saveGateway(PAYLOAD, 'Build box');
    const [record] = await loadGateways();
    expect(record.serverId).toBe('server-1');
    expect(record.url).toBe('http://127.0.0.1:23847');
    expect(record.sshTunnel).toBeUndefined();
    expect(record.token).toBe(PAYLOAD.token);
  });

  test('a tunnelled record round-trips its tunnel spec', async () => {
    await saveGateway(PAYLOAD, 'Build box', {
      hostId: 'host-9',
      remoteHost: '127.0.0.1',
      remotePort: 23847,
    });
    const [record] = await loadGateways();
    expect(record.sshTunnel).toEqual({
      hostId: 'host-9',
      remoteHost: '127.0.0.1',
      remotePort: 23847,
    });
    // The stored url stays the gateway's real URL; the tunnel URL is derived at runtime.
    expect(record.url).toBe('http://127.0.0.1:23847');
  });

  test('a record whose stored sshTunnel is malformed loads as a plain direct gateway', async () => {
    // Seal a good record, then corrupt the stored blob's tunnel field the way a
    // future/older build's drift would, and confirm the normaliser heals it.
    await saveGateway(PAYLOAD, 'Build box', {
      hostId: 'host-9',
      remoteHost: '127.0.0.1',
      remotePort: 23847,
    });
    const [record] = await loadGateways();
    // Re-seal with a broken tunnel by saving over it with a bad remotePort.
    await saveGateway({ ...PAYLOAD }, 'Build box', {
      hostId: 'host-9',
      remoteHost: '127.0.0.1',
      remotePort: 999999,
    } as never);
    const [reloaded] = await loadGateways();
    expect(reloaded.sshTunnel).toBeUndefined();
    expect(reloaded.serverId).toBe(record.serverId);
  });
});
