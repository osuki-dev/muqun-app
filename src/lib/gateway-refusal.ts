/**
 * What the gateway said when it refused before it could encrypt.
 *
 * The gateway's `encrypted_transport` middleware seals a response only once the
 * request has authenticated. Everything it can refuse on the way there --
 * unknown host, unknown device, dead token, missing transport key, replayed
 * nonce -- is therefore answered in PLAINTEXT, with no `x-muqun-transport: 1`
 * marker on it. The app used to notice only the absent marker and say "Gateway
 * did not return an encrypted response", which named a transport symptom to a
 * reader whose actual situation was that the server had lost their device
 * record and pairing again was the one thing that would fix it.
 *
 * The reason is in the plaintext body, so this module reads it. It is
 * deliberately free of Lingui macros: the decision (status + code -> what kind
 * of situation this is) is pure and unit-tested here, and the sentence a person
 * reads is chosen from the reason in `network-error.ts`, where the catalogs are.
 */

/** How long a refusal body is worth keeping on the error. */
const MAX_REFUSAL_BODY = 1000;

/**
 * A gateway answer that arrived without the encrypted-transport marker.
 *
 * Carried as its own type rather than folded into the `HTTP <status>: <body>`
 * string the rest of the client throws, because the two need different
 * readings: a bare 403 from a route inside the tunnel really does mean the
 * bearer token is dead, while a 403 at the transport gate might equally be
 * `unknown_host`, which no amount of pairing will fix.
 */
export class GatewayTransportRefusalError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    // A captive portal or a misaddressed proxy answers with a full HTML page.
    // Truncating here keeps that page out of every log line and toast that
    // ends up rendering `error.message`.
    const kept = body.slice(0, MAX_REFUSAL_BODY);
    super(`HTTP ${status}: ${kept}`);
    this.name = 'GatewayTransportRefusalError';
    this.status = status;
    this.body = kept;
  }
}

/**
 * The situations a pre-sealing refusal can describe, named for what the reader
 * is in rather than for the code that reported it. Several codes share a reason
 * because they share a remedy; `unknown_host` and `invalid_token` are both 403
 * and do not, which is why the code decides this and the status does not.
 */
export type TransportRefusalReason =
  /** This gateway has no record of this device: `invalid_token`, `device_repair_required`. */
  | 'not-paired'
  /** The device record exists but its stored transport key is unusable. */
  | 'stored-key-unusable'
  /** The gateway does not answer to the address it was reached at. */
  | 'unknown-host'
  /** The sealed request would not open -- in practice, a device clock past the 5 minute skew. */
  | 'unreadable-request'
  /** This exact request was already handled; a fresh one carries a fresh nonce. */
  | 'already-handled'
  /** The gateway failed against itself. Nothing on this device caused it. */
  | 'server-fault'
  /** Refused, and the reason is not one this build knows how to explain. */
  | 'refused';

export type TransportRefusal = {
  reason: TransportRefusalReason;
  status: number;
  /** The gateway's stable error code, absent when the body carried none. */
  code?: string;
  /** The gateway's own sentence. Already localized -- it honours `X-Muqun-Locale`. */
  apiMessage?: string;
  retryable: boolean;
  /** Pairing this server again is the remedy, and the screen should offer it. */
  needsPairing: boolean;
  /** `HTTP 403 · invalid_token`. For a developer reading a log, never a headline. */
  detail: string;
};

type Classification = {
  reason: TransportRefusalReason;
  retryable: boolean;
  needsPairing: boolean;
};

/**
 * Every code the gateway can emit before it seals, read from `known_host`,
 * `decrypt_transport_request`, `remember_transport_nonce` and
 * `encrypt_transport_response` in muqun-gateway's `main.rs`.
 *
 * `transport_key_unavailable` sits in the pairing family on purpose. It is a
 * 500, but it means the stored transport key on the device record will not
 * decode -- the corrupt-key sibling of `device_repair_required`, whose missing
 * key the gateway itself answers with "pair this device again". Pairing rewrites
 * that key; retrying does not.
 */
const REFUSALS: Record<string, Classification> = {
  invalid_token: { reason: 'not-paired', retryable: false, needsPairing: true },
  device_repair_required: { reason: 'not-paired', retryable: false, needsPairing: true },
  transport_key_unavailable: {
    reason: 'stored-key-unusable',
    retryable: false,
    needsPairing: true,
  },
  unknown_host: { reason: 'unknown-host', retryable: false, needsPairing: false },
  invalid_envelope: { reason: 'unreadable-request', retryable: false, needsPairing: false },
  replayed_request: { reason: 'already-handled', retryable: true, needsPairing: false },
  device_lock_failed: { reason: 'server-fault', retryable: true, needsPairing: false },
  replay_cache_failed: { reason: 'server-fault', retryable: true, needsPairing: false },
  response_too_large: { reason: 'server-fault', retryable: true, needsPairing: false },
  // The request authenticated and then failed to unpack: the app built the
  // envelope wrong, or a proxy stripped the device header. A reader cannot act
  // on either, so they say only that the request was refused.
  missing_transport_device: { reason: 'refused', retryable: false, needsPairing: false },
  invalid_request: { reason: 'refused', retryable: false, needsPairing: false },
  invalid_content_type: { reason: 'refused', retryable: false, needsPairing: false },
};

type ApiErrorBody = { code?: string; message?: string };

/**
 * Pull `{"error":{"code":…,"message":…}}` out of a body that may be anything.
 *
 * Anything is not hypothetical: a captive portal answers HTML, a dead reverse
 * proxy answers an empty body, and a gateway newer than this build answers a
 * code that is not in `REFUSALS`. All three have to survive as a refusal that
 * still says something true.
 */
function readApiError(body: string): ApiErrorBody {
  if (!body.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null) return {};
  const error = (parsed as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) return {};
  const { code, message } = error as { code?: unknown; message?: unknown };
  return {
    ...(typeof code === 'string' && code ? { code } : {}),
    ...(typeof message === 'string' && message ? { message } : {}),
  };
}

/** `HTTP 403 · invalid_token`, or just the status when the body named no code. */
function refusalDetail(status: number, code?: string): string {
  return code ? `HTTP ${status} · ${code}` : `HTTP ${status}`;
}

export function classifyTransportRefusal(status: number, body: string): TransportRefusal {
  const { code, message } = readApiError(body);
  const known = code ? REFUSALS[code] : undefined;
  const classification: Classification = known ?? {
    reason: 'refused',
    // An unrecognised 5xx is still the gateway's own fault and still worth
    // another attempt; an unrecognised 4xx will refuse identically forever.
    retryable: status >= 500,
    needsPairing: false,
  };
  return {
    ...classification,
    status,
    ...(code ? { code } : {}),
    ...(message ? { apiMessage: message } : {}),
    detail: refusalDetail(status, code),
  };
}
