import { t } from '@lingui/core/macro';

import {
  classifyTransportRefusal,
  GatewayTransportRefusalError,
  type TransportRefusal,
} from './gateway-refusal';

export type GatewayFailureKind = 'timeout' | 'network' | 'auth' | 'server' | 'request';

export type GatewayFailure = {
  kind: GatewayFailureKind;
  message: string;
  retryable: boolean;
  /**
   * Pairing this server again is the remedy. A screen that can offer pairing
   * should offer it instead of a Retry that cannot succeed.
   */
  needsPairing: boolean;
  /**
   * `HTTP 403 · invalid_token`. Present when the gateway named a status and a
   * code. Deliberately not translated and deliberately not the message: it is
   * for a developer reading a log, not for the person waiting on the screen.
   */
  detail?: string;
};

/**
 * Error `code`s the pairing endpoints answer with that are not "this device's
 * credentials are bad" -- they are a mid-pairing state a reader can act on
 * (wrong code, expired code, no request in flight, another one already is,
 * too many attempts) and every one of them rides on 401/403/409/410 the same
 * way a stale bearer token does. Without carving them out first, "wrong code"
 * and "your session was revoked" collapsed into the same "Pair this server
 * again." -- true of neither: a reader mid-pairing is not paired yet, and the
 * one thing they need to know is which of the two things went wrong.
 */
const PAIRING_ERROR_CODES = new Set([
  'invalid_pairing_code',
  'pairing_code_expired',
  'pairing_not_requested',
  'pairing_in_progress',
  'pairing_rate_limited',
  'encrypted_pairing_disabled',
]);

/**
 * Say what a pre-sealing refusal means, in this interface's voice.
 *
 * The gateway's own sentence is skipped for every reason this build recognises,
 * and that is the one place in this file where that is right: those sentences
 * are written for whoever is running the gateway ("invalid token", "pair this
 * device again to enable encrypted transport"), and the reader here is holding
 * a phone that has simply stopped working against a server it was using
 * yesterday. What they need is the situation and the way out of it.
 */
function describeTransportRefusal(refusal: TransportRefusal): GatewayFailure {
  const shared = {
    retryable: refusal.retryable,
    needsPairing: refusal.needsPairing,
    detail: refusal.detail,
  };
  switch (refusal.reason) {
    case 'not-paired':
      return {
        kind: 'auth',
        message: t`This server no longer recognises this device. Pair it again to reconnect.`,
        ...shared,
      };
    case 'stored-key-unusable':
      return {
        kind: 'auth',
        message: t`This server cannot use this device's stored key. Pair it again to reconnect.`,
        ...shared,
      };
    case 'unknown-host':
      return {
        kind: 'request',
        message: t`This Gateway does not answer to that address.`,
        ...shared,
      };
    case 'unreadable-request':
      return {
        kind: 'request',
        message: t`This server could not read the request. Check this device's date and time.`,
        ...shared,
      };
    case 'already-handled':
      return {
        kind: 'request',
        message: t`This server has already handled that request.`,
        ...shared,
      };
    case 'server-fault':
      return { kind: 'server', message: t`This server had a problem answering.`, ...shared };
    case 'refused':
      // Everything this build cannot name: a code from a newer gateway, a
      // captive portal's HTML, an empty body. Still better than the sentence
      // this replaced, which announced a missing encryption marker to someone
      // who could do nothing whatsoever with that.
      return {
        kind: refusal.status >= 500 ? 'server' : 'request',
        message: t`This server refused the request.`,
        ...shared,
      };
  }
  // No `default`, deliberately: the switch is exhaustive over
  // `TransportRefusalReason`, so adding a reason without a sentence for it is a
  // type error here rather than a silent fallback at runtime.
}

/**
 * Note what is *not* translated here: `apiMessage`, scraped out of the
 * gateway's JSON. That copy is the gateway's to write, and it arrives already
 * in the right language because every request carries `X-Muqun-Locale`. This is
 * exactly the half of the split the paired gateway card exists to fix -- the
 * app cannot translate a sentence it did not author.
 */
export function describeGatewayFailure(
  error: unknown,
  fallback = t`Request failed.`,
): GatewayFailure {
  // First, because it is the one case where the HTTP status is not enough to go
  // on. A pre-sealing refusal answers 403 for both `invalid_token` (pair again)
  // and `unknown_host` (pairing will not help at all), so the code decides.
  if (error instanceof GatewayTransportRefusalError) {
    return describeTransportRefusal(classifyTransportRefusal(error.status, error.body));
  }

  const raw = error instanceof Error ? error.message : String(error ?? '');
  const apiMessage = raw.match(/"message":"([^"]+)"/)?.[1];
  const apiCode = raw.match(/"code":"([^"]+)"/)?.[1];
  const status = Number(raw.match(/^HTTP (\d+):/)?.[1] ?? 0);
  const normalized = raw.toLowerCase();

  if (apiCode && PAIRING_ERROR_CODES.has(apiCode)) {
    return {
      kind: 'request',
      message: apiMessage ?? fallback,
      retryable: false,
      needsPairing: false,
    };
  }
  if (status === 401 || status === 403) {
    // Reached only by a refusal from *inside* the tunnel, or from a gateway not
    // using it at all: the bearer token is dead, and pairing is the remedy here
    // as well -- so this carries the flag that puts the action on screen.
    return {
      kind: 'auth',
      message: t`Pair this server again.`,
      retryable: false,
      needsPairing: true,
    };
  }
  if (status >= 500) {
    return {
      kind: 'server',
      message: apiMessage ?? t`Gateway is temporarily unavailable.`,
      retryable: true,
      needsPairing: false,
    };
  }
  if (status >= 400) {
    return {
      kind: 'request',
      message: apiMessage ?? fallback,
      retryable: false,
      needsPairing: false,
    };
  }
  if (normalized.includes('abort') || normalized.includes('timeout') || normalized.includes('timed out')) {
    return {
      kind: 'timeout',
      message: t`Gateway did not respond in time.`,
      retryable: true,
      needsPairing: false,
    };
  }
  if (
    normalized.includes('network')
    || normalized.includes('fetch')
    || normalized.includes('connect')
    || normalized.includes('socket')
    || normalized.includes('host')
    || normalized.includes('internet')
  ) {
    return {
      kind: 'network',
      message: t`Waiting for the network.`,
      retryable: true,
      needsPairing: false,
    };
  }
  return {
    kind: 'request',
    message: apiMessage ?? (raw.replace(/^HTTP \d+:\s*/, '') || fallback),
    retryable: false,
    needsPairing: false,
  };
}
