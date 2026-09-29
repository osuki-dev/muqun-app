import { describe, expect, test } from 'bun:test';

import type { AgentDomainEvent } from '../agent-protocol';
import {
  GatewaySocket,
  socketReconnectDelay,
  type GatewaySocketListener,
  type GatewaySocketTransport,
  type GatewaySocketUpgrade,
} from '../gateway-socket';
import { GatewayFrameSealer, socketTestCrypto } from './socket-seal';

const material = new Uint8Array(Array.from({ length: 32 }, (_, index) => index + 1));

class FakeTransport implements GatewaySocketTransport {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string; isBinary: boolean }) => void) | null = null;
  onerror: ((error: string) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  readonly sent: string[] = [];
  closed = false;

  constructor(
    readonly url: string,
    readonly headers: Record<string, string>
  ) {}

  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
  }
  /** The server says something. */
  deliver(data: string): void {
    this.onmessage?.({ data, isBinary: false });
  }
  /** The connection drops under the app. */
  drop(): void {
    this.onclose?.({ code: 1006, reason: '' });
  }
}

/** Timers under the test's control. */
class Clock {
  private now = 0;
  private timers: { at: number; run: () => void; id: number }[] = [];
  private nextId = 0;

  schedule = (run: () => void, ms: number) => {
    const id = this.nextId++;
    this.timers.push({ at: this.now + ms, run, id });
    return () => {
      this.timers = this.timers.filter((timer) => timer.id !== id);
    };
  };

  advance(ms: number): void {
    const target = this.now + ms;
    for (;;) {
      const due = this.timers
        .filter((timer) => timer.at <= target)
        .sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      this.timers = this.timers.filter((timer) => timer !== due);
      this.now = due.at;
      due.run();
    }
    this.now = target;
  }
}

