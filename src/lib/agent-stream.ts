import { parseAgentDomainEvent, type AgentDomainEvent } from './agent-protocol';
import {
  ENCRYPTED_SSE_EVENT,
  EncryptedEventStreamDecryptor,
  type SseRecordCrypto,
} from './sse-record';
import { ServerSentEventParser, type ServerSentEvent } from './sse-stream';

/**
 * Opening and reading the agent's event stream.
 *
 * Split out of `agent-session.ts` so it can be tested: the transport there
 * imports a native fetch and a native text decoder, and neither loads outside
 * Metro. What this needs of them is a handful of methods, so it takes objects
 * with those methods. `agent-session` keeps the wiring -- which URL, which
 * token, which crypto -- and everything that can be wrong on its own is here.
 *
 * The bug it was split out for: the loop used to end by falling off the bottom
 * of the `while`, which is what happens when the gateway restarts, a proxy
 * times the connection out, or OpenCode is restarted underneath it -- an
 * orderly `done: true`, with no error thrown. `connect()` then resolved, the
 * caller's `onError` was never called, the reconnect backoff never armed, and
 * the session sat there looking idle and current while the engine moved on
 * without it. A stream that ends is an event; it is reported as one.
 */

/** Why the loop stopped. */
export type AgentStreamEnd =
  /** The far end closed it, or the body ran out. The caller should reconnect. */
  | 'closed'
  /** The caller asked for it. Nothing should reconnect. */
  | 'cancelled';

/** The two methods this needs of a `ReadableStreamDefaultReader`. */
export interface AgentStreamReader {
  read(): Promise<{ done: boolean; value?: Uint8Array | undefined }>;
}

/** The one method this needs of a `TextDecoder`. */
export interface AgentStreamDecoder {
  decode(value: Uint8Array, options?: { stream?: boolean }): string;
}

/**
 * One frame off the wire, turned into the frame to act on.
 *
 * The seam an encrypted connection needs: its events arrive as sealed records
 * under one outer name, and what the loop below should parse is what comes out
 * of them. Two answers besides a frame:
 *
 *  - `null` drops it. On an encrypted stream a frame that is not a sealed
 *    record is nothing this app will act on, and dropping it is how that
 *    fails closed rather than trusting whatever arrived in the clear.
 *  - a throw poisons the connection. A record that does not open is tamper,
 *    replay or a gap, and none of those is survivable in place, so it leaves
 *    this loop and reaches the caller, whose reconnect refetches the truth.
 */
export type AgentStreamFrameOpener = (frame: ServerSentEvent) => ServerSentEvent | null;

export interface PumpAgentStreamOptions {
  reader: AgentStreamReader;
  decoder: AgentStreamDecoder;
  /** Already parsed and validated; an unrecognised frame never arrives here. */
  onEvent: (event: AgentDomainEvent) => void;
  /** Checked before and after every read, so an abort stops the loop promptly. */
  isCancelled: () => boolean;
  /** Absent on a cleartext stream, where a frame is already the frame. */
  openFrame?: AgentStreamFrameOpener;
}

/**
 * Read frames until the stream ends or the caller cancels.
 *
 * Never throws for a frame it cannot understand: a body that is not JSON, or a
 * JSON payload this build has no branch for, is dropped and the loop carries
 * on. A read that rejects is the transport failing, and that is the caller's
 * to handle -- as is a frame `openFrame` refuses to open, which is a failure of
 * the connection rather than of one frame.
 */
export async function pumpAgentStream(options: PumpAgentStreamOptions): Promise<AgentStreamEnd> {
  const { reader, decoder, onEvent, isCancelled, openFrame } = options;
  const parser = new ServerSentEventParser();

  while (!isCancelled()) {
    const { done, value } = await reader.read();
    if (isCancelled()) return 'cancelled';
    if (done) return 'closed';
    if (!value) continue;

    const text = decoder.decode(value, { stream: true });
    for (const wire of parser.push(text)) {
      const frame = openFrame ? openFrame(wire) : wire;
      if (!frame) continue;
      let data: unknown = frame.data;
      try {
        data = JSON.parse(frame.data);
      } catch {
        // A frame that is not JSON is still named, and the gateway's own
        // `connected` frame is one of those; the parser below decides whether
        // it means anything.
      }
      const event = parseAgentDomainEvent(frame.event, data);
      if (event) onEvent(event);
    }
  }

  return 'cancelled';
}

/** As much of the transport's answer as opening a stream depends on. */
export interface AgentStreamResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  body: { getReader(): AgentStreamReader } | null;
}

/** What the transport is asked for. `stream` is nitro-fetch's readable-body opt-in. */
export interface AgentStreamRequestInit {
  headers: Record<string, string>;
  signal: AbortSignal;
  stream: true;
}

