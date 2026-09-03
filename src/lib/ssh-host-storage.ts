import * as SecureStore from 'expo-secure-store';
import QuickCrypto from 'react-native-quick-crypto';

import {
  EMPTY_SSH_SECRETS,
  normalizeSshHostRecords,
  normalizeSshSecrets,
  type SshHostRecord,
  type SshSecrets,
} from '@/lib/ssh-hosts';

/**
 * Where SSH hosts and their secrets live on the device.
 *
 * The same shape as `gateway-storage.ts`, on purpose: a random 256-bit master
 * key in the keychain, and everything else sealed under it with AES-256-GCM
 * as one JSON blob per concern. Two blobs rather than one -- the host list,
 * and the passwords and private keys -- so the list can be read, listed and
 * edited without a credential ever being decrypted for it, and so forgetting a
 * host's secrets is a write to one blob rather than a scrub through the other.
 *
 * The master key is *not* the gateway's. Unpairing the last gateway deletes
 * that key's blobs, and a reader who keeps SSH hosts but drops their gateway
 * should not lose one with the other. The cost is thirty lines that look like
 * `gateway-storage.ts`, and they are kept here rather than shared so that a
 * change to how the gateway seals its tokens cannot silently change how SSH
 * keys are sealed.
 *
 * Private keys grant a login to someone else's machine, so like gateway
 * tokens they must not leave this device: `WHEN_UNLOCKED_THIS_DEVICE_ONLY`,
 * no iCloud Keychain, no restore onto another phone.
 */
const KEY_ID = 'muqun.ssh.encryption-key.v1';
const HOSTS_ID = 'muqun.ssh.hosts.v1';
const SECRETS_ID = 'muqun.ssh.secrets.v1';

const STORAGE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

interface EncryptedBlob {
  version: 1;
  iv: string;
  tag: string;
  data: string;
}

function toBase64(buffer: Uint8Array): string {
  return QuickCrypto.Buffer.from(buffer).toString('base64');
}

function fromBase64(value: string) {
  return QuickCrypto.Buffer.from(value, 'base64');
}

async function getOrCreateKey() {
  const existing = await SecureStore.getItemAsync(KEY_ID);
  if (existing) {
    // The accessibility class is a write-time attribute; rewriting is the only
    // way to correct a key an earlier build may have stored more loosely.
    await SecureStore.setItemAsync(KEY_ID, existing, STORAGE_OPTIONS);
    return fromBase64(existing);
  }
  const key = QuickCrypto.randomBytes(32);
  await SecureStore.setItemAsync(KEY_ID, toBase64(key), STORAGE_OPTIONS);
  return key;
}

async function encryptValue(value: unknown): Promise<string> {
  const key = await getOrCreateKey();
  const iv = QuickCrypto.randomBytes(12);
  const cipher = QuickCrypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = QuickCrypto.Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ]);
  const blob: EncryptedBlob = {
    version: 1,
    iv: toBase64(iv),
    tag: toBase64(cipher.getAuthTag()),
    data: toBase64(encrypted),
  };
  return JSON.stringify(blob);
}

async function decryptValue(value: string): Promise<unknown> {
  const key = await getOrCreateKey();
  const blob = JSON.parse(value) as EncryptedBlob;
  const decipher = QuickCrypto.createDecipheriv('aes-256-gcm', key, fromBase64(blob.iv));
  decipher.setAuthTag(fromBase64(blob.tag));
  const decrypted = QuickCrypto.Buffer.concat([
    decipher.update(fromBase64(blob.data)),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString('utf8'));
}

async function loadSealed(id: string): Promise<unknown> {
  const value = await SecureStore.getItemAsync(id);
  if (!value) return null;
  try {
    return await decryptValue(value);
  } catch {
    // A blob this key cannot open is a blob nothing can open: treat it as
    // absent rather than as a reason the screen cannot render.
    return null;
  }
}

/** Every host, normalised; anything unreadable is dropped. */
export async function loadSshHosts(): Promise<SshHostRecord[]> {
  return normalizeSshHostRecords(await loadSealed(HOSTS_ID));
}

/**
 * Always a write, even of an empty list: an empty sealed blob and no blob at
 * all read back the same, and one code path is one fewer to get wrong.
 */
export async function saveSshHosts(records: SshHostRecord[]): Promise<void> {
  await SecureStore.setItemAsync(HOSTS_ID, await encryptValue(records), STORAGE_OPTIONS);
}

/** The passwords and keys, normalised; unreadable means empty. */
export async function loadSshSecrets(): Promise<SshSecrets> {
  return normalizeSshSecrets(await loadSealed(SECRETS_ID));
}

export async function saveSshSecrets(secrets: SshSecrets): Promise<void> {
  await SecureStore.setItemAsync(SECRETS_ID, await encryptValue(secrets), STORAGE_OPTIONS);
}

export { EMPTY_SSH_SECRETS };