class FakeAppState {
  active = true;
  private listeners = new Set<(active: boolean) => void>();
  isActive = () => this.active;
  subscribe = (listener: (active: boolean) => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  set(active: boolean): void {
    this.active = active;
    for (const listener of this.listeners) listener(active);
  }
}

interface Harness {
  socket: GatewaySocket;
  transports: FakeTransport[];
  clock: Clock;
  appState: FakeAppState;
  latest(): FakeTransport;
}

function harness(options: { sealed?: boolean; prepare?: () => GatewaySocketUpgrade | null } = {}) {
  const transports: FakeTransport[] = [];
  const clock = new Clock();
  const appState = new FakeAppState();
  let nonce = 0;
  const socket = new GatewaySocket({
    prepare:
      options.prepare ??
      (() => ({
        url: 'ws://gateway.test/api/ws',
        headers: { 'X-Muqun-Transport': '1' },
        seal: options.sealed
          ? { requestAad: 'GET /api/ws', requestNonce: `nonce-${nonce++}`, material }
          : null,
      })),
    open: (url, headers) => {
      const transport = new FakeTransport(url, headers);
      transports.push(transport);
      return transport;
    },
    crypto: socketTestCrypto,
    appState,
    schedule: clock.schedule,
  });
  const result: Harness = {
    socket,
    transports,
    clock,
    appState,
    latest: () => transports[transports.length - 1] as FakeTransport,
  };
  return result;
}

const hello = (id = 'conn-1') => JSON.stringify({ t: 'hello', connection_id: id, protocol: 1 });
const statusEvent = (asid: string, seq: number) =>
  JSON.stringify({
    t: 'event',
    asid,
    seq,
    event: 'agent.status.changed',
    data: { type: 'agent.status.changed', asid, seq, status: 'busy' },
  });

function recorder() {
  const log: string[] = [];
  const events: AgentDomainEvent[] = [];
  const listener: GatewaySocketListener = {
    onSubscribed: () => log.push('subscribed'),
    onEvent: (event) => {
      events.push(event);
      log.push(`event:${event.asid}:${event.seq}`);
    },
    onResync: () => log.push('resync'),
    onOpenFailed: (count) => log.push(`failed:${count}`),
    onUnavailable: () => log.push('unavailable'),
  };
  return { log, events, listener };
}

describe('subscribing', () => {
  test('connects on demand, subscribes only after hello, and reports the ack', () => {
    const h = harness();
    const r = recorder();
    h.socket.watch('ses_1', r.listener);
    expect(h.transports).toHaveLength(1);
    expect(h.socket.state).toBe('connecting');
    // Nothing is sent before the server said hello.
    expect(h.latest().sent).toEqual([]);

    h.latest().deliver(hello());
    expect(h.socket.connected).toBe(true);
    expect(h.latest().sent).toEqual(['{"t":"subscribe","asid":"ses_1"}']);
    expect(r.log).toEqual([]);

    h.latest().deliver('{"t":"subscribed","asid":"ses_1"}');
    h.latest().deliver(statusEvent('ses_1', 4));
    h.latest().deliver(statusEvent('ses_2', 5));
    expect(r.log).toEqual(['subscribed', 'event:ses_1:4']);
    expect(r.events[0]).toMatchObject({ type: 'agent.status.changed', status: 'busy' });
  });

  test('an event or resync for no session reaches every listener', () => {
    const h = harness();
    const one = recorder();
    const two = recorder();
    h.socket.watch('ses_1', one.listener);
    h.socket.watch('ses_2', two.listener);
    h.latest().deliver(hello());
    h.latest().deliver('{"t":"resync","asid":""}');
    h.latest().deliver('{"t":"resync","asid":"ses_2"}');
    expect(one.log).toEqual(['resync']);
    expect(two.log).toEqual(['resync', 'resync']);
  });

  test('a second watch of an open socket is sent at once; unsubscribe waits for the last', () => {
    const h = harness();
    const first = h.socket.watch('ses_1', recorder().listener);
    h.latest().deliver(hello());
    const second = h.socket.watch('ses_1', recorder().listener);
    expect(h.latest().sent).toEqual([
      '{"t":"subscribe","asid":"ses_1"}',
      '{"t":"subscribe","asid":"ses_1"}',
    ]);
    first();
    expect(h.latest().sent).toHaveLength(2);
    second();
    expect(h.latest().sent[2]).toBe('{"t":"unsubscribe","asid":"ses_1"}');
  });

  test('subscribe_all acks to the watch-all listener', () => {
    const h = harness();
    const r = recorder();
    h.socket.watchAll(r.listener);
    h.latest().deliver(hello());
    expect(h.latest().sent).toEqual(['{"t":"subscribe_all"}']);
    h.latest().deliver('{"t":"subscribed","all":true}');
    h.latest().deliver(statusEvent('ses_9', 1));
    expect(r.log).toEqual(['subscribed', 'event:ses_9:1']);
  });

  test('an unwatched socket lingers, then closes', () => {
    const h = harness();
    const release = h.socket.watch('ses_1', recorder().listener);
    h.latest().deliver(hello());
    release();
    // A session switch re-watches within the linger and keeps the connection.
    h.socket.watch('ses_2', recorder().listener)();
    h.clock.advance(1_500);
    expect(h.latest().closed).toBe(true);
    expect(h.socket.state).toBe('idle');
    expect(h.transports).toHaveLength(1);
  });
});

describe('sealed connection', () => {
  test('opens sealed frames and seals its own', () => {
    const h = harness({ sealed: true });
    const r = recorder();
    h.socket.watch('ses_1', r.listener);
    const gateway = new GatewayFrameSealer(material, 'conn-1', 'nonce-0');
    h.latest().deliver(gateway.seal(hello('conn-1')));
    expect(h.socket.connected).toBe(true);
    expect(gateway.open(h.latest().sent[0] as string)).toBe('{"t":"subscribe","asid":"ses_1"}');
    h.latest().deliver(gateway.seal('{"t":"subscribed","asid":"ses_1"}'));
    h.latest().deliver(gateway.seal(statusEvent('ses_1', 7)));
    expect(r.log).toEqual(['subscribed', 'event:ses_1:7']);
  });

  test('an out-of-order server seq closes the connection and reconnects', () => {
    const h = harness({ sealed: true });
    const r = recorder();
    h.socket.watch('ses_1', r.listener);
    const gateway = new GatewayFrameSealer(material, 'conn-1', 'nonce-0');
    h.latest().deliver(gateway.seal(hello('conn-1')));
    gateway.skip();
    h.latest().deliver(gateway.seal(statusEvent('ses_1', 8)));
    expect(r.events).toHaveLength(0);
    expect(h.transports[0]?.closed).toBe(true);
    expect(h.socket.state).toBe('backoff');
    h.clock.advance(socketReconnectDelay(0));
    expect(h.transports).toHaveLength(2);
  });

  test('a hello naming another connection than the frame is refused', () => {
    const h = harness({ sealed: true });
    const r = recorder();
    h.socket.watch('ses_1', r.listener);
    const gateway = new GatewayFrameSealer(material, 'conn-1', 'nonce-0');
    h.latest().deliver(gateway.seal(hello('conn-2')));
    expect(h.socket.connected).toBe(false);
    expect(r.log).toEqual(['failed:1']);
  });

  test('every attempt seals a fresh upgrade', () => {
    const h = harness({ sealed: true });
    h.socket.watch('ses_1', recorder().listener);
    h.latest().drop();
    h.clock.advance(socketReconnectDelay(0));
    const gateway = new GatewayFrameSealer(material, 'conn-2', 'nonce-1');
    h.latest().deliver(gateway.seal(hello('conn-2')));
    expect(h.socket.connected).toBe(true);
  });
});

describe('reconnecting', () => {
  test('backs off like the workbench and re-subscribes after each reconnect', () => {
    const h = harness();
    const r = recorder();
    h.socket.watch('ses_1', r.listener);
    h.latest().drop();
    expect(r.log).toEqual(['failed:1']);
    h.clock.advance(399);
    expect(h.transports).toHaveLength(1);
    h.clock.advance(1);
    expect(h.transports).toHaveLength(2);
    h.latest().drop();
    expect(r.log).toEqual(['failed:1', 'failed:2']);
    h.clock.advance(799);
    expect(h.transports).toHaveLength(2);
    h.clock.advance(1);
    expect(h.transports).toHaveLength(3);

    h.latest().deliver(hello('conn-3'));
    expect(h.latest().sent).toEqual(['{"t":"subscribe","asid":"ses_1"}']);
    h.latest().deliver('{"t":"subscribed","asid":"ses_1"}');
    expect(r.log.at(-1)).toBe('subscribed');

    // A drop after hello is not a failed open, and the delay starts over.
    h.latest().drop();
    expect(r.log.filter((line) => line.startsWith('failed'))).toHaveLength(2);
    h.clock.advance(400);
    expect(h.transports).toHaveLength(4);
  });

  test('the delay is capped at five seconds', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(socketReconnectDelay)).toEqual([
      400, 800, 1600, 3200, 5000, 5000, 5000,
    ]);
  });