/**
 * The sealed half of an encrypted connection, as `encryptedEventStreamRequest`
 * hands it over, plus the primitives the records are opened with.
 */
export interface AgentStreamSeal {
  /** Sent instead of Authorization: the token travels inside the envelope. */
  headers: Record<string, string>;
  /** The AAD the request was sealed under; every record's AAD begins with it. */
  requestAad: string;
  /** The request envelope's nonce, which the per-stream key derivation binds. */
  requestNonce: string;
  /** The device transport key material the per-stream key derives from. */
  material: Uint8Array;
  crypto: SseRecordCrypto;
}

export interface ConnectAgentStreamOptions {
  url: string;
  /**
   * Null on a cleartext pairing, which is what every gateway that does not
   * encrypt the transport gets, and the object on an encrypted one.
   */
  seal: AgentStreamSeal | null;
  /** The cleartext connection's headers: the bearer token, and the locale. */
  plainHeaders: Record<string, string>;
  /** A sealed connection's readable headers: the locale, and nothing secret. */
  outerHeaders: Record<string, string>;
  fetch: (url: string, init: AgentStreamRequestInit) => Promise<AgentStreamResponse>;
  /** A fresh decoder per connection; a partial code point must not cross two. */
  newDecoder: () => AgentStreamDecoder;
  signal: AbortSignal;
  /** Drops the socket. Called when a sealed connection is poisoned. */
  abort: () => void;
  isCancelled: () => boolean;
  onEvent: (event: AgentDomainEvent) => void;
  onConnected?: () => void;
}

/**
 * Open one connection and read it to its end.
 *
 * The security rule it exists to keep: on an encrypted pairing this stream is
 * opened by a sealed request and read as sealed records, and the device token
 * never appears as a header. It used not to be -- the agent stream was opened
 * with a bare `Authorization` on every pairing, so a gateway configured
 * `transport_encryption: required` had one route, the busiest one, putting the
 * token and every prompt, tool call, diff and file on the wire in the clear.
 *
 * A cleartext pairing sends exactly the request it always sent and reads
 * exactly the frames it always read.
 *
 * Throws on any failure, including a record that will not open; the caller
 * reports that and reconnects, and its next attempt seals a fresh request.
 */
export async function connectAgentStream(
  options: ConnectAgentStreamOptions
): Promise<AgentStreamEnd> {
  const { seal } = options;
  const decryptor = seal
    ? new EncryptedEventStreamDecryptor({
        crypto: seal.crypto,
        material: seal.material,
        requestAad: seal.requestAad,
        requestNonce: seal.requestNonce,
      })
    : null;

  try {
    const response = await options.fetch(options.url, {
      headers: {
        // An encrypted request's token travels inside the sealed envelope and
        // never as a header; everyone else authenticates the way they always
        // have. Either way the locale is stamped, and on the sealed path it
        // stays readable so the gateway can honour it before it opens anything.
        ...(seal ? { ...options.outerHeaders, ...seal.headers } : options.plainHeaders),
        Accept: 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
      signal: options.signal,
      stream: true,
    });

    if (!response.ok) throw new Error(`Agent stream HTTP ${response.status}`);
    if (decryptor) {
      // A sealed request answered with anything but a stream is the gateway
      // refusing it -- sealed errors come back as one JSON envelope -- and a
      // stream without the transport marker is a gateway that would be sending
      // these events in the clear. Neither is worth reading from.
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.startsWith('text/event-stream')) {
        throw new Error('The server did not answer with an event stream.');
      }
      if (response.headers.get('x-muqun-transport') !== '1') {
        throw new Error('The server did not answer with an encrypted event stream.');
      }
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('Agent stream body not readable');

    options.onConnected?.();

    return await pumpAgentStream({
      reader,
      decoder: options.newDecoder(),
      onEvent: options.onEvent,
      isCancelled: options.isCancelled,
      ...(decryptor
        ? {
            // Fail closed: on an encrypted stream a plaintext frame is nothing
            // this app will act on, and a record that does not open throws,
            // which ends the connection rather than skipping one event. A gap
            // is indistinguishable from deletion, and deletion is an attack.
            openFrame: (frame) =>
              frame.event === ENCRYPTED_SSE_EVENT ? decryptor.open(frame.data) : null,
          }
        : {}),
    });
  } catch (failure) {
    // A record that failed to open leaves a healthy socket behind it, and the
    // caller's reconnect opens a second one. One connection at a time. Only on
    // the sealed path: a cleartext stream reaches here with its socket already
    // gone, and its teardown is unchanged.
    if (decryptor && !options.isCancelled()) options.abort();
    throw failure;
  }
}
