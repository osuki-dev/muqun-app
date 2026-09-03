import * as SecureStore from 'expo-secure-store';
import QuickCrypto from 'react-native-quick-crypto';

import { claimPairing, requestPairing } from '@/lib/gateway-client';
import { codePairingMaterial } from '@/lib/gateway-transport';
import { saveGateway, type GatewayRecord } from '@/lib/gateway-storage';
import {
  validateClaimedPairing,
  validateServerId,
  type PairingOffer,
  type ResolvedPairingOffer,
} from '@/lib/pairing';

/**
 * The request id decides which pending pairing slot a claim targets, so it
 * comes from the CSPRNG rather than Math.random. It lives here rather than in
 * `pairing.ts` to keep that module's validators free of native imports.
 */
export function createRequestId(): string {
  const random = QuickCrypto.randomBytes(12).toString('base64url');
  return `muqun-${Date.now().toString(36)}-${random}`;
}

const INSTALL_ID_KEY = 'muqun.install-id.v1';

/**
 * A stable identifier for this app install, generated once and kept. The
 * gateway uses it to replace an earlier pairing from the same device instead of
 * accumulating a duplicate record every time you re-pair.
 */
export async function getInstallId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(INSTALL_ID_KEY);
  if (existing) return existing;
  const id = QuickCrypto.randomBytes(16).toString('hex');
  await SecureStore.setItemAsync(INSTALL_ID_KEY, id, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return id;
}

export interface PairingRequest {
  offer: ResolvedPairingOffer;
  requestId: string;
  serverLabel: string;
  expiresAt?: number;
}

export async function beginPairingTransaction(
  offer: PairingOffer,
  deviceName: string
): Promise<PairingRequest> {
  const requestId = createRequestId();
  const installId = await getInstallId();
  // A QR without a bootstrap key means the owner explicitly disabled
  // application transport encryption on the Gateway. Keep supporting that
  // token-only mode; the Gateway manager is responsible for the warning.
  const response = await requestPairing(
    offer.url,
    requestId,
    deviceName,
    installId,
    offer.transportKey
  );
  const serverId = validateServerId(response.server_id);
  if (offer.serverId !== undefined && serverId !== offer.serverId) {
    throw new Error('Pairing response does not match the scanned server.');
  }
  return {
    offer: {
      ...offer,
      serverId,
      verifyAdvertisedUrl: offer.serverId !== undefined,
      // A typed address must never fall back to token-only transport. A
      // keyless QR remains the explicit compatibility signal from a Gateway
      // whose owner selected Disabled mode.
      transportRequired: offer.serverId === undefined || Boolean(offer.transportKey),
    },
    requestId,
    serverLabel: response.server_label || 'Server',
    expiresAt: response.expires_in_ms ? Date.now() + response.expires_in_ms : undefined,
  };
}

export async function claimPairingTransaction(
  request: PairingRequest,
  code: string,
  displayName?: string
): Promise<GatewayRecord> {
  const normalizedCode = code.trim().toUpperCase();
  // A QR's key already seals this leg. Without one -- typing an address
  // rather than scanning it -- the code just entered is the only thing that
  // can: derive the same material the gateway derives from the code it is
  // about to check, so a `Required` gateway's response can be opened without
  // ever having seen a QR. Wasted work if the gateway turns out to be
  // `Disabled` and answers in the clear, but computing it costs one pairing
  // attempt's worth of Argon2id, not a network round trip.
  const codeMaterial = request.offer.transportKey
    ? undefined
    : await codePairingMaterial(normalizedCode, request.requestId);
  const payload = await claimPairing(
    request.offer.url,
    request.requestId,
    normalizedCode,
    request.offer.transportKey,
    codeMaterial,
    request.offer.transportRequired
  );
  // A pairing that ran through an SSH tunnel records which host it rode on, so
  // the workspace can open the same forward next time. The tunnel URL itself
  // is not stored (see `validateClaimedPairing`).
  return saveGateway(
    validateClaimedPairing(request.offer, payload),
    displayName,
    request.offer.sshTunnel
  );
}
