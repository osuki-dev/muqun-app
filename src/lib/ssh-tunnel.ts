/**
 * The SSH tunnel manager, minus the phone.
 *
 * A gateway with `sshTunnel` set is not reached over the network; it is reached
 * through a local port forward opened over an SSH session to a host the reader
 * already saved. "SSH is the transport, the gateway is the brain": the forward
 * only changes *where* the bytes go (a loopback port), never *what* they are --
 * the token and the AES-GCM sealed transport ride it unchanged, so a gateway
 * that trusts nobody on its own loopback is reached without weakening a thing
 * (see `docs/ssh-gateway-tunnel.md`).
 *
 * This module is pure: it imports nothing native and nothing from `zustand`.
 * The SSH facade is injected, so the whole state machine -- ensuring one
 * connection per host, one forward per record, reference counting, idle
 * teardown, and transparent reconnect -- runs under `bun test` against a fake.
 * `stores/ssh-tunnels.ts` is the thin wrapper that injects the real
 * `ssh-client` facade and mirrors the emitted state into React.
 */

/** The gateway's own default port (`DEFAULT_PORT` in the gateway's `main.rs`). */
export const GATEWAY_DEFAULT_PORT = 23847;

/** The loopback base URL a forward's local port answers on. Never persisted. */
export function tunnelBaseUrl(localPort: number): string {
  return `http://127.0.0.1:${localPort}`;
}

/**
 * A local app on the same phone can reach `127.0.0.1:<port>` (see the threat
 * model). The forward never bypasses gateway auth, and this caps how many
 * tunnelled TCP connections anyone -- us or a hostile local app -- can pin
 * open at once. Small on purpose.
 */
export const MAX_TUNNEL_CONNECTIONS = 8;

/**
 * The address a *stored* record may be reached at directly, or null when it may
 * not be reached directly at all.
 *
 * One rule, in one place, because getting it wrong leaks the bearer token. A
 * tunnelled record's `url` is the gateway's address **as seen from the SSH
 * host**, and for the loopback-only gateway this feature exists for, that is
 * `http://127.0.0.1:23847`. Sent from the phone, that resolves to *the phone's
 * own* loopback -- where, as T1 of `docs/ssh-gateway-tunnel.md` says plainly,
 * any other app on the device may be listening. So a tunnelled record has no
 * direct address: callers either go through its live forward or treat it as
 * unreachable. Never the stored URL.
 *
 * Deliberately shaped to take anything with the two fields, so a caller holding
 * a `Pick<GatewayRecord, …>` (the reachability probe) is held to the same rule
 * as one holding the whole record.
 */
export function directGatewayBaseUrl(
  record: { url: string; sshTunnel?: unknown } | null | undefined
): string | null {
  if (!record || record.sshTunnel) return null;
  return record.url.replace(/\/$/, '');
}

/**
 * A request was made against a tunnelled record whose forward could not be
 * opened -- or was made in a context that has no tunnel manager at all.
 *
 * It is a distinct type because the caller must never quietly fall back to the
 * record's stored `url`. That URL is the gateway's address *on the SSH host*,
 * and for the common loopback-only gateway it is `http://127.0.0.1:23847` --
 * which, sent from the phone, resolves to *the phone's own* loopback, where the
 * threat model says a hostile local app may be listening. A fallback would hand
 * that app the bearer token. Callers treat this the same way they treat an
 * unreachable gateway.
 */
export class GatewayTunnelUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GatewayTunnelUnavailableError';
  }
}

/** What a screen sees about a record's tunnel. */
export type TunnelPhase =
  /** No holder wants it; nothing is open. */
  | 'idle'
  /** Dialing the SSH host and/or opening the forward. */
  | 'connecting'
  /** The forward is up; `baseUrl` is live. */
  | 'open'
  /** It was wanted but the SSH connection or forward dropped/failed. */
  | 'down';

export interface TunnelState {
  phase: TunnelPhase;
  /** `http://127.0.0.1:<localPort>` while `open`, else null. */
  baseUrl: string | null;
  /** A sanitised, credential-free reason for `down`, for the status line. */
  reason?: string;
}

const IDLE_STATE: TunnelState = { phase: 'idle', baseUrl: null };

/** One open forward, as the injected facade hands it back. */
export interface TunnelForwardHandle {
  readonly localPort: number;
  close(): Promise<void>;
}

/** One live SSH connection, as the injected facade hands it back. */
export interface TunnelConnectionHandle {
  forwardLocal(
    options: { remoteHost: string; remotePort: number },
    events: { onClosed?: (reason: string) => void }
  ): Promise<TunnelForwardHandle>;
  disconnect(): Promise<void>;
}

