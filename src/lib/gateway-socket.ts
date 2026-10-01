/**
 * One event WebSocket per paired gateway, carrying the agent events of every
 * session the app is watching.
 *
 * The gateway side is `GET /api/ws` (`agents/ws_routes.rs`); the frames and
 * their sealing are `agent-socket-codec.ts`. This owns the lifetime: opening
 * the upgrade with a freshly sealed envelope, re-subscribing after every
 * reconnect, backing off (`min(400 * 2^n, 5000)` ms, the workbench's SSE
 * policy), closing while the app is in the background and reopening when it
 * returns, and standing down when the gateway says another socket of this
 * device has `superseded` it -- reconnecting then would evict that one, which
 * would evict this one, forever.
 *
 * Catch-up is not here. The socket carries live events only; a listener's
 * `onSubscribed` is the moment to ask `timeline?after=seq`, exactly as the SSE
 * path does on connect.
 *
 * Pure: the native socket, crypto, app state and timers are injected, so the
 * lifecycle runs under bun against a fake. `gateway-socket-runtime.ts` wires
 * the real ones.
 */
import type { AgentDomainEvent, TransportsDiscovery } from './agent-protocol';
import {
  AGENT_SOCKET_PATH,
  AGENT_SOCKET_PROTOCOL,
  AgentSocketProtocolError,
  parseAgentSocketFrame,
  PlainAgentSocketCodec,
  SealedAgentSocketCodec,
  serializeAgentSocketFrame,
  type AgentSocketClientFrame,
  type AgentSocketCodec,
  type SocketFrameCrypto,
} from './agent-socket-codec';