  test('an attempt that never says hello times out as a failure', () => {
    const h = harness();
    const r = recorder();
    h.socket.watch('ses_1', r.listener);
    h.clock.advance(10_000);
    expect(r.log).toEqual(['failed:1']);
    expect(h.transports[0]?.closed).toBe(true);
  });

  test('a ping unanswered by the next tick drops the connection', () => {
    const h = harness();
    h.socket.watch('ses_1', recorder().listener);
    h.latest().deliver(hello());
    h.clock.advance(25_000);
    expect(h.latest().sent.at(-1)).toBe('{"t":"ping"}');
    h.latest().deliver('{"t":"pong"}');
    h.clock.advance(25_000);
    expect(h.transports[0]?.closed).toBe(false);
    h.clock.advance(25_000);
    expect(h.transports[0]?.closed).toBe(true);
    expect(h.socket.state).toBe('backoff');
  });
});

describe('superseded', () => {
  test('stops reconnecting until the app comes back to the foreground', () => {
    const h = harness();
    h.socket.watch('ses_1', recorder().listener);
    h.latest().deliver(hello());
    h.latest().deliver('{"t":"error","code":"superseded"}');
    // The close that follows on the wire is not noticed any more.
    h.latest().drop();
    expect(h.socket.state).toBe('superseded');
    h.clock.advance(60_000);
    expect(h.transports).toHaveLength(1);

    h.appState.set(false);
    h.appState.set(true);
    expect(h.transports).toHaveLength(2);
    expect(h.socket.state).toBe('connecting');
  });

  test('a new watch is a user action and reconnects', () => {
    const h = harness();
    h.socket.watch('ses_1', recorder().listener);
    h.latest().deliver(hello());
    h.latest().deliver('{"t":"error","code":"superseded"}');
    h.socket.watch('ses_2', recorder().listener);
    expect(h.transports).toHaveLength(2);
    h.latest().deliver(hello('conn-2'));
    expect(h.latest().sent).toEqual([
      '{"t":"subscribe","asid":"ses_1"}',
      '{"t":"subscribe","asid":"ses_2"}',
    ]);
  });

  test('any other error code reconnects with backoff', () => {
    const h = harness();
    h.socket.watch('ses_1', recorder().listener);
    h.latest().deliver(hello());
    h.latest().deliver('{"t":"error","code":"out_of_order"}');
    expect(h.socket.state).toBe('backoff');
    h.clock.advance(400);
    expect(h.transports).toHaveLength(2);
  });
});