/**
 * Everything the manager needs from the outside world, all injectable:
 *
 * - `openConnection(hostId)` dials the SSH host -- credential lookup, host-key
 *   trust (the same TOFU/mismatch rules as the terminal screen) and the
 *   handshake all live behind it, and its `onDropped` fires when the transport
 *   later drops from under an open forward.
 * - `describeFailure` turns whatever a connect/forward rejected with into a
 *   short, credential-free reason for the status line.
 */
export interface TunnelDeps {
  openConnection(
    hostId: string,
    events: { onDropped: (reason: string) => void }
  ): Promise<TunnelConnectionHandle>;
  describeFailure(error: unknown): string;
}

interface HostEntry {
  hostId: string;
  /** In-flight or resolved connection; null once it has dropped/closed. */
  connection: Promise<TunnelConnectionHandle> | null;
  handle: TunnelConnectionHandle | null;
  /** serverIds currently riding this host connection. */
  riders: Set<string>;
}

interface RecordEntry {
  serverId: string;
  hostId: string;
  remoteHost: string;
  remotePort: number;
  /** How many holders want this forward up. Zero means tear down. */
  refs: number;
  forward: TunnelForwardHandle | null;
  /** A monotonic id so a stale async open cannot install itself after a close. */
  generation: number;
  state: TunnelState;
}

export interface TunnelRecordInput {
  serverId: string;
  hostId: string;
  remoteHost: string;
  remotePort: number;
}

type Listener = (serverId: string, state: TunnelState) => void;

/**
 * Framework-free. Keys connections by `hostId` and forwards by `serverId`, so
 * two records tunnelling to different gateways over one host share the one SSH
 * connection but get two independent `direct-tcpip` forwards -- no cross-talk.
 */
export class SshTunnelManager {
  private readonly deps: TunnelDeps;
  private readonly hosts = new Map<string, HostEntry>();
  private readonly records = new Map<string, RecordEntry>();
  private readonly listeners = new Set<Listener>();
  private backgroundedIdle = false;

