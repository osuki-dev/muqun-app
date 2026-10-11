import { createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Explicitly disabled until infrastructure and the native signing trust anchor are ready. */
export function readHotUpdaterAppConfig(
  env: Readonly<Record<string, string | undefined>>,
  projectRoot: string
) {
  const enabled = env.EXPO_PUBLIC_HOT_UPDATER_ENABLED === '1';
  const channel = env.HOT_UPDATER_CHANNEL ?? 'development';
  if (!['development', 'preview', 'production', 'ota-test'].includes(channel)) {
    throw new Error('HOT_UPDATER_CHANNEL must be development, preview, production or ota-test');
  }
  if (!enabled) return { enabled, channel, clientApiKey: undefined, publicKeyPath: undefined };
  const clientApiKey = env.EXPO_PUBLIC_HOT_UPDATER_API_KEY?.trim();
  if (!clientApiKey || /[\r\n]/.test(clientApiKey)) {
    throw new Error('Enabled OTA requires a registered EXPO_PUBLIC_HOT_UPDATER_API_KEY');
  }
  const publicKeyPath = './keys/hot-updater-public.pem';
  const pem = readFileSync(resolve(projectRoot, publicKeyPath), 'utf8');
  if (!pem.startsWith('-----BEGIN PUBLIC KEY-----')) {
    throw new Error('OTA requires an SPKI public key, never a private key');
  }
  const key = createPublicKey(pem);
  if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) {
    throw new Error('OTA signing requires an RSA public key of at least 2048 bits');
  }
  return { enabled, channel, clientApiKey, publicKeyPath };
}
