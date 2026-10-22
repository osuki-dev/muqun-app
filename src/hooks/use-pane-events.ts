import { useEffect, useRef } from 'react';
import { fetch as nitroFetch } from 'react-native-nitro-fetch';
import { TextDecoder } from 'react-native-nitro-text-decoder';

import { activeLocaleHeaders } from '@/i18n/active-locale';
import { ServerSentEventParser } from '@/lib/sse-stream';
import { ENCRYPTED_SSE_EVENT, EncryptedEventStreamDecryptor } from '@/lib/sse-record';
import { streamRecordCrypto } from '@/lib/gateway-transport';
import { encryptedEventStreamRequest, gatewayUsesEncryptedTransport } from '@/lib/gateway-client';
import { rethrow } from '@/lib/compiler-safe-control-flow';
import { onNetworkChange } from '@/lib/network-events';
import { openPaneFeed, paneFeedKey } from '@/lib/pane-event-feeds';
import { STREAM_WATCHDOG_TICK_MS, streamIsStalled } from '@/lib/stream-watchdog';
import {
  APPROVAL_EVENTS,
  paneEventRole,
  SUBSCRIBED_EVENTS,
  type ApprovalEventName,
} from '@/lib/pane-event-names';

export type { ApprovalEventName };

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
 *    renamed, an agent attached, or a pane was resized (`layout_updated`).
 *    These change the navigator and the panes' sizes, not the output. The
 *    names and their roles live in `lib/pane-event-names`.
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
 *
 * A *silent* connection is the harder case: half-open after a network change,
 * it errors never and delivers nothing. The gateway sends a keep-alive every
 * 15 s, so a stream that hears nothing at all for `STREAM_IDLE_LIMIT_MS` is
 * aborted and reopened through the same retry path; a network change does the
 * same at once, with the retry delay reset.
 */
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
  /** `pane.closed` named the pane that went: it is never read again. */
  onPaneClosed?: (paneId: string) => void;
  /** tmux's layout fingerprint moved: maybe a resize, maybe only title churn. */
  onLayoutChanged?: () => void;
  /** Connected or reconnected. Everything since the last event is unknown. */
  onConnected: () => void;
  /**
   * The socket went away and a reconnect is scheduled. Between this and the
   * next `onConnected` nothing arrives, so a caller that leans on the stream
   * for deltas has to fall back to reading -- and this is how it knows to.
   */
  onDisconnected?: () => void;
  /**
   * A pane started or stopped waiting on a permission menu. `payload` is the
   * gateway's approval envelope, parsed by the caller -- this hook stays a
   * transport and does not know what an approval is.
   */
  onApprovalChanged?: (event: ApprovalEventName, payload: unknown) => void;
  /**
   * A `pane_updated` frame that inlined output, whole, before its output is
   * handed to `onPaneOutput`. Such a frame carries the gateway's instance
   * generation at `data.generation` (absent on gateways older than the field);
   * reporting it first lets a restart drop what is held before the frame is
   * folded into it.
   */
  onOutputFrame?: (payload: unknown) => void;
};

type HerdrEventPayload = {
  event?: string;
  data?: { pane?: { pane_id?: string; revision?: number }; output?: string };
};

const MAX_RECONNECT_DELAY_MS = 8_000;

type PaneEventOptions = {
  /** The event names to ask for, in place of everything the workspace uses. */
  types?: readonly string[];
  /**
   * A reader's own fallback feed, opened only while no screen's feed serves
   * the session (`lib/pane-event-feeds`). Every other feed is shared.
   */
  borrower?: boolean;
  /**
   * How `streamPaneId`'s inlined output is read: by default the recent
   * unwrapped lines as ANSI, as the terminal paints them.
   */
  stream?: { source: 'visible' | 'recent-unwrapped'; format: 'text' | 'ansi'; lines?: number };
};

