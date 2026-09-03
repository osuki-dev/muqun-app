import { useEffect, useRef } from 'react';
import { fetch as nitroFetch } from 'react-native-nitro-fetch';
import { TextDecoder } from 'react-native-nitro-text-decoder';

import { activeLocaleHeaders } from '@/i18n/active-locale';
import { ServerSentEventParser } from '@/lib/sse-stream';
import { ENCRYPTED_SSE_EVENT, EncryptedEventStreamDecryptor } from '@/lib/sse-record';
import { streamRecordCrypto } from '@/lib/gateway-transport';
import { encryptedEventStreamRequest, gatewayUsesEncryptedTransport } from '@/lib/gateway-client';

/**
 * A live event feed for one session, replacing the output poll.
 *
 * The gateway forwards Herdr's event stream; left raw it is dominated by focus
 * and layout churn a phone has no use for, so we ask it to send back only the
 * handful of event names that change what is on screen. What survives is:
 *
 *  - `pane_updated` -- a pane printed something. Carries the pane's `revision`,
 *    which is how we read output only when it actually changed instead of every
 *    1.2 s regardless.
 *  - structural events -- a workspace, tab or pane appeared, vanished, was
 *    renamed, or an agent attached. These change the navigator, not the output.
 *
 * An encrypted-transport record gets the same stream over the same route; the
 * connection is opened by a sealed request envelope and every event arrives as
 * one AES-GCM record (`muqun.encrypted`), opened in order by
 * `EncryptedEventStreamDecryptor`. Any violation -- tamper, replay, a gap --
 * poisons the connection, and the reconnect below already forces the full
 * read that makes a torn stream safe.
 *
 * A dropped connection is normal on a phone: the OS suspends the socket in the
 * background. The caller must do a full read on every (re)connect, since any
 * event during the gap is lost -- the stream has no replay.
 */
const OUTPUT_EVENTS = ['pane.updated'];

/**
 * An agent blocking on a permission menu is the one thing a client cannot
 * discover by watching output go by, so the gateway publishes it as its own
 * event rather than as pane churn. A gateway that has never heard of these
 * names simply never matches them, which is what makes asking for them safe.
 */
const APPROVAL_EVENTS = ['approval.pending', 'approval.resolved'] as const;

export type ApprovalEventName = (typeof APPROVAL_EVENTS)[number];

const STRUCTURE_EVENTS = [
  'pane.created',
  'pane.closed',
  'pane.moved',
  'pane.exited',
  'pane.agent_detected',
  'pane.agent_status_changed',
  'tab.created',
  'tab.closed',
  'tab.renamed',
  'tab.moved',
  'workspace.created',
  'workspace.closed',
  'workspace.renamed',
  'workspace.focused',
];

type PaneEventHandlers = {
  /** A pane printed. `revision` lets the caller ignore a repeat of what it has. */
  onPaneRevision: (paneId: string, revision: number) => void;
  /**
   * A pane printed AND the gateway inlined its output in the event, so there is
   * no read to do -- paint `text` straight away. Only fires for `streamPaneId`
   * against a gateway new enough to enrich; otherwise `onPaneRevision` fires and
   * the caller reads as before.
   */
  onPaneOutput: (paneId: string, revision: number, text: string) => void;
  /** The set of workspaces, tabs, panes or agents changed. */
  onStructureChanged: () => void;
  /** Connected or reconnected. Everything since the last event is unknown. */
  onConnected: () => void;
  /**
   * A pane started or stopped waiting on a permission menu. `payload` is the
   * gateway's approval envelope, parsed by the caller -- this hook stays a
   * transport and does not know what an approval is.
   */
  onApprovalChanged?: (event: ApprovalEventName, payload: unknown) => void;
};

type HerdrEventPayload = {
  event?: string;
  data?: { pane?: { pane_id?: string; revision?: number }; output?: string };
};

const MAX_RECONNECT_DELAY_MS = 8_000;

