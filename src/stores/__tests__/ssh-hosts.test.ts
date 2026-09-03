// The host store on the round trip: records and secrets sealed into two
// keychain blobs, read back, edited, and forgotten -- with Node's crypto
// standing in for the phone's and a map standing in for the keychain.
import * as bunTest from 'bun:test';
import nodeCrypto from 'node:crypto';

const { beforeEach, describe, expect, test } = bunTest;
const { module: mockModule } = (
  bunTest as unknown as { mock: { module: (id: string, factory: () => unknown) => void } }
).mock;

let vault: Record<string, string> = {};

mockModule('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'whenUnlockedThisDeviceOnly',
  getItemAsync: async (key: string) => vault[key] ?? null,
  setItemAsync: async (key: string, value: string) => {
    vault[key] = value;
  },
}));

// The storage layer only uses the subset of QuickCrypto that mirrors Node's
// own API, which is the point of the mirror.
mockModule('react-native-quick-crypto', () => ({
  default: {
    Buffer,
    randomBytes: (size: number) => nodeCrypto.randomBytes(size),
    createCipheriv: nodeCrypto.createCipheriv,
    createDecipheriv: nodeCrypto.createDecipheriv,
  },
}));

const { useSshHostsStore } = await import('../ssh-hosts');
const { loadSshSecrets, loadSshHosts } = await import('@/lib/ssh-host-storage');

const store = useSshHostsStore;
const initial = { ...store.getState() };

function reset() {
  vault = {};
  store.setState({ ...initial, hosts: [], loading: true });
}

beforeEach(reset);

const INPUT = {
  label: 'Build box',
  host: '10.0.0.5',
  port: 2222,
  username: 'ci',
  credential: { type: 'password' as const, password: 'hunter2' },
};

describe('hydrate', () => {
  test('a fresh install has no hosts and is no longer loading', async () => {
    await store.getState().hydrate();
    expect(store.getState().hosts).toEqual([]);
    expect(store.getState().loading).toBe(false);
  });
});

describe('addHost', () => {
  test('writes the record and the password into two sealed blobs', async () => {
    const record = await store.getState().addHost(INPUT);
    expect(record.auth).toEqual({ type: 'password' });
    expect(store.getState().hosts).toEqual([record]);

    // Nothing in the keychain is plaintext.
    for (const value of Object.values(vault)) {
      expect(value).not.toContain('hunter2');
      expect(value).not.toContain('10.0.0.5');
    }
    expect(Object.keys(vault).sort()).toEqual([
      'muqun.ssh.encryption-key.v1',
      'muqun.ssh.hosts.v1',
      'muqun.ssh.secrets.v1',
    ]);

    // And it all comes back after a restart.
    store.setState({ ...initial, hosts: [], loading: true });
    await store.getState().hydrate();
    expect(store.getState().hosts).toEqual([record]);
    expect(await store.getState().credentialFor(record)).toEqual({
      type: 'password',
      password: 'hunter2',
    });
  });

  test('a key credential gets its own key id and keeps its passphrase', async () => {
    const record = await store.getState().addHost({
      ...INPUT,
      credential: { type: 'privateKey', privateKey: 'PEM', passphrase: 'pp' },
    });
    expect(record.auth.type).toBe('privateKey');
    if (record.auth.type !== 'privateKey') return;
    expect(record.auth.keyId.startsWith('key-')).toBe(true);
    expect(await store.getState().credentialFor(record)).toEqual({
      type: 'privateKey',
      privateKey: 'PEM',
      passphrase: 'pp',
    });
  });
});

describe('updateHost', () => {
  test('keeps the stored secret when the form sends none', async () => {
    const record = await store.getState().addHost(INPUT);
    await store.getState().updateHost(record.id, { ...INPUT, label: 'Renamed' });
    const [updated] = store.getState().hosts;
    expect(updated.label).toBe('Renamed');
    expect(await store.getState().credentialFor(updated)).toEqual({
      type: 'password',
      password: 'hunter2',
    });
  });

  test('switching to a key drops the password and writes the key', async () => {
    const record = await store.getState().addHost(INPUT);
    await store.getState().updateHost(record.id, {
      ...INPUT,
      credential: { type: 'privateKey', privateKey: 'PEM' },
    });
    const [updated] = store.getState().hosts;
    expect(updated.auth.type).toBe('privateKey');
    const secrets = await loadSshSecrets();
    expect(secrets.passwords).toEqual({});
    expect(Object.values(secrets.keys)).toEqual([{ privateKey: 'PEM' }]);
  });

  test('a new address forgets the old host key; a rename keeps it', async () => {
    const record = await store.getState().addHost(INPUT);
    const key = { algorithm: 'ssh-ed25519', fingerprint: 'SHA256:x', publicKey: 'AAAA' };
    await store.getState().setTrustedHostKey(record.id, key);
    expect(store.getState().hosts[0].trustedHostKey).toEqual(key);

    await store.getState().updateHost(record.id, { ...INPUT, label: 'Renamed' });
    expect(store.getState().hosts[0].trustedHostKey).toEqual(key);

    await store.getState().updateHost(record.id, { ...INPUT, host: '10.0.0.6' });
    expect(store.getState().hosts[0].trustedHostKey).toBeUndefined();
  });
});

describe('removeHost', () => {
  test('takes the record and its secret with it', async () => {
    const record = await store.getState().addHost(INPUT);
    await store.getState().removeHost(record.id);
    expect(store.getState().hosts).toEqual([]);
    expect(await loadSshHosts()).toEqual([]);
    expect(await loadSshSecrets()).toEqual({ passwords: {}, keys: {} });
    // Sealed, so the removed password is not in the keychain in any form.
    for (const value of Object.values(vault)) expect(value).not.toContain('hunter2');
  });
});

describe('setTrustedHostKey and markConnected', () => {
  test('null forgets the key, and a connection moves the host to the top', async () => {
    const first = await store.getState().addHost({ ...INPUT, label: 'first' });
    const second = await store.getState().addHost({ ...INPUT, label: 'second' });
    expect(store.getState().hosts.map((host) => host.label)).toEqual(['second', 'first']);

    await store.getState().setTrustedHostKey(first.id, {
      algorithm: 'ssh-ed25519',
      fingerprint: 'SHA256:x',
      publicKey: 'AAAA',
    });
    await store.getState().setTrustedHostKey(first.id, null);
    expect(
      store.getState().hosts.find((host) => host.id === first.id)?.trustedHostKey
    ).toBeUndefined();

    await store.getState().markConnected(first.id);
    expect(store.getState().hosts.map((host) => host.label)).toEqual(['first', 'second']);
    expect(store.getState().hosts[0].lastConnectedAt).toBeGreaterThan(0);
    expect(second.lastConnectedAt).toBeUndefined();
  });
});

describe('a damaged blob', () => {
  test('reads as empty rather than throwing', async () => {
    await store.getState().addHost(INPUT);
    vault['muqun.ssh.hosts.v1'] = '{"version":1,"iv":"AAAA","tag":"AAAA","data":"AAAA"}';
    store.setState({ ...initial, hosts: [], loading: true });
    await store.getState().hydrate();
    expect(store.getState().hosts).toEqual([]);
  });
});