export function usePaneEvents(
  gatewayUrl: string | null,
  token: string | null,
  sessionId: string,
  /** The pane whose output the gateway should inline into its update events. */
  streamPaneId: string | null,
  enabled: boolean,
  /** Incremented when the app returns to the foreground to replace a suspended socket. */
  restartKey: number,
  handlers: PaneEventHandlers,
  options: PaneEventOptions = {}
): void {
  // One long-lived subscription with nothing rendered from it to memoize. Its
  // stream loop is control flow React Compiler cannot lower, so it stays
  // uncompiled on purpose rather than being bent into a shape that could.
  'use no memo';
  // Held in a ref so a new handler identity on every render does not tear down
  // and rebuild the connection.
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  const types = (options.types ?? SUBSCRIBED_EVENTS).join(',');
  const borrower = options.borrower ?? false;
  const streamSource = options.stream?.source ?? 'recent-unwrapped';
  const streamFormat = options.stream?.format ?? 'ansi';
  const streamLines = options.stream?.lines;

  // react-doctor-disable-next-line react-doctor/effect-needs-cleanup -- retryTimer is cleared on unmount in the effect cleanup below.
  useEffect(() => {
    if (!enabled || !gatewayUrl || !token || !sessionId) {
      return () => {};
    }

    const base = gatewayUrl.replace(/\/$/, '');
    const params = new URLSearchParams({ types });
    // Ask the gateway to inline this pane's output into its update events. A
    // gateway that doesn't understand the param just ignores it, so we fall back
    // to onPaneRevision + a read with no version check needed.
    if (streamPaneId) {
      params.set('stream_pane', streamPaneId);
      params.set('stream_format', streamFormat);
      params.set('stream_source', streamSource);
      if (streamLines !== undefined) params.set('stream_lines', String(streamLines));
    }
    const url = `${base}/api/sessions/${encodeURIComponent(sessionId)}/events?${params.toString()}`;

    const approvalNames = new Set<string>(APPROVAL_EVENTS);
    // Announced to readers that only need to know when a pane printed.
    const feed = openPaneFeed(paneFeedKey(base, sessionId), borrower);
    let cancelled = false;
    let controller: AbortController | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryAttempt = 0;
    /** When the current connection last delivered anything, keep-alives included. */
    let lastHeardAt = 0;
    /** Set while a connection is open; the watchdog and a network change act on it. */
    let restart: (() => void) | null = null;

    const handleHerdrEvent = (data: string) => {
      let payload: HerdrEventPayload;
      try {
        payload = JSON.parse(data) as HerdrEventPayload;
      } catch {
        return;
      }
      const name = payload.event;
      if (!name) return;
      const role = paneEventRole(name);
      if (role === 'output') {
        const pane = payload.data?.pane;
        if (pane?.pane_id) {
          const revision = pane.revision ?? 0;
          // When the gateway inlined the output, paint it directly -- no read.
          feed.changed(pane.pane_id);
          if (typeof payload.data?.output === 'string') {
            handlersRef.current.onOutputFrame?.(payload);
            handlersRef.current.onPaneOutput(pane.pane_id, revision, payload.data.output);
          } else {
            handlersRef.current.onPaneRevision(pane.pane_id, revision);
          }
        }
        return;
      }
      // A structural change: the pane list is read again.
      if (role === 'structure') {
        const closed = payload.data?.pane?.pane_id;
        if (closed && name.replace(/\./g, '_') === 'pane_closed') {
          handlersRef.current.onPaneClosed?.(closed);
        }
        handlersRef.current.onStructureChanged();
      }
      // The layout fingerprint: the caller checks the open pane's size first.
      if (role === 'layout') handlersRef.current.onLayoutChanged?.();
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
      retryTimer = undefined;
      const attempt = new AbortController();
      controller = attempt;
      /** Torn down on purpose to reopen at once, not a failure to back off from. */
      let restarting = false;
      const decoder = new TextDecoder();
      const parser = new ServerSentEventParser();
      // Sealed fresh for every attempt: the gateway replay-caches the request
      // envelope's nonce, and the per-stream key is bound to it, so a
      // reconnect can never be answered by a recording of the last stream.
      try {
        const sealed = gatewayUsesEncryptedTransport(token)
          ? await encryptedEventStreamRequest(url)
          : null;
        const decryptor = sealed
          ? new EncryptedEventStreamDecryptor({
              crypto: streamRecordCrypto,
              material: sealed.material,
              requestAad: sealed.requestAad,
              requestNonce: sealed.requestNonce,
            })
          : null;

        if (attempt.signal.aborted) return;
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
        if (!response.ok) rethrow(new Error(`Event stream returned HTTP ${response.status}`));
        if (decryptor) {
          // A sealed request answered with anything but a stream is the
          // gateway refusing it (sealed errors come back as one JSON
          // envelope), and a stream without the transport marker is not the
          // gateway at all. Neither is worth reading events from.
          const contentType = response.headers.get('content-type') ?? '';
          if (!contentType.startsWith('text/event-stream')) {
            rethrow(new Error('The server did not answer with an event stream.'));
          }
          if (response.headers.get('x-muqun-transport') !== '1') {
            rethrow(new Error('The server did not answer with an encrypted event stream.'));
          }
        }

        const reader = response.body?.getReader();
        if (!reader) rethrow(new Error('Event stream has no readable body'));

        retryAttempt = 0;
        lastHeardAt = Date.now();
        restart = () => {
          restart = null;
          restarting = true;
          attempt.abort();
          // An abort does not reliably wake a read parked on a dead socket.
          void reader.cancel().catch(() => {});
        };
        feed.connected(true);
        handlersRef.current.onConnected();

        while (!cancelled) {
          const { done, value } = await reader.read();
          if (done) break;
          lastHeardAt = Date.now();
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
        const aborted = error instanceof Error && error.name === 'AbortError';
        if (cancelled || (aborted && !restarting)) return;
        // A record that failed to open leaves a healthy socket behind it, and
        // the retry below opens a second one. One connection at a time: the
        // poisoned stream is torn down before its replacement is scheduled.
        attempt.abort();
      }
      restart = null;
      feed.connected(false);

      if (cancelled) return;
      handlersRef.current.onDisconnected?.();
      if (restarting) {
        // Stalled or rerouted: reopen now, and let the reopen's full read
        // (`onConnected`) bump the pane rather than waiting for the poll.
        void connect();
        return;
      }
      const delay = Math.min(1000 * 2 ** retryAttempt, MAX_RECONNECT_DELAY_MS);
      retryAttempt += 1;
      retryTimer = setTimeout(() => void connect(), delay);
    };

    const watchdog = setInterval(() => {
      if (restart && streamIsStalled(lastHeardAt, Date.now())) restart();
    }, STREAM_WATCHDOG_TICK_MS);

    const releaseNetwork = onNetworkChange(() => {
      retryAttempt = 0;
      if (restart) {
        // The open stream rides the old route; drop it and come straight back.
        restart();
        return;
      }
      if (retryTimer === undefined) return;
      clearTimeout(retryTimer);
      retryTimer = undefined;
      void connect();
    });

    void connect();

    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      clearInterval(watchdog);
      releaseNetwork();
      restart = null;
      controller?.abort();
      feed.close();
    };
  }, [
    enabled,
    gatewayUrl,
    restartKey,
    sessionId,
    streamPaneId,
    token,
    types,
    borrower,
    streamSource,
    streamFormat,
    streamLines,
  ]);
}
