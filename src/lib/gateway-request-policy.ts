/**
 * Where a request's credentials are allowed to travel, decided before any
 * transport is touched.
 *
 * The shared client seals a request only when it is addressed to the gateway
 * it is configured for; anything else used to fall through to a plain fetch
 * with whatever `Authorization` header the caller had put on it. A caller that
 * built a request for a *stored* record -- another paired computer, reached
 * through its own credentials -- therefore put that record's bearer token on
 * the wire in the clear, even when the record had a transport key and every
 * other request to it was encrypted. These rules make that a refusal rather
 * than a silent downgrade.
 *
 * Pure and free of React Native so the decision has a unit test; the client
 * applies it in `sendGatewayRequest` and `gatewayEndpointFetch`.
 */

import { GATEWAY_TRANSPORT } from './gateway-transport-id';

/**
 * Deliberately names neither the origin nor any network word:
 * `describeGatewayFailure` reads failure text for "host", "connect" and the
 * like to decide a request failed on the network, and this did not.
 */
export const CLEARTEXT_TOKEN_REFUSAL =
  'Refusing to send a bearer token in the clear outside the configured gateway.';

/** Whether these request headers carry a bearer token, in any letter case. */
export function carriesBearerToken(headers: Readonly<Record<string, string>>): boolean {
  return Object.keys(headers).some((name) => name.toLowerCase() === 'authorization');
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Whether a plain (unsealed) request to `url` would put a bearer token in
 * front of an origin other than the configured gateway's.
 *
 * A relative URL resolves against the configured gateway, so it stays home;
 * an absolute one is foreign when its origin differs -- or when nothing is
 * configured at all, because then there is no gateway for it to be the same as.
 */
export function bearerLeavesGateway(
  url: string,
  configuredBaseUrl: string,
  headers: Readonly<Record<string, string>>
): boolean {
  if (!carriesBearerToken(headers)) return false;
  const target = originOf(url);
  if (target === null) return false;
  const gateway = originOf(configuredBaseUrl);
  return gateway === null || target !== gateway;
}

/**
 * How a stored record's own request travels: sealed with its transport key,
 * or -- only for a record paired before encryption existed and holding no key
 * -- in the clear with its bearer token. That plain route is the one place a
 * token may leave the configured gateway unsealed, and it is explicit: the
 * caller named the record and the record has nothing to seal with.
 */
export type EndpointCredentialRoute = 'sealed' | 'plain';

export function endpointCredentialRoute(endpoint: {
  transport?: string;
  deviceId?: string;
  transportKey?: string;
}): EndpointCredentialRoute {
  return endpoint.transport === GATEWAY_TRANSPORT && endpoint.deviceId && endpoint.transportKey
    ? 'sealed'
    : 'plain';
}