export function usePaneEvents(
  gatewayUrl: string | null,
  token: string | null,
  sessionId: string,
  /** The pane whose output the gateway should inline into its update events. */
  streamPaneId: string | null,
  enabled: boolean,
  /** Incremented when the app returns to the foreground to replace a suspended socket. */
  restartKey: number,
  handlers: PaneEventHandlers
): void {
  // Held in a ref so a new handler identity on every render does not tear down
  // and rebuild the connection.
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    if (!enabled || !gatewayUrl || !token || !sessionId) return;

    const types = [...OUTPUT_EVENTS, ...STRUCTURE_EVENTS, ...APPROVAL_EVENTS].join(',');
    const base = gatewayUrl.replace(/\/$/, '');
    const params = new URLSearchParams({ types });
    // Ask the gateway to inline this pane's output into its update events. A
    // gateway that doesn't understand the param just ignores it, so we fall back
    // to onPaneRevision + a read with no version check needed.
    if (streamPaneId) {
      params.set('stream_pane', streamPaneId);
      params.set('stream_format', 'ansi');
      params.set('stream_source', 'recent-unwrapped');
    }
    const url = `${base}/api/sessions/${encodeURIComponent(sessionId)}/events?${params.toString()}`;

    const outputNames = new Set(OUTPUT_EVENTS.map((name) => name.replace('.', '_')));
    const approvalNames = new Set<string>(APPROVAL_EVENTS);
    let cancelled = false;
    let controller: AbortController | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryAttempt = 0;

    const handleHerdrEvent = (data: string) => {
      let payload: HerdrEventPayload;
      try {
        payload = JSON.parse(data) as HerdrEventPayload;
      } catch {
        return;
      }
      const name = payload.event;
      if (!name) return;
      if (outputNames.has(name)) {
        const pane = payload.data?.pane;
        if (pane?.pane_id) {
          const revision = pane.revision ?? 0;
          // When the gateway inlined the output, paint it directly -- no read.
          if (typeof payload.data?.output === 'string') {
            handlersRef.current.onPaneOutput(pane.pane_id, revision, payload.data.output);
          } else {
            handlersRef.current.onPaneRevision(pane.pane_id, revision);
          }
        }
        return;
      }
      // Anything else we subscribed to is structural.
      handlersRef.current.onStructureChanged();
    };

    // Approvals are the gateway's own events, not forwarded Herdr lines, so
    // they arrive under their own SSE event name rather than inside a `herdr`
    // frame.
    const handleApprovalEvent = (name: string, data: string) => {
      const handler = handlersRef.current.onApprovalChanged;
      if (!handler) return;
      try {
        handler(name as ApprovalEventName, JSON.parse(data));
      } catch {
        // A frame this build cannot parse is dropped; the screen's own read
        // still learns the truth on the next poll or reconnect.
      }
    };

    const dispatch = (name: string, data: string) => {
      if (name === 'herdr') handleHerdrEvent(data);
      else if (approvalNames.has(name)) handleApprovalEvent(name, data);
    };

    const connect = async (): Promise<void> => {
      controller = new AbortController();
      const decoder = new TextDecoder();
      const parser = new ServerSentEventParser();
      // Sealed fresh for every attempt: the gateway replay-caches the request
      // envelope's nonce, and the per-stream key is bound to it, so a
      // reconnect can never be answered by a recording of the last stream.
      const sealed = gatewayUsesEncryptedTransport(token) ? encryptedEventStreamRequest(url) : null;
      const decryptor = sealed
        ? new EncryptedEventStreamDecryptor({
            crypto: streamRecordCrypto,
            material: sealed.material,
            requestAad: sealed.requestAad,
            requestNonce: sealed.requestNonce,
          })
        : null;

      try {
        const response = await nitroFetch(url, {
          headers: {
            // Read at connect time rather than captured once: the stream is
            // long-lived, so a language changed mid-session is picked up by the
            // reconnect this hook already performs.
            ...activeLocaleHeaders(),
            Accept: 'text/event-stream',
            'Cache-Control': 'no-cache',
            // An encrypted record's token travels inside the sealed envelope;
            // everyone else authenticates the way they always have.
            ...(sealed ? sealed.headers : { Authorization: `Bearer ${token}` }),
          },
          signal: controller.signal,
          stream: true,
        });
        if (!response.ok) throw new Error(`Event stream returned HTTP ${response.status}`);
        if (decryptor) {
          // A sealed request answered with anything but a stream is the
          // gateway refusing it (sealed errors come back as one JSON
          // envelope), and a stream without the transport marker is not the
          // gateway at all. Neither is worth reading events from.
          const contentType = response.headers.get('content-type') ?? '';
          if (!contentType.startsWith('text/event-stream')) {
            throw new Error('The server did not answer with an event stream.');
          }
          if (response.headers.get('x-muqun-transport') !== '1') {
            throw new Error('The server did not answer with an encrypted event stream.');
          }
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('Event stream has no readable body');

        retryAttempt = 0;
        handlersRef.current.onConnected();

        while (!cancelled) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;

          const text = decoder.decode(value, { stream: true });
          for (const event of parser.push(text)) {
            if (decryptor) {
              // Fail closed: on an encrypted stream, a plaintext event is
              // nothing this hook will act on, and a record that does not
              // open -- tampered, replayed, out of order, or missing a
              // predecessor -- poisons the connection. The reconnect's full
              // read is what makes tearing down always safe.
              if (event.event !== ENCRYPTED_SSE_EVENT) continue;
              const opened = decryptor.open(event.data);
              dispatch(opened.event, opened.data);
            } else {
              dispatch(event.event, event.data);
            }
          }
        }
      } catch (error) {
        if (cancelled || (error instanceof Error && error.name === 'AbortError')) return;
        // A record that failed to open leaves a healthy socket behind it, and
        // the retry below opens a second one. One connection at a time: the
        // poisoned stream is torn down before its replacement is scheduled.
        controller?.abort();
      }

      if (cancelled) return;
      const delay = Math.min(1000 * 2 ** retryAttempt, MAX_RECONNECT_DELAY_MS);
      retryAttempt += 1;
      retryTimer = setTimeout(() => void connect(), delay);
    };

    void connect();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      controller?.abort();
    };
  }, [enabled, gatewayUrl, restartKey, sessionId, streamPaneId, token]);
}
