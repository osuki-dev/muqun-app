import { describe, expect, test } from 'bun:test';

import type { AgentDomainEvent } from '../agent-protocol';
import {
  GatewaySocket,
  gatewaySocketPath,
  MAX_RECONNECT_DELAY_MS,
  socketFailureIsUnauthorized,
  socketFailureNeedsRepair,
  type SocketRefusal,
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
    prepare?: () => GatewaySocketUpgrade | null | Promise<GatewaySocketUpgrade | null>;
    checkAuthorization?: () => Promise<SocketAuthorization>;
    onRefused?: (refusal: SocketRefusal) => void;
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
    onRefused: options.onRefused,
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

  test('a gateway with task_ws_subscription gets task frames alone until a session is watched', () => {
    const h = harness();
    const heard: string[] = [];
    h.socket.watchTasks(
      {
        onSubscribed: () => heard.push('subscribed'),
        onTaskUpdated: (task) => heard.push(task.taskId),
      },
      { tasksOnly: true }
    );
    h.latest().deliver(hello());
    h.latest().deliver('{"t":"subscribed","tasks":true}');
    h.latest().deliver(
      JSON.stringify({
        t: 'task',
        asid: null,
        seq: 4,
        event: 'task.updated',
        data: { task_id: 't8', state: 'idle_unconfirmed', kind: 'delegation', goal: 'g' },
      })
    );
    expect(heard).toEqual(['subscribed', 't8']);
    // `subscribe` alone would end the task delivery: widen first, then narrow back.
    const release = h.socket.watch('ses_1', recorder().listener);
    release();
    expect(h.latest().sent).toEqual([
      '{"t":"subscribe_tasks"}',
      '{"t":"subscribe_all"}',
      '{"t":"subscribe","asid":"ses_1"}',
      '{"t":"unsubscribe","asid":"ses_1"}',
      '{"t":"subscribe_tasks"}',
    ]);
  });

  test('a task-only resync refreshes tasks and leaves session timelines alone', () => {
    const h = harness();
    const session = recorder();
    const all = recorder();
    const tasks: string[] = [];
    h.socket.watch('ses_1', session.listener);
    h.socket.watchAll(all.listener);
    h.socket.watchTasks({ onResync: () => tasks.push('resync') });
    h.latest().deliver(hello());
    h.latest().deliver('{"t":"resync","asid":"","tasks":true}');
    expect(tasks).toEqual(['resync']);
    expect(session.log).toEqual([]);
    expect(all.log).toEqual([]);
    // A plain every-session resync still reaches both.
    h.latest().deliver('{"t":"resync","asid":""}');
    expect(tasks).toEqual(['resync', 'resync']);
    expect(session.log).toEqual(['resync']);
    expect(all.log).toEqual(['resync']);
  });

  test('a task-only socket drops session frames and closes when the cards let go', () => {
    const h = harness();
    const tasks: string[] = [];
    const release = h.socket.watchTasks({
      onTaskUpdated: (task) => tasks.push(task.taskId),
    });
    h.latest().deliver(hello());
    expect(h.latest().sent).toEqual(['{"t":"subscribe_all"}']);
    // subscribe_all carries every session's events too; nothing listens to them.
    expect(() => h.latest().deliver(statusEvent('ses_9', 1))).not.toThrow();
    h.latest().deliver(
      JSON.stringify({
        t: 'event',
        asid: null,
        seq: 3,
        event: 'task.updated',
        data: { task_id: 't7', state: 'working', kind: 'delegation', goal: 'g', updated_ms: 1 },
      })
    );
    expect(tasks).toEqual(['t7']);
    release();
    h.clock.advance(1_500);
    expect(h.latest().closed).toBe(true);
    expect(h.socket.state).toBe('idle');
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
    for (const message of [
      "Expected HTTP 101 response but was '401 Unauthorized'",
      'Invalid HTTP status 403',
      'Unexpected response code: 401',
      '403 Forbidden',
    ]) {
      expect(socketFailureIsUnauthorized({ message })).toBe(true);
    }
    expect(socketFailureIsUnauthorized({ closeCode: 4401 })).toBe(true);
    expect(socketFailureIsUnauthorized({ closeCode: 4403, message: '' })).toBe(true);
    for (const message of [
      '',
      'Connection reset by peer',
      "Expected HTTP 101 response but was '502 Bad Gateway'",
      // A bare number or a proxy's prose is not an HTTP status.
      'connect to 192.0.2.4:401 timed out',
      'read 401 bytes then EOF',
      'forbidden by policy',
      'unauthorized network',
    ]) {
      expect(socketFailureIsUnauthorized({ message })).toBe(false);
    }
    expect(socketFailureIsUnauthorized({ closeCode: 1006, message: '' })).toBe(false);
    expect(socketFailureIsUnauthorized({})).toBe(false);
  });

  test('classifies a demand to pair again apart from a dead token and from the network', () => {
    for (const message of [
      "Expected HTTP 101 response but was '426 Upgrade Required'",
      'Invalid HTTP status 426',
      'Unexpected response code: 426',
      '426 Upgrade Required',
    ]) {
      expect(socketFailureNeedsRepair({ message })).toBe(true);
      expect(socketFailureIsUnauthorized({ message })).toBe(false);
    }
    expect(socketFailureNeedsRepair({ closeCode: 4426 })).toBe(true);
    for (const message of [
      "Expected HTTP 101 response but was '401 Unauthorized'",
      'connect to 192.0.2.4:426 timed out',
      'read 426 bytes then EOF',
      '',
    ]) {
      expect(socketFailureNeedsRepair({ message })).toBe(false);
    }
    expect(socketFailureNeedsRepair({ closeCode: 4401 })).toBe(false);
  });

  test('an upgrade refused with 426 stands the socket down and says the pairing must be made again', () => {
    const refusals: SocketRefusal[] = [];
    const h = harness({ onRefused: (refusal) => refusals.push(refusal) });
    const r = recorder();
    h.socket.watch('ses_1', r.listener);
    h.latest().onerror?.("Expected HTTP 101 response but was '426 Upgrade Required'");
    expect(h.socket.state).toBe('unauthorized');
    expect(refusals).toEqual(['repair']);
    expect(r.log).toEqual(['unavailable']);
    // No retry on its own: the gateway will answer 426 until the device pairs again.
    h.clock.advance(120_000);
    expect(h.transports).toHaveLength(1);
  });

  test('a refused upgrade stops retrying and tells the listener', () => {
    const refusals: SocketRefusal[] = [];
    const h = harness({ onRefused: (refusal) => refusals.push(refusal) });
    const r = recorder();
    h.socket.watch('ses_1', r.listener);
    h.latest().onerror?.("Expected HTTP 101 response but was '401 Unauthorized'");
    expect(h.socket.state).toBe('unauthorized');
    expect(refusals).toEqual(['unauthorized']);
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

  test('opaque failures ask the gateway once per run of failures', async () => {
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
    // Not a refusal: the backoff carries on, and the run is not asked again.
    expect(h.socket.state).toBe('backoff');
    answer = 'unauthorized';
    for (const delay of [800, 1600, 3200, 6400]) {
      h.clock.advance(delay);
      h.latest().drop();
    }
    await Promise.resolve();
    await Promise.resolve();
    expect(asked).toBe(1);
    expect(h.socket.state).toBe('backoff');

    // `hello` ends the run; the next run gets its own ask, and its refusal stops the socket.
    h.clock.advance(12_800);
    h.latest().deliver(hello());
    h.latest().drop();
    h.clock.advance(400);
    h.latest().drop();
    h.clock.advance(800);
    h.latest().drop();
    expect(asked).toBe(2);
    await Promise.resolve();
    await Promise.resolve();
    expect(h.socket.state).toBe('unauthorized');
    const opened = h.transports.length;
    h.clock.advance(120_000);
    expect(h.transports).toHaveLength(opened);
  });

  test('a refused socket comes back on evidence the refusal no longer holds', () => {
    const h = harness();
    h.socket.watch('ses_1', recorder().listener);
    h.latest().onerror?.('Invalid HTTP status 403');
    expect(h.socket.state).toBe('unauthorized');
    h.socket.retryAfterRefusal();
    expect(h.transports).toHaveLength(2);
    expect(h.socket.state).toBe('connecting');
    // Only a refused socket is touched.
    h.socket.retryAfterRefusal();
    expect(h.transports).toHaveLength(2);
  });

  test('one network change retries a refusal once, until hello says the route is back', () => {
    const h = harness();
    h.socket.watch('ses_1', recorder().listener);
    h.latest().onerror?.('Invalid HTTP status 401');
    expect(h.socket.state).toBe('unauthorized');
    // The ok-probe after a network change asks for a retry...
    h.socket.retryAfterRefusal();
    expect(h.transports).toHaveLength(2);
    // ...and the upgrade flaps back to 401 on the new route.
    h.latest().onerror?.('Invalid HTTP status 401');
    expect(h.socket.state).toBe('unauthorized');
    // The same change's second call is not a second reconnect.
    h.socket.retryAfterRefusal();
    expect(h.transports).toHaveLength(2);
    expect(h.socket.state).toBe('unauthorized');
    // A user action still reopens, and a hello ends the retry.
    h.socket.reconnect();
    expect(h.transports).toHaveLength(3);
    h.latest().deliver(hello());
    expect(h.socket.state).toBe('open');
    h.latest().drop();
    h.clock.advance(400);
    h.latest().onerror?.('Invalid HTTP status 401');
    expect(h.socket.state).toBe('unauthorized');
    h.socket.retryAfterRefusal();
    expect(h.transports).toHaveLength(5);
    expect(h.socket.state).toBe('connecting');
  });

  test('a refused socket nothing wants stands down to idle', () => {
    const h = harness();
    const release = h.socket.watch('ses_1', recorder().listener);
    h.latest().onerror?.('Invalid HTTP status 401');
    release();
    expect(h.socket.state).toBe('unauthorized');
    h.socket.retryAfterRefusal();
    expect(h.socket.state).toBe('idle');
    expect(h.transports).toHaveLength(1);
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

test('a negotiated socket upgrade does not open after the app backgrounds', async () => {
  let resolve!: (value: GatewaySocketUpgrade) => void;
  const ready = new Promise<GatewaySocketUpgrade>((yes) => {
    resolve = yes;
  });
  const h = harness({ prepare: () => ready });
  h.socket.watch('ses_1', recorder().listener);
  expect(h.transports).toHaveLength(0);
  h.appState.set(false);
  resolve({ url: 'ws://gateway.test/api/ws', headers: {}, seal: null });
  await ready;
  await Promise.resolve();
  expect(h.transports).toHaveLength(0);
  expect(h.socket.state).toBe('paused');
});

test('an asynchronous negotiated upgrade opens once ready', async () => {
  const h = harness({
    prepare: async () => ({ url: 'ws://gateway.test/api/ws', headers: {}, seal: null }),
  });
  h.socket.watch('ses_1', recorder().listener);
  expect(h.transports).toHaveLength(0);
  await Promise.resolve();
  expect(h.transports).toHaveLength(1);
  h.latest().deliver(hello());
  expect(h.socket.state).toBe('open');
});

test('Home summaries share the socket without becoming session subscriptions or task acknowledgments', () => {
  const h = harness();
  const frames: string[] = [];
  let taskAcks = 0;
  const releaseTasks = h.socket.watchTasks({ onSubscribed: () => taskAcks++ }, { tasksOnly: true });
  const releaseHome = h.socket.watchHome([], { onHome: (frame) => frames.push(frame.sourceId) });
  h.latest().deliver(hello());
  expect(h.latest().sent).toEqual([
    '{"t":"subscribe_tasks"}',
    '{"t":"subscribe_home","home":{"sources":[]}}',
  ]);
  h.latest().deliver('{"t":"subscribed","home":true}');
  expect(taskAcks).toBe(0);
  h.latest().deliver(
    '{"t":"home","source_id":"a","generation":"g","revision":1,"snapshot":true,"tasks":[],"removed":[]}'
  );
  expect(frames).toEqual(['a']);
  releaseHome();
  expect(h.latest().sent.at(-1)).toBe('{"t":"unsubscribe_home"}');
  expect(h.latest().closed).toBe(false);
  releaseTasks();
});
