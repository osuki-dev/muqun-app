/**
 * Which request opens the agent's event stream, and what it will read back.
 *
 * The defect these exist to fence off is a one-line one: the opener called the
 * transport with `Authorization: Bearer <device token>` and read plain events,
 * whatever the pairing's transport was. On a gateway configured
 * `transport_encryption: required` that put the device token and every agent
 * event -- prompts, tool calls, file contents, diffs -- on the wire in the
 * clear, on the one route that carries the most of them, while every other
 * call on the same connection was sealed. `use-pane-events` had been opening
 * `/api/sessions/{id}/events` correctly the whole time; this route had been
 * missed.
 *
 * So there are two halves to hold down, and both are here. An encrypted
 * pairing sends no bearer token and acts on nothing but sealed records. A
 * cleartext pairing sends exactly the request it always sent and reads exactly
 * the frames it always read -- the change is not allowed to cost anything on a
 * gateway that does not encrypt.
 *
 * Nothing is mocked at module level: `connectAgentStream` takes its transport,
 * its decoder and its crypto as arguments. What runs here is the real read
 * loop, the real SSE parser, the real decryptor, and records sealed in the
 * gateway's own format by `stream-seal`.
 */
import { beforeEach, describe, expect, test } from 'bun:test';

import type { AgentDomainEvent } from '../agent-protocol';
import {
  connectAgentStream,
  type AgentStreamEnd,
  type AgentStreamRequestInit,
  type AgentStreamResponse,
} from '../agent-stream';
import { sealRecord, testCrypto } from './stream-seal';

// ---------------------------------------------------------------------------
// The transport, stood in for
// ---------------------------------------------------------------------------

/** A body the test feeds a frame at a time, and ends or breaks on purpose. */
function fakeBody() {
  const queue: (Uint8Array | null)[] = [];
  const encoder = new TextEncoder();
  let failure: Error | null = null;
  let wake: (() => void) | null = null;
  const ring = () => {
    const pending = wake;
    wake = null;
    pending?.();
  };
  return {
    /** One SSE block, terminated the way the gateway terminates them. */
    frame(event: string, data: string) {
      queue.push(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
      ring();
    },
    /** Whatever arrived, which on a long record is half a frame. */
    raw(text: string) {
      queue.push(encoder.encode(text));
      ring();
    },
    /** The far end hanging up in good order. */
    end() {
      queue.push(null);
      ring();
    },
    /** The socket failing under the reader. */
    fail(error: Error) {
      failure = error;
      ring();
    },
    reader: {
      async read(): Promise<{ done: boolean; value?: Uint8Array }> {
        while (queue.length === 0 && !failure) {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        }
        if (queue.length === 0 && failure) throw failure;
        const next = queue.shift();
        return next ? { done: false, value: next } : { done: true };
      },
    },
  };
}

type FakeBody = ReturnType<typeof fakeBody>;

function fakeResponse(
  body: FakeBody | null,
  options: { status?: number; headers?: Record<string, string> } = {}
): AgentStreamResponse {
  const status = options.status ?? 200;
  const headers = new Map(
    Object.entries({
      'content-type': 'text/event-stream',
      'x-muqun-transport': '1',
      ...options.headers,
    }).map(([name, value]) => [name.toLowerCase(), value])
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers.get(name.toLowerCase()) ?? null },
    body: body ? { getReader: () => body.reader } : null,
  };
}

// ---------------------------------------------------------------------------
// The two pairings
// ---------------------------------------------------------------------------

const TOKEN = 'device-token-fixture';
const MATERIAL = new Uint8Array(Array.from({ length: 32 }, (_, index) => index + 7));
const REQUEST_NONCE = 'agent-stream-request-nonce';
const SID = 'agent-stream-fixture';
const STREAM_PATH = '/api/sessions/sess-1/agent-sessions/asid-1/stream';
const STREAM_URL = `https://gateway.invalid${STREAM_PATH}`;
const REQUEST_AAD = `GET ${STREAM_PATH}`;

