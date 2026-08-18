import * as SecureStore from 'expo-secure-store';
import QuickCrypto from 'react-native-quick-crypto';

import type { PairingPayload } from './pairing';

const KEY_ID = 'muqun.gateway.encryption-key.v1';
const LEGACY_RECORD_ID = 'muqun.gateway.current.v1';
const RECORDS_ID = 'muqun.gateway.records.v1';
const SELECTED_RECORD_ID = 'muqun.gateway.selected-server-id.v1';
/**
 * Gateway tokens grant full control of a developer's machine, so they must not
 * leave this device: no iCloud Keychain sync, no restoring onto another phone
 * from a backup.
 */
const STORAGE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export interface GatewayRecord {
  serverId: string;
  label: string;
  url: string;
  token: string;
  deviceId?: string;
  transportKey?: string;
  transport?: 'muqun-aes-256-gcm-v1';
  pairedAt: number;
}

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
    // `keychainAccessible` is a write-time attribute, so a key created by a
    // build that predates STORAGE_OPTIONS keeps that build's weaker class --
    // which is backed up and restores onto another phone. Rewriting it is the
    // only way to correct the attributes of an item that already exists.
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

async function decryptValue<T>(value: string): Promise<T> {
  const key = await getOrCreateKey();
  const blob = JSON.parse(value) as EncryptedBlob;
  const decipher = QuickCrypto.createDecipheriv('aes-256-gcm', key, fromBase64(blob.iv));
  decipher.setAuthTag(fromBase64(blob.tag));
  const decrypted = QuickCrypto.Buffer.concat([
    decipher.update(fromBase64(blob.data)),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString('utf8')) as T;
}

function normalizeRecord(record: GatewayRecord): GatewayRecord {
  return {
    ...record,
    url: record.url.replace(/\/$/, ''),
  };
}

async function saveRecords(records: GatewayRecord[]): Promise<void> {
  await SecureStore.setItemAsync(RECORDS_ID, await encryptValue(records.map(normalizeRecord)), STORAGE_OPTIONS);
}

async function loadLegacyRecord(): Promise<GatewayRecord | null> {
  const value = await SecureStore.getItemAsync(LEGACY_RECORD_ID);
  if (!value) return null;
  try {
    return normalizeRecord(await decryptValue<GatewayRecord>(value));
  } catch {
    return null;
  }
}

export async function loadGateways(): Promise<GatewayRecord[]> {
  const value = await SecureStore.getItemAsync(RECORDS_ID);
  if (value) {
    try {
      return (await decryptValue<GatewayRecord[]>(value)).map(normalizeRecord);
    } catch {
      return [];
    }
  }

  const legacy = await loadLegacyRecord();
  if (!legacy) return [];
  await saveRecords([legacy]);
  await SecureStore.setItemAsync(SELECTED_RECORD_ID, legacy.serverId, STORAGE_OPTIONS);
  // Leaving the old entry behind would keep a second copy of the token under
  // whatever accessibility class the build that wrote it used. Now that it has
  // been migrated, it is only a liability.
  await SecureStore.deleteItemAsync(LEGACY_RECORD_ID);
  return [legacy];
}

export async function saveGateway(
  payload: PairingPayload,
  displayName?: string
): Promise<GatewayRecord> {
  const preferredLabel = displayName?.trim();
  const record = normalizeRecord({
    serverId: payload.server_id,
    label: preferredLabel || payload.label,
    url: payload.url,
    token: payload.token,
    deviceId: payload.device_id,
    transportKey: payload.transport_key,
    transport: payload.transport,
    pairedAt: Date.now(),
  });
  const records = await loadGateways();
  const nextRecords = [
    record,
    ...records.filter((item) => item.serverId !== record.serverId),
  ];
  await saveRecords(nextRecords);
  await SecureStore.setItemAsync(SELECTED_RECORD_ID, record.serverId, STORAGE_OPTIONS);
  return record;
}

export async function loadGateway(): Promise<GatewayRecord | null> {
  const records = await loadGateways();
  if (records.length === 0) return null;
  const selectedServerId = await SecureStore.getItemAsync(SELECTED_RECORD_ID);
  return records.find((record) => record.serverId === selectedServerId) ?? records[0];
}

export async function selectGateway(serverId: string): Promise<GatewayRecord | null> {
  const records = await loadGateways();
  const record = records.find((item) => item.serverId === serverId) ?? null;
  if (!record) return null;
  await SecureStore.setItemAsync(SELECTED_RECORD_ID, record.serverId, STORAGE_OPTIONS);
  return record;
}

export async function renameGateway(serverId: string, label: string): Promise<GatewayRecord[]> {
  const trimmed = label.trim();
  const records = (await loadGateways()).map((record) =>
    record.serverId === serverId ? normalizeRecord({ ...record, label: trimmed || record.label }) : record
  );
  await saveRecords(records);
  return records;
}

/**
 * Change what a paired record says about itself -- its name, or where it is
 * reached -- without touching its credentials.
 *
 * The pairing keys on `serverId` and the token/device/transport-key the
 * gateway issued for it, never on `url`: every request built from a record
 * (`gateway-client.ts`'s `configureApi`) sends the token over whatever `url`
 * happens to be configured, and the gateway authenticates the token, not the
 * address it arrived from. So repointing `url` is exactly "the same paired
 * server, reached somewhere else" -- the credentials travel forward
 * unchanged, and nothing here has to re-pair.
 */
export async function updateGateway(
  serverId: string,
  changes: { label?: string; url?: string }
): Promise<GatewayRecord[]> {
  const records = (await loadGateways()).map((record) => {
    if (record.serverId !== serverId) return record;
    const label =
      changes.label !== undefined ? changes.label.trim() || record.label : record.label;
    const url = changes.url !== undefined ? changes.url : record.url;
    return normalizeRecord({ ...record, label, url });
  });
  await saveRecords(records);
  return records;
}

export async function removeGateway(serverId: string): Promise<GatewayRecord[]> {
  const records = (await loadGateways()).filter((record) => record.serverId !== serverId);
  await saveRecords(records);
  const selected = await SecureStore.getItemAsync(SELECTED_RECORD_ID);
  if (selected === serverId || records.length === 0) {
    const next = records[0] ?? null;
    if (next) {
      await SecureStore.setItemAsync(SELECTED_RECORD_ID, next.serverId, STORAGE_OPTIONS);
    } else {
      await SecureStore.deleteItemAsync(SELECTED_RECORD_ID);
      await SecureStore.deleteItemAsync(RECORDS_ID);
    }
  }
  return records;
}

export async function clearGateway(): Promise<void> {
  const current = await loadGateway();
  if (!current) return;
  const records = (await loadGateways()).filter((record) => record.serverId !== current.serverId);
  await saveRecords(records);
  const next = records[0] ?? null;
  if (next) {
    await SecureStore.setItemAsync(SELECTED_RECORD_ID, next.serverId, STORAGE_OPTIONS);
  } else {
    await SecureStore.deleteItemAsync(SELECTED_RECORD_ID);
    await SecureStore.deleteItemAsync(RECORDS_ID);
    await SecureStore.deleteItemAsync(LEGACY_RECORD_ID);
  }
}
