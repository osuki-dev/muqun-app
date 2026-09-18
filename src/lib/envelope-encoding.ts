/**
 * Compression inside the encrypted envelope.
 *
 * The problem it answers: the gateway's envelope transport seals a response
 * before anything downstream can compress it, and ciphertext does not compress.
 * Base64 in and base64 out puts the inflation at about 1.78x, so an encrypted
 * pairing pays nearly twice the bytes of a cleartext one for the same JSON --
 * and the bodies are not small. Measured on the deployed gateway: the catalog
 * is 136 kB and gzips to 25 kB, the sessions list 21.5 kB to 3.5 kB, a pane's
 * output 18.9 kB to 6.7 kB.
 *
 * A cleartext response needs none of this. Cronet on Android and NSURLSession
 * on iOS both send `Accept-Encoding` and decompress transparently, which is
 * why nothing here touches that header -- setting it by hand is how an app
 * ends up holding a gzip body the platform has stopped decoding for it.
 *
 * So the compression has to happen *inside* the sealed payload, and this is
 * the half of that contract the app owns: advertise it on the request, and
 * inflate what comes back when the gateway says it took the offer. Opt-in in
 * both directions -- a gateway that has never heard of the header answers the
 * way it always did, and an app talking to one gets an uncompressed payload
 * with no flag on it and does nothing.
 *
 * The flag's name is the gateway's to fix, and it had not landed when this was
 * written (nothing in the gateway's `docs/agent-api.md` names one). All three
 * plausible spellings are read: a `content_encoding` field on the sealed
 * payload, and `content-encoding` or `content_encoding` inside its headers
 * map. Whichever the gateway settles on, this reads it; the request header is
 * the part both sides have to agree on up front.
 */
import { gunzipSync } from 'fflate';

/** What an encrypted request advertises. Read by the gateway, not by a proxy. */
export const ENVELOPE_ACCEPT_HEADER = 'X-Muqun-Envelope-Accept';

/**
 * What this app can inflate. One token, because one is what `fflate` buys
 * without a native module and what the gateway can produce without one either.
 */
export const ENVELOPE_ACCEPT_ENCODINGS = 'gzip';

/** As much of the sealed response payload as the encoding depends on. */
export interface SealedResponseEncoding {
  headers: Record<string, string>;
  /** The gateway's flag, if it puts one beside the headers rather than in them. */
  content_encoding?: unknown;
}

function isContentEncoding(name: string): boolean {
  return name.toLowerCase().replaceAll('_', '-') === 'content-encoding';
}

/**
 * What the gateway says it did to the body, in whichever place it says it.
 * Null is the ordinary answer: an uncompressed payload carries no flag.
 */
export function sealedBodyEncoding(payload: SealedResponseEncoding): string | null {
  if (typeof payload.content_encoding === 'string' && payload.content_encoding.trim()) {
    return payload.content_encoding.trim().toLowerCase();
  }
  for (const [name, value] of Object.entries(payload.headers ?? {})) {
    if (isContentEncoding(name) && typeof value === 'string' && value.trim()) {
      return value.trim().toLowerCase();
    }
  }
  return null;
}

/**
 * The headers the reconstructed response should carry.
 *
 * Both of these described the body on the wire and describe nothing once it
 * has been inflated. `content-encoding` left in place would tell every reader
 * downstream to decode a body that is already decoded, and `content-length`
 * would be the compressed length -- a number that is now simply wrong, and one
 * that a `Response` is entitled to believe.
 */
function withoutEncodingHeaders(headers: Record<string, string>): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    const normalized = name.toLowerCase().replaceAll('_', '-');
    if (normalized === 'content-encoding' || normalized === 'content-length') continue;
    kept[name] = value;
  }
  return kept;
}

/**
 * The body the caller should read, and the headers that describe it.
 *
 * Inflating is synchronous, which is the right trade at these sizes: the
 * largest body the gateway serves is a couple of hundred kilobytes, and the
 * alternative -- a streaming inflate yielding to the frame loop, as the theme
 * unpacker does for multi-megabyte archives -- would cost more in scheduling
 * than it saves. The bytes are already fully in hand and already authenticated
 * by the time they arrive here.
 *
 * Throws rather than guessing. The payload has been opened and authenticated,
 * so anything wrong with it is a disagreement between the two implementations,
 * and reading a body the gateway said was compressed as if it were not would
 * surface as unparseable JSON somewhere far from the cause.
 */
export function decodeSealedBody(
  bytes: Uint8Array,
  payload: SealedResponseEncoding
): { bytes: Uint8Array; headers: Record<string, string> } {
  const encoding = sealedBodyEncoding(payload);
  // The overwhelmingly common answer, and the only one an older gateway gives.
  if (encoding === null) return { bytes, headers: payload.headers };
  if (encoding === 'identity') return { bytes, headers: withoutEncodingHeaders(payload.headers) };
  if (encoding !== 'gzip' && encoding !== 'x-gzip') {
    throw new Error(`Gateway compressed its answer with ${encoding}, which this app cannot read.`);
  }
  // A zero-length body is not a gzip member, and a gateway that flags one is
  // describing nothing. Nothing to inflate is not a failure.
  if (bytes.length === 0) return { bytes, headers: withoutEncodingHeaders(payload.headers) };
  let inflated: Uint8Array;
  try {
    inflated = gunzipSync(bytes);
  } catch {
    throw new Error('Gateway sent a compressed answer this app could not decompress.');
  }
  return { bytes: inflated, headers: withoutEncodingHeaders(payload.headers) };
}
