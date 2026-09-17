import { parseAgentDomainEvent, type AgentDomainEvent } from './agent-protocol';
import { ServerSentEventParser } from './sse-stream';

/**
 * The read loop behind the agent's event stream.
 *
 * Split out of `agent-session.ts` so it can be tested: the transport there
 * imports a native fetch and a native text decoder, and neither loads outside
 * Metro. What this needs of them is two methods, so it takes two objects with
 * two methods.
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

export interface PumpAgentStreamOptions {
  reader: AgentStreamReader;
  decoder: AgentStreamDecoder;
  /** Already parsed and validated; an unrecognised frame never arrives here. */
  onEvent: (event: AgentDomainEvent) => void;
  /** Checked before and after every read, so an abort stops the loop promptly. */
  isCancelled: () => boolean;
}

/**
 * Read frames until the stream ends or the caller cancels.
 *
 * Never throws for a frame it cannot understand: a body that is not JSON, or a
 * JSON payload this build has no branch for, is dropped and the loop carries
 * on. A read that rejects is the transport failing, and that is the caller's
 * to handle.
 */
export async function pumpAgentStream(options: PumpAgentStreamOptions): Promise<AgentStreamEnd> {
  const { reader, decoder, onEvent, isCancelled } = options;
  const parser = new ServerSentEventParser();

  while (!isCancelled()) {
    const { done, value } = await reader.read();
    if (isCancelled()) return 'cancelled';
    if (done) return 'closed';
    if (!value) continue;

    const text = decoder.decode(value, { stream: true });
    for (const frame of parser.push(text)) {
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