/** What `gatewayAuthHeaders()` hands over: the bearer token, and the locale. */
const PLAIN_HEADERS = { 'Accept-Language': 'en', Authorization: `Bearer ${TOKEN}` };
/** What rides outside an envelope: the locale, and nothing secret. */
const OUTER_HEADERS = { 'Accept-Language': 'en' };

/** What `encryptedEventStreamRequest` hands back on an encrypted pairing. */
const SEAL = {
  headers: {
    'X-Muqun-Transport': '1',
    'X-Muqun-Device': 'device-1',
    'X-Muqun-Envelope': 'ZW52ZWxvcGUtZml4dHVyZQ',
  },
  requestAad: REQUEST_AAD,
  requestNonce: REQUEST_NONCE,
  material: MATERIAL,
  crypto: testCrypto,
};

function record(seq: number, event: string, data: string): string {
  return sealRecord(MATERIAL, {
    sid: SID,
    requestNonce: REQUEST_NONCE,
    requestAad: REQUEST_AAD,
    seq,
    event,
    data,
  });
}

const STATUS_EVENT = '{"asid":"asid-1","seq":4,"status":"running"}';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Attempt {
  url: string;
  init: AgentStreamRequestInit;
}

const attempts: Attempt[] = [];

/**
 * One connection, driven the way `openAgentSessionStream` drives it: the
 * promise is what its `connect()` awaits, and the callbacks are its caller's.
 */
function connect(options: { seal?: typeof SEAL | null; answer: () => AgentStreamResponse }) {
  const events: AgentDomainEvent[] = [];
  const connects: number[] = [];
  const controller = new AbortController();
  let cancelled = false;
  let aborts = 0;

  const ended = connectAgentStream({
    url: STREAM_URL,
    seal: options.seal ?? null,
    plainHeaders: PLAIN_HEADERS,
    outerHeaders: OUTER_HEADERS,
    fetch: (url, init) => {
      attempts.push({ url, init });
      return Promise.resolve(options.answer());
    },
    newDecoder: () => new TextDecoder(),
    signal: controller.signal,
    abort: () => {
      aborts += 1;
      controller.abort();
    },
    isCancelled: () => cancelled,
    onEvent: (event) => events.push(event),
    onConnected: () => connects.push(1),
  });

  return {
    events,
    connects,
    controller,
    aborted: () => aborts,
    cancel: () => {
      cancelled = true;
      controller.abort();
    },
    /** The end, or the failure, whichever the connection reaches. */
    settled: async (): Promise<AgentStreamEnd | Error> => {
      try {
        return await ended;
      } catch (failure) {
        return failure as Error;
      }
    },
  };
}

/** Let the connection's own promises run before the test looks at it. */
function settle(turns = 8): Promise<void> {
  let chain = Promise.resolve();
  for (let turn = 0; turn < turns; turn += 1) chain = chain.then(() => {});
  return chain;
}

function headerValue(headers: Record<string, string>, name: string): string | undefined {
  return Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
}

beforeEach(() => {
  attempts.length = 0;
});

// ---------------------------------------------------------------------------

describe('which request opens the stream', () => {
  test('a cleartext pairing sends the request it always sent', async () => {
    const body = fakeBody();
    const run = connect({ answer: () => fakeResponse(body) });
    await settle();

    expect(attempts).toHaveLength(1);
    expect(attempts[0].url).toBe(STREAM_URL);
    expect(attempts[0].init.stream).toBe(true);
    expect(attempts[0].init.headers).toEqual({
      'Accept-Language': 'en',
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'text/event-stream',
      'Cache-Control': 'no-cache',
    });
    run.cancel();
  });

  test('an encrypted pairing sends the sealed envelope and no bearer token', async () => {
    const body = fakeBody();
    const run = connect({ seal: SEAL, answer: () => fakeResponse(body) });
    await settle();

    expect(attempts).toHaveLength(1);
    // The whole point: the device token is inside the envelope, not on a
    // header anyone in the middle can read.
    expect(headerValue(attempts[0].init.headers, 'authorization')).toBeUndefined();
    expect(JSON.stringify(attempts[0].init.headers)).not.toContain(TOKEN);
    expect(attempts[0].init.headers).toEqual({
      'Accept-Language': 'en',
      'X-Muqun-Transport': '1',
      'X-Muqun-Device': 'device-1',
      'X-Muqun-Envelope': 'ZW52ZWxvcGUtZml4dHVyZQ',
      Accept: 'text/event-stream',
      'Cache-Control': 'no-cache',
    });
    run.cancel();
  });

  test('the connection is still a stream, and still cancellable by its caller', async () => {
    const body = fakeBody();
    const run = connect({ seal: SEAL, answer: () => fakeResponse(body) });
    await settle();

    expect(attempts[0].init.stream).toBe(true);
    expect(attempts[0].init.signal.aborted).toBe(false);
    run.cancel();
    expect(attempts[0].init.signal.aborted).toBe(true);
  });
});

