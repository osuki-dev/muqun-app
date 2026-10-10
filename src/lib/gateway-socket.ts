/**
 * One event WebSocket per paired gateway, carrying the agent events of every
 * session the app is watching.
 *
 * The gateway side is `GET /api/ws` (`agents/ws_routes.rs`); the frames and
 * their sealing are `agent-socket-codec.ts`. This owns the lifetime: opening
 * the upgrade with a freshly sealed envelope, re-subscribing after every
 * reconnect, backing off (`min(400 * 2^n, 30000)` ms with jitter, the
 * workbench's SSE policy too), closing while the app is in the background and
 * reopening when it returns, standing down when the gateway says another
 * socket of this device has `superseded` it -- reconnecting then would evict
 * that one, which would evict this one, forever -- and standing down when the
 * gateway refuses the pairing itself (`unauthorized`): a revoked token does
 * not come back by retrying, and every retry puts it on the wire again.
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
import type { TaskView } from './task-ledger';
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
  /** The gateway refused this device's pairing (401/403). Waits for a user action. */
  | 'unauthorized'
  /** No gateway to open against, no native module, or a protocol this build does not speak. */
  | 'unavailable';

export interface GatewaySocketListener {
  /** The subscription is in effect; catch up now. Fires again after every reconnect. */
  onSubscribed?: () => void;
  onEvent?: (event: AgentDomainEvent) => void;
  /** A task changed. Only `watchTasks` listeners hear it. */
  onTaskUpdated?: (task: TaskView, seq: number) => void;
  /** The gateway dropped events for this session; refetch it. */
  onResync?: () => void;
  /** Where this device's next task runs by default (`defaults` frame). Task listeners only. */
  onDefaults?: (defaultCwd: string | null) => void;
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
  /** Each accepted `hello`, for the gateway `generation` it may carry. */
  onHello?: (hello: { generation?: string }) => void;
  /**
   * Asked after repeated failed opens whose close did not say why: whether the
   * gateway still accepts this device (a cheap authenticated read). An upgrade
   * refused with 401 usually reaches the socket only as an opaque error.
   */
  checkAuthorization?: () => Promise<SocketAuthorization>;
  /** `Math.random` unless a test pins the backoff jitter. */
  random?: () => number;
}

export type SocketAuthorization = 'authorized' | 'unauthorized' | 'unknown';

/** What ended a connection attempt, as far as the transport said. */
export interface SocketFailure {
  closeCode?: number;
  /** The close reason or the native error text. */
  message?: string;
}

/**
 * Whether a failed open was the gateway refusing this device.
 *
 * An HTTP 401/403 on the upgrade surfaces as an error string from the native
 * socket ("Expected HTTP 101 response but was '401 Unauthorized'", "Invalid
 * HTTP status 403", ...); a gateway that closes after the upgrade uses the
 * 4401/4403 convention. Anything else -- a reset, a timeout, a 502 from a
 * proxy -- is a network problem and keeps retrying.
 */
export function socketFailureIsUnauthorized(failure: SocketFailure): boolean {
  if (failure.closeCode === 4401 || failure.closeCode === 4403) return true;
  const message = failure.message ?? '';
  // Only a status in an HTTP context: a bare "401" (a port, a byte count) or a
  // proxy's prose saying "forbidden" must not stop the socket.
  return (
    /\b(HTTP|status|response)\b[^0-9]{0,20}\b40[13]\b/i.test(message) ||
    /\b40[13] (Unauthori[sz]ed|Forbidden)\b/i.test(message)
  );
}

/** Failed opens in a row before the gateway is asked whether it still knows this device. */
export const AUTH_CHECK_AFTER_FAILURES = 2;

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
/** The task listeners' demand, apart from any session's. */
const TASKS = '#tasks';

/** The longest wait between reconnects, before jitter. */
export const MAX_RECONNECT_DELAY_MS = 30_000;

/**
 * The workbench's SSE reconnect delay, shared so both transports back off
 * alike: `min(400 * 2^n, 30000)`, scaled by a random 0.5-1.0 so a gateway
 * restart is not met by every phone reconnecting in the same instant.
 */
export function socketReconnectDelay(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(400 * 2 ** attempt, MAX_RECONNECT_DELAY_MS);
  const factor = 0.5 + 0.5 * Math.min(1, Math.max(0, random()));
  return Math.round(ceiling * factor);
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
  /** The last subscription frame sent was `subscribe_tasks`: no session traffic. */
  tasksOnly: boolean;
}

