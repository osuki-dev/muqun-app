export interface PairingOffer {
  url: string;
  /** Present for QR offers; resolved from the authenticated pairing flow for manual URLs. */
  serverId?: string;
  /** QR bootstrap secret. Absent when the Gateway owner disables encryption. */
  transportKey?: string;
  /**
   * Set when the pairing runs through an SSH tunnel: `url` is then the
   * loopback forward (`http://127.0.0.1:<port>`), which is ephemeral and must
   * not be what the record remembers -- see `validateClaimedPairing`. The
   * shape is `GatewaySshTunnel`, restated here so this module keeps importing
   * nothing.
   */
  sshTunnel?: { hostId: string; remoteHost: string; remotePort: number };
}

export interface ResolvedPairingOffer extends PairingOffer {
  serverId: string;
  /** QR offers pin the advertised URL; manual offers preserve the address the user entered. */
  verifyAdvertisedUrl: boolean;
  /** Manual pairing requires a sealed claim; legacy keyless QR pairing does not. */
  transportRequired: boolean;
}

export interface PairingPayload {
  kind: 'muqun-gateway';
  server_id: string;
  label: string;
  url: string;
  token: string;
  device_id?: string;
  transport_key?: string;
  transport?: 'muqun-aes-256-gcm-v1';
}

/**
 * The server id that means "this is not a machine, it is the bundled demo".
 *
 * It lives here rather than in `demo-gateway`, which is where it used to, so
 * that this module stays free of imports: the pairing rules are pure and
 * unit-tested, and `demo-gateway` reaches for `expo-asset`. `demo-gateway`
 * takes it from here instead, so there is still exactly one of it.
 */
export const DEMO_PAIRING_SERVER_ID = 'muqun-demo';

/**
 * Whether a scanned offer is the demo card rather than a Gateway.
 *
 * An App Store reviewer has no computer of ours to run a Gateway on, so the
 * pairing screen -- and the camera the app declares a use for -- could not be
 * assessed at all: the only way past it was a QR printed by a machine they do
 * not have. 1.3.0 was rejected for exactly that, and correctly. Scanning this
 * one opens the offline demo instead of starting a pairing.
 *
 * Deliberately not a feature. Nothing in the app names it, nothing in the store
 * copy mentions it, and it is not gated behind a build flag either -- the
 * reviewed binary has to be the binary that ships. Being found costs nothing:
 * it leads to the same demo the home screen already offers with one tap.
 *
 * The address such an offer carries is never dialled, and cannot be: the caller
 * short-circuits before any request, and the QR we hand out uses a `.invalid`
 * host, which RFC 2606 reserves precisely so that it can never resolve.
 */
export function isDemoPairingOffer(offer: PairingOffer): boolean {
  return offer.serverId === DEMO_PAIRING_SERVER_ID;
}

export const PAIRING_CODE_CHARACTER_COUNT = 8;
export const PAIRING_CODE_LENGTH = PAIRING_CODE_CHARACTER_COUNT + 1;
const PAIRING_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const SERVER_ID_PATTERN = /^[A-Za-z0-9._-]{1,80}$/;

export function validateServerId(value: string): string {
  if (!SERVER_ID_PATTERN.test(value)) {
    throw new Error('Gateway server ID is not valid.');
  }
  return value;
}

export function validateGatewayUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error('Gateway URL is not valid.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Gateway URL must use http:// or https://.');
  }
  if (!parsed.hostname) {
    throw new Error('Gateway URL must include a host.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Gateway URL cannot contain credentials.');
  }
  if (parsed.search || parsed.hash) {
    throw new Error('Gateway URL cannot contain a query or fragment.');
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  return parsed.toString().replace(/\/$/, '');
}