describe('a cleartext stream reads what it always read', () => {
  test('plain frames arrive as domain events', async () => {
    const body = fakeBody();
    const run = connect({ answer: () => fakeResponse(body) });
    await settle();

    body.frame('connected', '{"asid":"asid-1"}');
    body.frame('agent.status.changed', STATUS_EVENT);
    await settle();

    expect(run.connects).toHaveLength(1);
    expect(run.events.map((event) => event.type)).toEqual(['agent.status.changed']);
    run.cancel();
  });

  test('an orderly close is reported as a close, so the caller can back off', async () => {
    const body = fakeBody();
    const run = connect({ answer: () => fakeResponse(body) });
    await settle();

    body.end();
    expect(await run.settled()).toBe('closed');
    // Nothing tore the socket down behind the caller's back: on this path the
    // far end had already hung up.
    expect(run.aborted()).toBe(0);
  });

  test('a socket that breaks is reported as a failure', async () => {
    const body = fakeBody();
    const run = connect({ answer: () => fakeResponse(body) });
    await settle();

    body.fail(new Error('Network is unreachable.'));
    expect(String(await run.settled())).toContain('Network is unreachable.');
    expect(run.aborted()).toBe(0);
  });

  test('a refusal is a failure, and never a close', async () => {
    const run = connect({ answer: () => fakeResponse(null, { status: 503 }) });
    expect(String(await run.settled())).toContain('503');
    expect(run.connects).toHaveLength(0);
  });

  test('a body with no reader is a failure rather than a silent idle stream', async () => {
    const run = connect({ answer: () => fakeResponse(null) });
    expect(String(await run.settled())).toContain('not readable');
  });

  // The guards that only a sealed connection applies: a cleartext gateway has
  // always answered without the transport marker, and refusing it here would
  // break every unencrypted pairing.
  test('a cleartext answer is read without a transport marker', async () => {
    const body = fakeBody();
    const run = connect({
      answer: () => fakeResponse(body, { headers: { 'x-muqun-transport': '' } }),
    });
    await settle();

    body.frame('agent.status.changed', STATUS_EVENT);
    await settle();

    expect(run.events).toHaveLength(1);
    run.cancel();
  });

  test('a cancelled connection stops without reporting an end', async () => {
    const body = fakeBody();
    const run = connect({ answer: () => fakeResponse(body) });
    await settle();

    run.cancel();
    body.end();
    expect(await run.settled()).toBe('cancelled');
  });
});