describe('app state', () => {
  test('closes in the background and reopens in the foreground', () => {
    const h = harness();
    const r = recorder();
    h.socket.watch('ses_1', r.listener);
    h.latest().deliver(hello());
    h.latest().deliver('{"t":"subscribed","asid":"ses_1"}');

    h.appState.set(false);
    expect(h.transports[0]?.closed).toBe(true);
    expect(h.socket.state).toBe('paused');
    h.clock.advance(60_000);
    expect(h.transports).toHaveLength(1);

    h.appState.set(true);
    expect(h.transports).toHaveLength(2);
    h.latest().deliver(hello('conn-2'));
    h.latest().deliver('{"t":"subscribed","asid":"ses_1"}');
    // The ack after the reopen is the listener's cue to catch up again.
    expect(r.log).toEqual(['subscribed', 'subscribed']);
  });

  test('a drop while backgrounded does not schedule a reconnect', () => {
    const h = harness();
    h.socket.watch('ses_1', recorder().listener);
    h.appState.set(false);
    expect(h.transports).toHaveLength(1);
    expect(h.socket.state).toBe('paused');
    h.clock.advance(60_000);
    expect(h.transports).toHaveLength(1);
  });
});

describe('unavailable', () => {
  test('no upgrade to build tells the listener at once', () => {
    const h = harness({ prepare: () => null });
    const r = recorder();
    h.socket.watch('ses_1', r.listener);
    expect(h.socket.state).toBe('unavailable');
    expect(r.log).toEqual(['unavailable']);
    expect(h.transports).toHaveLength(0);
  });

  test('a protocol this build does not speak stops without retrying', () => {
    const h = harness();
    const r = recorder();
    h.socket.watch('ses_1', r.listener);
    h.latest().deliver(JSON.stringify({ t: 'hello', connection_id: 'c', protocol: 2 }));
    expect(h.socket.state).toBe('unavailable');
    expect(r.log).toEqual(['unavailable']);
    h.clock.advance(60_000);
    expect(h.transports).toHaveLength(1);
  });

  test('a frame before hello is a failed open', () => {
    const h = harness();
    const r = recorder();
    h.socket.watch('ses_1', r.listener);
    h.latest().deliver('{"t":"pong"}');
    expect(r.log).toEqual(['failed:1']);
  });
});