export function normalizePairingCode(value: string): string {
  const characters = value
    .trim()
    .toUpperCase()
    .split('')
    .filter((character) => PAIRING_CODE_ALPHABET.includes(character))
    .join('')
    .slice(0, PAIRING_CODE_CHARACTER_COUNT);
  return characters.length > 4 ? `${characters.slice(0, 4)}-${characters.slice(4)}` : characters;
}

export function parsePairingOffer(value: string): PairingOffer {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('QR is not a valid Muqun pairing URL.');
  }

  if (parsed.protocol !== 'muqun:') {
    throw new Error('QR does not use the muqun:// scheme.');
  }

  const url = parsed.searchParams.get('u');
  const serverId = parsed.searchParams.get('s');
  const transportKey = parsed.searchParams.get('k');
  if (!url || !serverId) {
    throw new Error('Pairing QR is missing gateway URL or server ID.');
  }

  return {
    url: validateGatewayUrl(url),
    serverId: validateServerId(serverId),
    ...(transportKey ? { transportKey } : {}),
  };
}

export function normalizeGatewayUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  // Only infer HTTP when the user entered a bare host. An explicit unsupported
  // scheme such as ftp:// must reach validateGatewayUrl unchanged; prefixing
  // it produced a syntactically valid but unintended http://ftp://... target.
  const hasExplicitScheme = /^[A-Za-z][A-Za-z0-9+.-]*:/.test(trimmed);
  return validateGatewayUrl(hasExplicitScheme ? trimmed : `http://${trimmed}`);
}

/**
 * Validate the untrusted claim before it is persisted as a gateway record.
 *
 * A manually entered address has no QR bootstrap key. It therefore requires
 * the code-sealed response and encrypted transport fields by policy; accepting
 * a token-only payload here would turn a stripped response into a silent
 * downgrade. A keyless QR remains the explicit legacy escape hatch because
 * the owner chose Disabled mode before presenting that QR.
 */
export function validateClaimedPairing(
  offer: ResolvedPairingOffer,
  payload: PairingPayload
): PairingPayload {
  if (payload.kind !== 'muqun-gateway') {
    throw new Error('Pairing response is not a Muqun gateway.');
  }
  const serverId = validateServerId(payload.server_id);
  if (serverId !== offer.serverId) {
    throw new Error('Pairing response does not match the scanned server.');
  }
  const advertisedUrl = validateGatewayUrl(payload.url);
  const requestedUrl = validateGatewayUrl(offer.url);
  if (offer.verifyAdvertisedUrl && advertisedUrl !== requestedUrl) {
    throw new Error('Pairing response changed the gateway address.');
  }
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(payload.token)) {
    throw new Error('Pairing response contains an invalid access token.');
  }
  if (
    offer.transportRequired ||
    payload.transport !== undefined ||
    payload.transport_key !== undefined
  ) {
    if (payload.transport !== 'muqun-aes-256-gcm-v1') {
      throw new Error('Gateway did not enable encrypted transport.');
    }
    if (!payload.device_id || !/^[A-Za-z0-9._-]{1,80}$/.test(payload.device_id)) {
      throw new Error('Pairing response contains an invalid device identity.');
    }
    if (!payload.transport_key || !/^[A-Za-z0-9_-]{43}$/.test(payload.transport_key)) {
      throw new Error('Pairing response contains an invalid device encryption key.');
    }
  }
  if (
    !payload.label.trim() ||
    payload.label.length > 80 ||
    /[\u0000-\u001F\u007F]/.test(payload.label)
  ) {
    throw new Error('Pairing response contains an invalid server name.');
  }
  return {
    ...payload,
    server_id: serverId,
    // The manually entered address is the one the request/claim exchange
    // reached. Through an SSH tunnel that address is a loopback port that will
    // not exist next time, so the record keeps the gateway's own advertised URL
    // and reaches it through the tunnel named on the record instead.
    url: offer.verifyAdvertisedUrl || offer.sshTunnel ? advertisedUrl : requestedUrl,
    label: payload.label.trim(),
  };
}