export class GatewaySocket {
  private readonly options: GatewaySocketOptions;
  private readonly schedule: (run: () => void, ms: number) => () => void;
  private readonly listeners = new Map<string, Set<GatewaySocketListener>>();
  /**
   * `watchTasks` listeners, each with whether its gateway takes
   * `subscribe_tasks`; never reached through `targets`.
   */
  private readonly taskListeners = new Map<GatewaySocketListener, boolean>();
  private readonly stateListeners = new Set<(state: GatewaySocketState) => void>();
  /** Reference counts; `*` is `subscribe_all`, `#tasks` the task listeners. */
  private readonly wanted = new Map<string, number>();
  private connection: Connection | null = null;
  private currentState: GatewaySocketState = 'idle';
  private attempts = 0;
  private failures = 0;
  private active: boolean;
  private cancelTimer: (() => void) | null = null;
  private cancelPing: (() => void) | null = null;
  private cancelLinger: (() => void) | null = null;
  private checkingAuthorization = false;
  /**
   * The gateway was already asked during this run of failed opens. Each ask is
   * a forced `/health`, so a run gets one, not one per failure; `hello` and a
   * refusal start a new run.
   */
  private authChecked = false;
  /**
   * `retryAfterRefusal` already reopened the socket and no `hello` has arrived
   * since. One network change can bring the evidence twice -- an ok-probe,
   * then the upgrade flapping back to 401 -- and the second must not reconnect
   * again on top of the first.
   */
  private refusalRetried = false;
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
      this.narrowToTasks();
    };
  }

  /**
   * Listen to task changes only. Kept apart from the session listeners: those
   * are keyed by session, and "every session" must not reach a listener that
   * wants tasks.
   *
   * With `tasksOnly` (the gateway advertises `task_ws_subscription`) and no
   * session watched on this socket, it asks for `subscribe_tasks`, so the
   * gateway sends task frames and nothing else. Otherwise -- an older gateway,
   * or the selected computer's socket that also carries sessions -- it is
   * `subscribe_all`, the only subscription that carries tasks beside sessions,
   * and the session traffic is left unheard. The socket moves between the two
   * as session watches come and go.
   */
  watchTasks(listener: GatewaySocketListener, options?: { tasksOnly?: boolean }): () => void {
    this.taskListeners.set(listener, options?.tasksOnly === true);
    this.want(TASKS, this.taskOnly() ? { t: 'subscribe_tasks' } : { t: 'subscribe_all' });
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.taskListeners.delete(listener);
      this.release(TASKS);
      this.narrowToTasks();
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
      this.narrowToTasks();
    }
  }

  subscribeAll(): void {
    this.want(ALL, { t: 'subscribe_all' });
  }

  /**
   * A user action: reopen now, even after `superseded`, `unauthorized` or during
   * a backoff. Also what a network change calls: the old route is gone.
   */
  reconnect(): void {
    if (!this.hasDemand() || !this.active) return;
    this.attempts = 0;
    this.authChecked = false;
    this.drop();
    this.connect();
  }

  /**
   * Evidence that the refusal no longer holds -- the gateway answered this
   * device, or the network under it changed (a captive portal's 403 looks
   * exactly like a revoked pairing). Reopen if anything wants the socket,
   * otherwise stand down to `idle` so the row stops saying the pairing expired.
   */
  retryAfterRefusal(): void {
    if (this.currentState !== 'unauthorized' || this.refusalRetried) return;
    if (this.hasDemand() && this.active) {
      this.refusalRetried = true;
      this.reconnect();
      return;
    }
    this.setState(this.hasDemand() ? 'paused' : 'idle');
  }

  dispose(): void {
    this.releaseAppState?.();
    this.cancelLinger?.();
    this.cancelLinger = null;
    this.wanted.clear();
    this.listeners.clear();
    this.taskListeners.clear();
    this.drop();
    this.setState('idle');
    this.stateListeners.clear();
  }

  // -------------------------------------------------------------------------

  /** Whether this socket can carry tasks alone: only task listeners, all on a gateway that can. */
  private taskOnly(): boolean {
    if (this.taskListeners.size === 0) return false;
    for (const ok of this.taskListeners.values()) if (!ok) return false;
    for (const key of this.wanted.keys()) if (key !== TASKS) return false;
    return true;
  }

  /** The last session watch went: back to task frames alone, when the gateway can. */
  private narrowToTasks(): void {
    if (this.currentState !== 'open' || this.connection?.tasksOnly || !this.taskOnly()) return;
    this.send({ t: 'subscribe_tasks' });
  }

  private want(key: string, frame: AgentSocketClientFrame): void {
    this.wanted.set(key, (this.wanted.get(key) ?? 0) + 1);
    this.cancelLinger?.();
    this.cancelLinger = null;
    if (this.currentState === 'open') {
      // A session watch on a task-only socket: `subscribe` alone would end
      // the task delivery, so the socket widens to `subscribe_all` first.
      if (frame.t === 'subscribe' && this.connection?.tasksOnly && this.taskListeners.size > 0) {
        this.send({ t: 'subscribe_all' });
      }
      // Sent on every call, not only the first: the ack is what tells this
      // caller to catch up, and the gateway answers a repeat as readily.
      this.send(frame);
      return;
    }
    if (
      this.currentState === 'superseded' ||
      this.currentState === 'unavailable' ||
      this.currentState === 'unauthorized'
    ) {
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
      if (this.hasDemand() && this.currentState !== 'unauthorized') this.setState('paused');
      return;
    }
    // Foreground clears `superseded` too: the reader is back, this is the
    // device's newest socket again. Not `unauthorized`: coming back does not
    // re-pair the device, and the refusal would only be asked for again.
    this.attempts = 0;
    if (this.currentState === 'unauthorized') return;
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
    const connection: Connection = {
      transport,
      codec,
      hello: false,
      heardSincePing: true,
      tasksOnly: false,
    };
    this.connection = connection;
    this.setState('connecting');

    const current = () => this.connection === connection;
    transport.onmessage = (event) => {
      if (current()) this.receive(connection, event);
    };
    transport.onerror = (error) => {
      if (current()) this.lost(connection, { message: error });
    };
    transport.onclose = (event) => {
      if (current()) this.lost(connection, { closeCode: event.code, message: event.reason });
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
      this.options.onHello?.(frame);
      this.attempts = 0;
      this.failures = 0;
      this.refusalRetried = false;
      this.authChecked = false;
      this.cancelTimer?.();
      this.cancelTimer = null;
      this.setState('open');
      if (this.taskOnly()) {
        this.send({ t: 'subscribe_tasks' });
      } else {
        if (this.wanted.has(ALL) || this.wanted.has(TASKS)) this.send({ t: 'subscribe_all' });
        for (const key of this.wanted.keys()) {
          if (key !== ALL && key !== TASKS) this.send({ t: 'subscribe', asid: key });
        }
      }
      this.armPing(connection);
      return;
    }
    if (!frame) return;
    switch (frame.t) {
      case 'subscribed':
        if ('asid' in frame) {
          this.notify([frame.asid], (l) => l.onSubscribed?.());
          return;
        }
        if ('all' in frame) this.notify([ALL], (l) => l.onSubscribed?.());
        for (const l of [...this.taskListeners.keys()]) l.onSubscribed?.();
        return;
      case 'event':
        if (frame.event) {
          const domainEvent = frame.event;
          this.notify(this.targets(frame.asid), (l) => l.onEvent?.(domainEvent));
        }
        return;
      case 'task':
        for (const l of [...this.taskListeners.keys()]) l.onTaskUpdated?.(frame.task, frame.seq);
        return;
      case 'resync':
        // Only task events lagged: the session timelines are intact.
        if (!frame.tasks) this.notify(this.targets(frame.asid), (l) => l.onResync?.());
        // Events were dropped; a task may have changed in them.
        if (!frame.asid) for (const l of [...this.taskListeners.keys()]) l.onResync?.();
        return;
      case 'defaults':
        for (const l of [...this.taskListeners.keys()]) l.onDefaults?.(frame.defaultCwd);
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
    for (const listener of [...this.taskListeners.keys()]) call(listener);
  }

  private send(frame: AgentSocketClientFrame): void {
    const connection = this.connection;
    if (!connection?.hello) return;
    if (frame.t === 'subscribe_tasks') connection.tasksOnly = true;
    else if (frame.t === 'subscribe' || frame.t === 'subscribe_all') connection.tasksOnly = false;
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
  private lost(connection: Connection, failure: SocketFailure = {}): void {
    if (this.connection !== connection) return;
    const reachedHello = connection.hello;
    this.drop();
    if (!reachedHello) {
      if (socketFailureIsUnauthorized(failure)) {
        this.refused();
        return;
      }
      this.failures += 1;
      const failures = this.failures;
      this.allListeners((l) => l.onOpenFailed?.(failures));
      if (failures >= AUTH_CHECK_AFTER_FAILURES) this.checkAuthorization();
    }
    if (!this.hasDemand()) {
      this.setState('idle');
      return;
    }
    if (!this.active) {
      this.setState('paused');
      return;
    }
    const delay = socketReconnectDelay(this.attempts, this.options.random);
    this.attempts += 1;
    this.setState('backoff');
    this.cancelTimer = this.schedule(() => {
      this.cancelTimer = null;
      this.connect();
    }, delay);
  }

  /**
   * Ask, once per run of failures, whether the gateway still accepts this
   * device. The backoff keeps going meanwhile; only a definite refusal stops it,
   * and only if no attempt has reached `hello` since the question was asked.
   */
  private checkAuthorization(): void {
    const check = this.options.checkAuthorization;
    if (!check || this.checkingAuthorization || this.authChecked) return;
    this.checkingAuthorization = true;
    this.authChecked = true;
    void check()
      .catch((): SocketAuthorization => 'unknown')
      .then((answer) => {
        this.checkingAuthorization = false;
        // Only while still failing: a socket that reached `hello` meanwhile,
        // or that nothing wants any more, or that stood down for another
        // reason, is left as it is.
        if (answer !== 'unauthorized' || !this.hasDemand()) return;
        if (this.currentState !== 'backoff' && this.currentState !== 'connecting') return;
        this.refused();
      });
  }

  /** The gateway refused this device: stop, and say so. */
  private refused(): void {
    this.drop();
    this.attempts = 0;
    this.failures = 0;
    this.authChecked = false;
    this.setState('unauthorized');
    this.allListeners((l) => l.onUnavailable?.());
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
