import { describe, expect, test } from 'bun:test';

import type { AgentDomainEvent } from '../agent-protocol';
import {
  GatewaySocket,
  gatewaySocketPath,
  MAX_RECONNECT_DELAY_MS,
  socketFailureIsUnauthorized,
  socketReconnectDelay,
  type SocketAuthorization,
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

function harness(
  options: {
    sealed?: boolean;
    prepare?: () => GatewaySocketUpgrade | null;
    checkAuthorization?: () => Promise<SocketAuthorization>;
  } = {}
) {
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
    // The top of each jitter window, so the schedule below reads in whole numbers.
    random: () => 1,
    checkAuthorization: options.checkAuthorization,
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

  test('watchTasks subscribes to all and only its listener hears task.updated', () => {
    const h = harness();
    const tasks: string[] = [];
    const session = recorder();
    const all = recorder();
    h.socket.watch('ses_1', session.listener);
    h.socket.watchAll(all.listener);
    const release = h.socket.watchTasks({
      onTaskUpdated: (task, seq) => tasks.push(`${task.taskId}:${task.state}:${seq}`),
    });
    h.latest().deliver(hello());
    expect(h.latest().sent).toContain('{"t":"subscribe_all"}');
    h.latest().deliver(
      JSON.stringify({
        t: 'event',
        asid: null,
        seq: 9,
        event: 'task.updated',
        data: { task_id: 't1', state: 'done', kind: 'command', goal: 'g', updated_ms: 1 },
      })
    );
    expect(tasks).toEqual(['t1:done:9']);
    expect(session.log).toEqual([]);
    expect(all.log).toEqual([]);
    release();
    h.latest().deliver(
      JSON.stringify({
        t: 'event',
        asid: null,
        seq: 10,
        event: 'task.updated',
        data: { task_id: 't1', state: 'done', kind: 'command', goal: 'g', updated_ms: 2 },
      })
    );
    expect(tasks).toHaveLength(1);
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
    h.clock.advance(socketReconnectDelay(0, () => 1));
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
    h.clock.advance(socketReconnectDelay(0, () => 1));
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

  test('jitter keeps every delay between half and all of its window', () => {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const ceiling = Math.min(400 * 2 ** attempt, MAX_RECONNECT_DELAY_MS);
      expect(socketReconnectDelay(attempt, () => 0)).toBe(ceiling / 2);
      expect(socketReconnectDelay(attempt, () => 1)).toBe(ceiling);
      for (let sample = 0; sample < 50; sample += 1) {
        const delay = socketReconnectDelay(attempt);
        expect(delay).toBeGreaterThanOrEqual(ceiling / 2);
        expect(delay).toBeLessThanOrEqual(ceiling);
      }
    }
    // A random source out of range cannot push the delay outside the window.
    expect(socketReconnectDelay(0, () => 7)).toBe(400);
    expect(socketReconnectDelay(0, () => -1)).toBe(200);
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

describe('the upgrade path', () => {
  test('a gateway that does not say is the path it always was', () => {
    expect(gatewaySocketPath(undefined)).toBe('/api/ws');
    expect(gatewaySocketPath(null)).toBe('/api/ws');
    expect(gatewaySocketPath({})).toBe('/api/ws');
  });

  test('the path discovery states is the one used', () => {
    expect(gatewaySocketPath({ websocket: { path: '/gw/api/ws', protocol: 1 } })).toBe(
      '/gw/api/ws'
    );
    expect(gatewaySocketPath({ websocket: { path: '/api/ws' } })).toBe('/api/ws');
  });

  test('a protocol this build does not speak means no socket at all', () => {
    expect(gatewaySocketPath({ websocket: { path: '/api/ws', protocol: 2 } })).toBeNull();
  });
});

describe('unauthorized', () => {
  test('classifies a refused upgrade apart from a network failure', () => {
    expect(
      socketFailureIsUnauthorized({
        message: "Expected HTTP 101 response but was '401 Unauthorized'",
      })
    ).toBe(true);
    expect(socketFailureIsUnauthorized({ message: 'Invalid HTTP status 403' })).toBe(true);
    expect(socketFailureIsUnauthorized({ message: 'forbidden' })).toBe(true);
    expect(socketFailureIsUnauthorized({ closeCode: 4401 })).toBe(true);
    expect(socketFailureIsUnauthorized({ closeCode: 4403, message: '' })).toBe(true);
    expect(socketFailureIsUnauthorized({ closeCode: 1006, message: '' })).toBe(false);
    expect(socketFailureIsUnauthorized({ message: 'Connection reset by peer' })).toBe(false);
    expect(
      socketFailureIsUnauthorized({
        message: "Expected HTTP 101 response but was '502 Bad Gateway'",
      })
    ).toBe(false);
    // A port or a byte count with the same digits inside it is not a status.
    expect(socketFailureIsUnauthorized({ message: 'connect to 10.0.0.4:14013 timed out' })).toBe(
      false
    );
    expect(socketFailureIsUnauthorized({})).toBe(false);
  });

  test('a refused upgrade stops retrying and tells the listener', () => {
    const h = harness();
    const r = recorder();
    h.socket.watch('ses_1', r.listener);
    h.latest().onerror?.("Expected HTTP 101 response but was '401 Unauthorized'");
    expect(h.socket.state).toBe('unauthorized');
    expect(r.log).toEqual(['unavailable']);
    h.clock.advance(120_000);
    expect(h.transports).toHaveLength(1);
    // Coming back to the foreground does not re-pair the device.
    h.appState.set(false);
    h.appState.set(true);
    expect(h.transports).toHaveLength(1);
    // A user action does try again.
    h.socket.reconnect();
    expect(h.transports).toHaveLength(2);
  });

  test('opaque failures ask the gateway, and a refusal stops the backoff', async () => {
    let asked = 0;
    let answer: SocketAuthorization = 'unknown';
    const h = harness({
      checkAuthorization: async () => {
        asked += 1;
        return answer;
      },
    });
    h.socket.watch('ses_1', recorder().listener);
    h.latest().drop();
    expect(asked).toBe(0);
    h.clock.advance(400);
    h.latest().drop();
    expect(asked).toBe(1);
    await Promise.resolve();
    await Promise.resolve();
    // Not a refusal: the backoff carries on.
    expect(h.socket.state).toBe('backoff');

    answer = 'unauthorized';
    h.clock.advance(800);
    h.latest().drop();
    expect(asked).toBe(2);
    await Promise.resolve();
    await Promise.resolve();
    expect(h.socket.state).toBe('unauthorized');
    h.clock.advance(120_000);
    expect(h.transports).toHaveLength(3);
  });

  test('a socket that reached hello meanwhile ignores a late refusal', async () => {
    let settle: (answer: SocketAuthorization) => void = () => {};
    const h = harness({
      checkAuthorization: () =>
        new Promise<SocketAuthorization>((resolve) => {
          settle = resolve;
        }),
    });
    h.socket.watch('ses_1', recorder().listener);
    h.latest().drop();
    h.clock.advance(400);
    h.latest().drop();
    h.clock.advance(800);
    h.latest().deliver(hello());
    expect(h.socket.state).toBe('open');
    settle('unauthorized');
    await Promise.resolve();
    await Promise.resolve();
    expect(h.socket.state).toBe('open');
  });
});