describe('an encrypted stream acts on sealed records and nothing else', () => {
  test('sealed records open, in order, into the events they carry', async () => {
    const body = fakeBody();
    const run = connect({ seal: SEAL, answer: () => fakeResponse(body) });
    await settle();

    body.frame('muqun.encrypted', record(0, 'connected', '{"asid":"asid-1"}'));
    body.frame('muqun.encrypted', record(1, 'agent.status.changed', STATUS_EVENT));
    await settle();

    expect(run.events).toHaveLength(1);
    expect(run.events[0]).toMatchObject({
      type: 'agent.status.changed',
      asid: 'asid-1',
      seq: 4,
      // `running` on the wire; `busy` is what the protocol parser calls it.
      status: 'busy',
    });
    run.cancel();
  });

  test('a record split across two reads is still one record', async () => {
    const body = fakeBody();
    const run = connect({ seal: SEAL, answer: () => fakeResponse(body) });
    await settle();

    // The transport hands over whatever arrived, which on a long record is
    // half a frame; the parser is what makes that safe, and it is the real one.
    const whole = `event: muqun.encrypted\ndata: ${record(0, 'agent.status.changed', STATUS_EVENT)}\n\n`;
    const split = Math.floor(whole.length / 2);
    body.raw(whole.slice(0, split));
    await settle();
    expect(run.events).toHaveLength(0);

    body.raw(whole.slice(split));
    await settle();

    expect(run.events).toHaveLength(1);
    run.cancel();
  });

  test('a plaintext frame on an encrypted stream is not acted on', async () => {
    const body = fakeBody();
    const run = connect({ seal: SEAL, answer: () => fakeResponse(body) });
    await settle();

    // What a downgrade looks like: the real event, in the clear, on a
    // connection that promised to seal everything.
    body.frame('agent.status.changed', STATUS_EVENT);
    await settle();

    expect(run.events).toHaveLength(0);
    run.cancel();
  });

  test('a record that fails to open ends the connection rather than one event', async () => {
    const body = fakeBody();
    const run = connect({ seal: SEAL, answer: () => fakeResponse(body) });
    await settle();

    const tampered = JSON.parse(record(0, 'agent.status.changed', STATUS_EVENT)) as {
      ciphertext: string;
    };
    tampered.ciphertext = `A${tampered.ciphertext.slice(1)}`;
    body.frame('muqun.encrypted', JSON.stringify(tampered));

    expect(String(await run.settled())).toContain('authentication');
    expect(run.events).toHaveLength(0);
    // The socket was healthy; it is dropped so the caller's reconnect opens one
    // connection and not two.
    expect(run.aborted()).toBe(1);
    expect(run.controller.signal.aborted).toBe(true);
  });

  test('a replayed record ends the connection', async () => {
    const body = fakeBody();
    const run = connect({ seal: SEAL, answer: () => fakeResponse(body) });
    await settle();

    body.frame('muqun.encrypted', record(0, 'agent.status.changed', STATUS_EVENT));
    body.frame('muqun.encrypted', record(0, 'agent.status.changed', STATUS_EVENT));

    expect(String(await run.settled())).toContain('lost its place');
    expect(run.events).toHaveLength(1);
    expect(run.aborted()).toBe(1);
  });

  test('a record sealed for another stream ends the connection', async () => {
    const body = fakeBody();
    const run = connect({ seal: SEAL, answer: () => fakeResponse(body) });
    await settle();

    // Same device key, another connection's request nonce: the per-stream key
    // derivation is what makes a captured stream unreplayable into a later one.
    body.frame(
      'muqun.encrypted',
      sealRecord(MATERIAL, {
        sid: SID,
        requestNonce: 'a-different-request',
        requestAad: REQUEST_AAD,
        seq: 0,
        event: 'agent.status.changed',
        data: STATUS_EVENT,
      })
    );

    expect(String(await run.settled())).toContain('authentication');
    expect(run.events).toHaveLength(0);
  });

  test('an answer that is not an event stream is refused unread', async () => {
    const run = connect({
      seal: SEAL,
      answer: () => fakeResponse(fakeBody(), { headers: { 'content-type': 'application/json' } }),
    });

    expect(String(await run.settled())).toContain('did not answer with an event stream');
    expect(run.connects).toHaveLength(0);
  });

  test('an answer without the transport marker is refused unread', async () => {
    const run = connect({
      seal: SEAL,
      answer: () => fakeResponse(fakeBody(), { headers: { 'x-muqun-transport': '' } }),
    });

    expect(String(await run.settled())).toContain('encrypted event stream');
    expect(run.connects).toHaveLength(0);
  });

  test('an orderly close still backs off the same way', async () => {
    const body = fakeBody();
    const run = connect({ seal: SEAL, answer: () => fakeResponse(body) });
    await settle();

    body.frame('muqun.encrypted', record(0, 'agent.status.changed', STATUS_EVENT));
    body.end();

    expect(await run.settled()).toBe('closed');
    expect(run.events).toHaveLength(1);
  });
});