/** The part of a `NitroWebSocket` this uses. */
export interface GatewaySocketTransport {
  onopen: (() => void) | null;
  onmessage: ((event: { data: string; isBinary: boolean }) => void) | null;
  onerror: ((error: string) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

/** One upgrade, sealed fresh for each connection attempt. */
export interface GatewaySocketUpgrade {
  /** `ws://…/api/ws` or `wss://…/api/ws`. */
  url: string;
  headers: Record<string, string>;
  /** Null for a device paired without a transport key. */
  seal: { requestAad: string; requestNonce: string; material: Uint8Array } | null;
}

export interface GatewaySocketAppState {
  isActive(): boolean;
  subscribe(listener: (active: boolean) => void): () => void;
}

export type GatewaySocketState =
  /** Nothing wants the socket. */
  | 'idle'
  | 'connecting'
  /** `hello` arrived; subscriptions are in flight or in effect. */
  | 'open'
  /** Dropped; a reconnect is scheduled. */
  | 'backoff'
  /** The app is in the background. */
  | 'paused'
  /** Another socket of this device replaced this one. Waits for a user action or foreground. */
  | 'superseded'
  /** No gateway to open against, no native module, or a protocol this build does not speak. */
  | 'unavailable';

export interface GatewaySocketListener {
  /** The subscription is in effect; catch up now. Fires again after every reconnect. */
  onSubscribed?: () => void;
  onEvent?: (event: AgentDomainEvent) => void;
  /** The gateway dropped events for this session; refetch it. */
  onResync?: () => void;
  /** Consecutive connection attempts that ended before `hello`. */
  onOpenFailed?: (consecutive: number) => void;
  /** The socket cannot be used; fall back. */
  onUnavailable?: () => void;
}

export interface GatewaySocketOptions {
  prepare: () => GatewaySocketUpgrade | null;
  open: (url: string, headers: Record<string, string>) => GatewaySocketTransport;
  crypto: SocketFrameCrypto;
  appState?: GatewaySocketAppState;
  schedule?: (run: () => void, ms: number) => () => void;
  /** Application ping cadence; a ping unanswered by the next tick drops the socket. */
  pingIntervalMs?: number;
  /** How long an attempt may take to reach `hello`. */
  connectTimeoutMs?: number;
  /** How long an unwatched socket stays open, so a session switch does not reconnect. */
  lingerMs?: number;
}

/** The `/health` capability that says `GET /api/ws` exists. */
export const WS_EVENTS_CAPABILITY = 'ws_events';

/**
 * The path to upgrade on: the one discovery's `transports.websocket` states,
 * else `/api/ws`, which is where every gateway before `transports` has it.
 * `null` when the gateway says it speaks a frame protocol this build does
 * not, which leaves the workbench on SSE rather than on a socket it would
 * close at `hello`.
 */
export function gatewaySocketPath(
  transports: TransportsDiscovery | null | undefined
): string | null {
  const websocket = transports?.websocket;
  if (websocket?.protocol !== undefined && websocket.protocol !== AGENT_SOCKET_PROTOCOL) {
    return null;
  }
  return websocket?.path ?? AGENT_SOCKET_PATH;
}

const ALL = '*';

/** The workbench's SSE reconnect delay, shared so both transports back off alike. */
export function socketReconnectDelay(attempt: number): number {
  return Math.min(400 * 2 ** attempt, 5000);
}

const defaultSchedule = (run: () => void, ms: number) => {
  const timer = setTimeout(run, ms);
  return () => clearTimeout(timer);
};

interface Connection {
  transport: GatewaySocketTransport;
  codec: AgentSocketCodec;
  hello: boolean;
  heardSincePing: boolean;
}

export class GatewaySocket {
  private readonly options: GatewaySocketOptions;
  private readonly schedule: (run: () => void, ms: number) => () => void;
  private readonly listeners = new Map<string, Set<GatewaySocketListener>>();
  private readonly stateListeners = new Set<(state: GatewaySocketState) => void>();
  /** Reference counts; `*` is `subscribe_all`. */
  private readonly wanted = new Map<string, number>();
  private connection: Connection | null = null;
  private currentState: GatewaySocketState = 'idle';
  private attempts = 0;
  private failures = 0;
  private active: boolean;
  private cancelTimer: (() => void) | null = null;
  private cancelPing: (() => void) | null = null;
  private cancelLinger: (() => void) | null = null;
  private readonly releaseAppState: (() => void) | null;

  constructor(options: GatewaySocketOptions) {
    this.options = options;
    this.schedule = options.schedule ?? defaultSchedule;
    this.active = options.appState?.isActive() ?? true;
    this.releaseAppState =
      options.appState?.subscribe((active) => this.setAppActive(active)) ?? null;
  }

  get state(): GatewaySocketState {
    return this.currentState;
  }

  /** `hello` arrived on the current connection. */
  get connected(): boolean {
    return this.currentState === 'open';
  }

  onStateChange(listener: (state: GatewaySocketState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  /** Subscribe to one session and listen to it. The returned function undoes both. */
  watch(asid: string, listener: GatewaySocketListener): () => void {
    const removeListener = this.addListener(asid, listener);
    this.subscribe(asid);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      removeListener();
      this.unsubscribe(asid);
    };
  }

  /** `subscribe_all` and listen to every session. */
  watchAll(listener: GatewaySocketListener): () => void {
    const removeListener = this.addListener(ALL, listener);
    this.subscribeAll();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      removeListener();
      this.release(ALL);
    };
  }

  addListener(asid: string, listener: GatewaySocketListener): () => void {
    let set = this.listeners.get(asid);
    if (!set) {
      set = new Set();
      this.listeners.set(asid, set);
    }
    set.add(listener);
    return () => {
      const current = this.listeners.get(asid);
      current?.delete(listener);
      if (current?.size === 0) this.listeners.delete(asid);
    };
  }

  subscribe(asid: string): void {
    this.want(asid, { t: 'subscribe', asid });
  }

  /**
   * Drop one reference to a session. The frame goes out only when nothing else
   * watches it. It never narrows a `subscribe_all`; that lasts the connection.
   */
  unsubscribe(asid: string): void {
    if (this.release(asid) && this.currentState === 'open') {
      this.send({ t: 'unsubscribe', asid });
    }
  }

  subscribeAll(): void {
    this.want(ALL, { t: 'subscribe_all' });
  }

  /** A user action: reopen now, even after `superseded` or during a backoff. */
  reconnect(): void {
    if (!this.hasDemand() || !this.active) return;
    this.attempts = 0;
    this.drop();
    this.connect();
  }

  dispose(): void {
    this.releaseAppState?.();
    this.cancelLinger?.();
    this.cancelLinger = null;
    this.wanted.clear();
    this.listeners.clear();
    this.drop();
    this.setState('idle');
    this.stateListeners.clear();
  }

  // -------------------------------------------------------------------------

  private want(key: string, frame: AgentSocketClientFrame): void {
    this.wanted.set(key, (this.wanted.get(key) ?? 0) + 1);
    this.cancelLinger?.();
    this.cancelLinger = null;
    if (this.currentState === 'open') {
      // Sent on every call, not only the first: the ack is what tells this
      // caller to catch up, and the gateway answers a repeat as readily.
      this.send(frame);
      return;
    }
    if (this.currentState === 'superseded' || this.currentState === 'unavailable') {
      // A new watch is a user action; it is allowed to try again.
      this.reconnect();
      return;
    }
    if (this.currentState === 'idle') this.connect();
  }

  /** Answers whether the last reference went. */
  private release(key: string): boolean {
    const count = this.wanted.get(key) ?? 0;
    if (count <= 0) return false;
    if (count > 1) {
      this.wanted.set(key, count - 1);
      return false;
    }
    this.wanted.delete(key);
    if (!this.hasDemand()) {
      this.cancelLinger?.();
      this.cancelLinger = this.schedule(() => {
        this.cancelLinger = null;
        if (this.hasDemand()) return;
        this.drop();
        this.setState('idle');
      }, this.options.lingerMs ?? 1500);
    }
    return true;
  }

  private hasDemand(): boolean {
    return this.wanted.size > 0;
  }

  private setState(state: GatewaySocketState): void {
    if (state === this.currentState) return;
    this.currentState = state;
    for (const listener of [...this.stateListeners]) listener(state);
  }

  private setAppActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    if (!active) {
      // A backgrounded app's socket is killed by the OS sooner or later, and a
      // half-dead one delivers nothing; close it deliberately instead.
      this.drop();
      if (this.hasDemand()) this.setState('paused');
      return;
    }
    // Foreground clears `superseded` too: the reader is back, this is the
    // device's newest socket again.
    this.attempts = 0;
    if (this.hasDemand()) this.connect();
  }

  private connect(): void {
    this.drop();
    if (!this.active) {
      this.setState('paused');
      return;
    }
    let upgrade: GatewaySocketUpgrade | null;
    let transport: GatewaySocketTransport;
    try {
      upgrade = this.options.prepare();
      if (!upgrade) throw new Error('No gateway to open a socket against.');
      transport = this.options.open(upgrade.url, upgrade.headers);
    } catch {
      this.unavailable();
      return;
    }
    const codec: AgentSocketCodec = upgrade.seal
      ? new SealedAgentSocketCodec({ crypto: this.options.crypto, ...upgrade.seal })
      : new PlainAgentSocketCodec();
    const connection: Connection = { transport, codec, hello: false, heardSincePing: true };
    this.connection = connection;
    this.setState('connecting');

    const current = () => this.connection === connection;
    transport.onmessage = (event) => {
      if (current()) this.receive(connection, event);
    };
    transport.onerror = () => {
      if (current()) this.lost(connection);
    };
    transport.onclose = () => {
      if (current()) this.lost(connection);
    };
    this.cancelTimer = this.schedule(() => {
      this.cancelTimer = null;
      if (current() && !connection.hello) this.lost(connection);
    }, this.options.connectTimeoutMs ?? 10_000);
  }

  private receive(connection: Connection, event: { data: string; isBinary: boolean }): void {
    connection.heardSincePing = true;
    let frame;
    try {
      if (event.isBinary) throw new AgentSocketProtocolError('Binary socket frame.');
      frame = parseAgentSocketFrame(connection.codec.openServer(event.data));
    } catch {
      // Tamper, replay, a gap or rubbish: none is survivable in place.
      this.lost(connection);
      return;
    }
    if (!connection.hello) {
      if (
        !frame ||
        frame.t !== 'hello' ||
        (connection.codec.connectionId !== null &&
          frame.connectionId !== connection.codec.connectionId)
      ) {
        this.lost(connection);
        return;
      }
      if (frame.protocol !== AGENT_SOCKET_PROTOCOL) {
        this.unavailable();
        return;
      }
      connection.hello = true;
      this.attempts = 0;
      this.failures = 0;
      this.cancelTimer?.();
      this.cancelTimer = null;
      this.setState('open');
      if (this.wanted.has(ALL)) this.send({ t: 'subscribe_all' });
      for (const key of this.wanted.keys()) {
        if (key !== ALL) this.send({ t: 'subscribe', asid: key });
      }
      this.armPing(connection);
      return;
    }
    if (!frame) return;
    switch (frame.t) {
      case 'subscribed':
        this.notify('asid' in frame ? [frame.asid] : [ALL], (l) => l.onSubscribed?.());
        return;
      case 'event':
        if (frame.event) {
          const domainEvent = frame.event;
          this.notify(this.targets(frame.asid), (l) => l.onEvent?.(domainEvent));
        }
        return;
      case 'resync':
        this.notify(this.targets(frame.asid), (l) => l.onResync?.());
        return;
      case 'error':
        if (frame.code === 'superseded') {
          this.drop();
          this.setState('superseded');
        } else {
          this.lost(connection);
        }
        return;
      default:
        return;
    }
  }

  /** Listeners for one session plus the watch-all ones; every listener for "". */
  private targets(asid: string): string[] {
    if (!asid) return [...this.listeners.keys()];
    return [asid, ALL];
  }

  private notify(keys: string[], call: (listener: GatewaySocketListener) => void): void {
    const seen = new Set<GatewaySocketListener>();
    for (const key of keys) {
      for (const listener of [...(this.listeners.get(key) ?? [])]) {
        if (seen.has(listener)) continue;
        seen.add(listener);
        call(listener);
      }
    }
  }

  private allListeners(call: (listener: GatewaySocketListener) => void): void {
    this.notify([...this.listeners.keys()], call);
  }

  private send(frame: AgentSocketClientFrame): void {
    const connection = this.connection;
    if (!connection?.hello) return;
    try {
      connection.transport.send(connection.codec.sealClient(serializeAgentSocketFrame(frame)));
    } catch {
      this.lost(connection);
    }
  }

  private armPing(connection: Connection): void {
    this.cancelPing = this.schedule(() => {
      this.cancelPing = null;
      if (this.connection !== connection) return;
      if (!connection.heardSincePing) {
        this.lost(connection);
        return;
      }
      connection.heardSincePing = false;
      this.send({ t: 'ping' });
      if (this.connection === connection) this.armPing(connection);
    }, this.options.pingIntervalMs ?? 25_000);
  }

  /** The connection is over by any means other than asking for it. */
  private lost(connection: Connection): void {
    if (this.connection !== connection) return;
    const reachedHello = connection.hello;
    this.drop();
    if (!reachedHello) {
      this.failures += 1;
      const failures = this.failures;
      this.allListeners((l) => l.onOpenFailed?.(failures));
    }
    if (!this.hasDemand()) {
      this.setState('idle');
      return;
    }
    if (!this.active) {
      this.setState('paused');
      return;
    }
    const delay = socketReconnectDelay(this.attempts);
    this.attempts += 1;
    this.setState('backoff');
    this.cancelTimer = this.schedule(() => {
      this.cancelTimer = null;
      this.connect();
    }, delay);
  }

  private unavailable(): void {
    this.drop();
    this.setState('unavailable');
    this.allListeners((l) => l.onUnavailable?.());
  }

  /** Close the current connection, if any, without anything reacting to it. */
  private drop(): void {
    this.clearTimers();
    const connection = this.connection;
    this.connection = null;
    if (!connection) return;
    const { transport } = connection;
    transport.onmessage = null;
    transport.onerror = null;
    transport.onclose = null;
    transport.onopen = null;
    try {
      transport.close(1000, '');
    } catch {
      // Already gone.
    }
  }

  private clearTimers(): void {
    this.cancelTimer?.();
    this.cancelTimer = null;
    this.cancelPing?.();
    this.cancelPing = null;
  }
}