  constructor(deps: TunnelDeps) {
    this.deps = deps;
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  state(serverId: string): TunnelState {
    return this.records.get(serverId)?.state ?? IDLE_STATE;
  }

  baseUrl(serverId: string): string | null {
    return this.records.get(serverId)?.state.baseUrl ?? null;
  }

  /**
   * A screen (or the request layer) wants this record's forward up. Reference
   * counted: the matching {@link release} tears it down when the last holder
   * lets go. Idempotent and safe to call repeatedly.
   */
  hold(record: TunnelRecordInput): void {
    const entry = this.ensureRecord(record);
    entry.refs += 1;
    if (this.backgroundedIdle) return;
    void this.ensureForward(entry);
  }

  /** A holder let go. Tears the forward (and its host connection, if last) down at zero. */
  release(serverId: string): void {
    const entry = this.records.get(serverId);
    if (!entry) return;
    entry.refs = Math.max(0, entry.refs - 1);
    if (entry.refs === 0) this.teardownRecord(entry, 'idle');
  }

  /** A manual "reconnect" after a `down`. */
  retry(serverId: string): void {
    const entry = this.records.get(serverId);
    if (!entry || entry.refs === 0) return;
    void this.ensureForward(entry);
  }

  /**
   * The app went to background (or came back). If it is backgrounded *and* the
   * gateway session is idle, forwards close to shrink the window the loopback
   * port exists in; coming back re-opens whatever is still held.
   */
  setBackgroundedIdle(backgroundedIdle: boolean): void {
    if (this.backgroundedIdle === backgroundedIdle) return;
    this.backgroundedIdle = backgroundedIdle;
    if (backgroundedIdle) {
      for (const entry of this.records.values()) {
        if (entry.forward || entry.state.phase !== 'idle') this.teardownRecord(entry, 'idle', true);
      }
    } else {
      for (const entry of this.records.values()) {
        if (entry.refs > 0) void this.ensureForward(entry);
      }
    }
  }

  private ensureRecord(record: TunnelRecordInput): RecordEntry {
    const existing = this.records.get(record.serverId);
    if (existing) {
      existing.hostId = record.hostId;
      existing.remoteHost = record.remoteHost;
      existing.remotePort = record.remotePort;
      return existing;
    }
    const entry: RecordEntry = {
      serverId: record.serverId,
      hostId: record.hostId,
      remoteHost: record.remoteHost,
      remotePort: record.remotePort,
      refs: 0,
      forward: null,
      generation: 0,
      state: IDLE_STATE,
    };
    this.records.set(record.serverId, entry);
    return entry;
  }

  private setState(entry: RecordEntry, state: TunnelState): void {
    entry.state = state;
    for (const listener of this.listeners) listener(entry.serverId, state);
  }

  private hostEntry(hostId: string): HostEntry {
    let host = this.hosts.get(hostId);
    if (!host) {
      host = { hostId, connection: null, handle: null, riders: new Set() };
      this.hosts.set(hostId, host);
    }
    return host;
  }

  private async ensureForward(entry: RecordEntry): Promise<void> {
    if (entry.forward || entry.refs === 0) return;
    if (entry.state.phase === 'connecting') return;
    const generation = ++entry.generation;
    this.setState(entry, { phase: 'connecting', baseUrl: null });
    const host = this.hostEntry(entry.hostId);
    host.riders.add(entry.serverId);
    try {
      const connection = await this.connectHost(host);
      // A close/release/reconnect that fired while we were dialing wins.
      if (entry.generation !== generation || entry.refs === 0) {
        this.pruneHostRider(host, entry.serverId);
        return;
      }
      const forward = await connection.forwardLocal(
        { remoteHost: entry.remoteHost, remotePort: entry.remotePort },
        { onClosed: (reason) => this.onForwardClosed(entry.serverId, generation, reason) }
      );
      if (entry.generation !== generation || entry.refs === 0) {
        void forward.close().catch(() => {});
        this.pruneHostRider(host, entry.serverId);
        return;
      }
      entry.forward = forward;
      this.setState(entry, { phase: 'open', baseUrl: tunnelBaseUrl(forward.localPort) });
    } catch (error) {
      if (entry.generation !== generation) return;
      this.pruneHostRider(host, entry.serverId);
      this.setState(entry, { phase: 'down', baseUrl: null, reason: this.deps.describeFailure(error) });
    }
  }

  private connectHost(host: HostEntry): Promise<TunnelConnectionHandle> {
    if (host.handle) return Promise.resolve(host.handle);
    if (host.connection) return host.connection;
    const pending = this.deps
      .openConnection(host.hostId, { onDropped: (reason) => this.onHostDropped(host.hostId, reason) })
      .then((handle) => {
        host.handle = handle;
        return handle;
      })
      .catch((error) => {
        // A failed dial must not wedge the next attempt behind a rejected promise.
        if (host.connection === pending) host.connection = null;
        throw error;
      });
    host.connection = pending;
    return pending;
  }

  private onForwardClosed(serverId: string, generation: number, reason: string): void {
    const entry = this.records.get(serverId);
    if (!entry || entry.generation !== generation) return;
    entry.forward = null;
    const host = this.hosts.get(entry.hostId);
    if (host) this.pruneHostRider(host, serverId);
    if (entry.refs > 0) {
      this.setState(entry, { phase: 'down', baseUrl: null, reason: this.deps.describeFailure(reason) });
    } else {
      this.setState(entry, IDLE_STATE);
    }
  }

  private onHostDropped(hostId: string, reason: string): void {
    const host = this.hosts.get(hostId);
    if (!host) return;
    host.handle = null;
    host.connection = null;
    const riders = [...host.riders];
    host.riders.clear();
    for (const serverId of riders) {
      const entry = this.records.get(serverId);
      if (!entry) continue;
      entry.forward = null;
      entry.generation += 1;
      if (entry.refs > 0) {
        this.setState(entry, { phase: 'down', baseUrl: null, reason: this.deps.describeFailure(reason) });
      } else {
        this.setState(entry, IDLE_STATE);
      }
    }
  }

  /** Drop one forward and, if it was the host's last rider, the host connection too. */
  private teardownRecord(entry: RecordEntry, phase: 'idle', keepRefs = false): void {
    entry.generation += 1;
    const forward = entry.forward;
    entry.forward = null;
    if (forward) void forward.close().catch(() => {});
    const host = this.hosts.get(entry.hostId);
    if (host) this.pruneHostRider(host, entry.serverId);
    this.setState(entry, IDLE_STATE);
    if (!keepRefs && entry.refs === 0) this.records.delete(entry.serverId);
    void phase;
  }

  private pruneHostRider(host: HostEntry, serverId: string): void {
    host.riders.delete(serverId);
    if (host.riders.size > 0) return;
    const handle = host.handle;
    const pending = host.connection;
    host.handle = null;
    host.connection = null;
    this.hosts.delete(host.hostId);
    if (handle) {
      void handle.disconnect().catch(() => {});
    } else if (pending) {
      void pending.then((h) => h.disconnect().catch(() => {})).catch(() => {});
    }
  }
}
