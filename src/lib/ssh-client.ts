/**
 * The one door to `@osuki-dev/react-native-ssh`.
 *
 * Every native SSH call the app makes goes through here, for two reasons that
 * are the same reason `agent-widget.ts` loads its bridge lazily:
 *
 *  - **Tests.** `bun test` cannot load a Nitro module, and the screens that
 *    connect are never imported by a test -- but the modules *beside* them
 *    are. Keeping the import inside a function means a pure module can take a
 *    type from this file without the test runner ever touching native code.
 *  - **Demo mode and OTA.** The offline demo plays a canned shell and must
 *    not call native at all, and an over-the-air update can reach a binary
 *    that predates the module. A lazy `require` turns "the module is not in
 *    this build" into an error with a code the screen can show, rather than a
 *    crash at import time.
 *
 * The handles below are the app's own shape of a connection and a shell --
 * narrower than the library's, so the demo's fake can implement them without
 * pretending to be a hybrid object.
 */
import type {
  GenerateKeyPairOptions,
  SshConnectOptions,
  SshErrorCode,
  SshHostKey,
  SshKeyboardInteractiveChallenge,
  SshKeyInfo,
  SshKeyPair,
} from '@osuki-dev/react-native-ssh';

import type { SshCredential, SshTrustedHostKey } from '@/lib/ssh-hosts';

export type { SshHostKey, SshKeyboardInteractiveChallenge, SshKeyInfo, SshKeyPair };

export interface SshShellHandle {
  /** Bytes or text for the remote side. Synchronous; never blocks. */
  write(data: string | Uint8Array): void;
  resize(cols: number, rows: number): void;
  close(): Promise<void>;
}

export interface SshShellEventsHandle {
  onData: (data: ArrayBuffer | Uint8Array) => void;
  onClosed?: (exitCode: number | undefined) => void;
}

/**
 * A loopback port forward opened over the session (`direct-tcpip`): a listener
 * on `127.0.0.1:<localPort>` on the phone tunnelled to `remoteHost:remotePort`
 * as seen from the server. Point an HTTP client at
 * `http://127.0.0.1:<localPort>`; the library closes it when the connection
 * drops. See `ssh-tunnel.ts` and `docs/ssh-gateway-tunnel.md`.
 */
export interface SshForwardHandle {
  readonly localPort: number;
  close(): Promise<void>;
}

export interface SshSessionHandle {
  readonly hostKey: SshTrustedHostKey;
  readonly isConnected: boolean;
  openShell(
    options: { cols: number; rows: number; term?: string },
    events: SshShellEventsHandle
  ): Promise<SshShellHandle>;
  forwardLocal(
    options: { remoteHost: string; remotePort: number; maxConnections?: number },
    events: { onClosed?: (reason: string) => void }
  ): Promise<SshForwardHandle>;
  disconnect(): Promise<void>;
}

/**
 * The subset of the library's connection this facade calls into for a forward.
 * Declared locally and cast onto the native connection so a build that predates
 * local port forwarding still type-checks -- calling it there simply rejects,
 * the same way any other unavailable native capability does.
 */
interface NativeForwardCapable {
  forwardLocal(
    options: {
      bindAddress?: string;
      localPort?: number;
      remoteHost: string;
      remotePort: number;
      maxConnections?: number;
    },
    events: { onClosed?: (reason: string) => void }
  ): Promise<{ readonly localPort: number; close(): Promise<void> }>;
}

export interface SshConnectRequest {
  host: string;
  port: number;
  username: string;
  credential: SshCredential;
  verifyHostKey: (key: SshTrustedHostKey) => Promise<boolean> | boolean;
  onKeyboardInteractive?: (
    challenge: SshKeyboardInteractiveChallenge
  ) => Promise<string[] | undefined> | string[] | undefined;
  onDisconnected?: (reason: string) => void;
  /**
   * Aborts the attempt: the promise rejects with `CANCELLED`, whichever
   * step it was at -- the TCP connect, the handshake, or waiting on
   * `verifyHostKey` or `onKeyboardInteractive` for the reader.
   */
  signal?: AbortSignal;
  connectTimeoutMs?: number;
  /**
   * Restrict which host key types the server may present. Passed as the
   * pinned key's algorithm once a host has one, so a server that holds
   * several keys presents the same one it did last time rather than a
   * different-but-valid one that would read as a mismatch.
   */
  hostKeyAlgorithms?: string[];
}

/**
 * The library's codes, plus the two this app can produce on its own:
 * `UNAVAILABLE` for a binary without the module, `UNKNOWN` for anything that
 * did not come from the library at all.
 */
export type SshFailureCode = SshErrorCode | 'UNAVAILABLE' | 'UNKNOWN';

export interface SshFailure {
  code: SshFailureCode;
  message: string;
}

/**
 * Raised when the native module is not in this binary. Named the same way the
 * library names its own so `describeSshFailure` reads both alike.
 */
export class SshUnavailableError extends Error {
  override readonly name = 'SshError';
  readonly code = 'UNAVAILABLE' as const;

  constructor() {
    super('The SSH module is not part of this build.');
  }
}

type NativeSsh = typeof import('@osuki-dev/react-native-ssh');

let nativeModule: NativeSsh | null | undefined;

function native(): NativeSsh {
  if (nativeModule === undefined) {
    try {
      // oxlint-disable-next-line typescript/no-require-imports
      nativeModule = require('@osuki-dev/react-native-ssh') as NativeSsh;
    } catch {
      nativeModule = null;
    }
  }
  if (nativeModule === null) throw new SshUnavailableError();
  return nativeModule;
}

/**
 * What went wrong, in a shape a toast can show. Duck-typed on the error's
 * `name` and `code` rather than `instanceof`, so it never has to load the
 * module to describe a failure -- including the failure to load the module.
 */
export function describeSshFailure(error: unknown): SshFailure {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    if (error.name === 'SshError' && typeof code === 'string') {
      return { code: code as SshFailureCode, message: error.message };
    }
    return { code: 'UNKNOWN', message: error.message };
  }
  return { code: 'UNKNOWN', message: String(error) };
}

export function isSshFailure(error: unknown, code: SshFailureCode): boolean {
  return describeSshFailure(error).code === code;
}

function toLibraryAuth(credential: SshCredential): SshConnectOptions['auth'] {
  if (credential.type === 'keyboardInteractive') return { type: 'keyboardInteractive' };
  if (credential.type === 'password') return { type: 'password', password: credential.password };
  return credential.passphrase
    ? { type: 'privateKey', privateKey: credential.privateKey, passphrase: credential.passphrase }
    : { type: 'privateKey', privateKey: credential.privateKey };
}

/** Open and authenticate a connection. Rejects with a typed `SshError`. */
export async function connectSsh(request: SshConnectRequest): Promise<SshSessionHandle> {
  const { connect } = native();
  const connection = await connect({
    host: request.host,
    port: request.port,
    username: request.username,
    auth: toLibraryAuth(request.credential),
    verifyHostKey: (key) =>
      request.verifyHostKey({
        algorithm: key.algorithm,
        fingerprint: key.fingerprint,
        publicKey: key.publicKey,
      }),
    onKeyboardInteractive: request.onKeyboardInteractive,
    onDisconnected: request.onDisconnected,
    signal: request.signal,
    connectTimeoutMs: request.connectTimeoutMs,
    hostKeyAlgorithms: request.hostKeyAlgorithms,
  });

  return {
    get hostKey() {
      const key = connection.hostKey;
      return { algorithm: key.algorithm, fingerprint: key.fingerprint, publicKey: key.publicKey };
    },
    get isConnected() {
      return connection.isConnected;
    },
    async openShell(options, events) {
      const shell = await connection.openShell(
        { cols: options.cols, rows: options.rows, term: options.term },
        {
          onData: events.onData,
          onClosed: events.onClosed,
        }
      );
      return {
        write: (data) => shell.write(data),
        resize: (cols, rows) => shell.resize(cols, rows),
        close: () => shell.close(),
      };
    },
    async forwardLocal(options, events) {
      const forward = await (connection as unknown as NativeForwardCapable).forwardLocal(
        {
          bindAddress: '127.0.0.1',
          localPort: 0,
          remoteHost: options.remoteHost,
          remotePort: options.remotePort,
          maxConnections: options.maxConnections ?? 0,
        },
        { onClosed: events.onClosed }
      );
      return {
        get localPort() {
          return forward.localPort;
        },
        close: () => forward.close(),
      };
    },
    disconnect: () => connection.disconnect(),
  };
}

export function generateSshKeyPair(options: GenerateKeyPairOptions = {}): Promise<SshKeyPair> {
  return native().generateKeyPair(options);
}

/** Throws `SshError('KEY')` if the key cannot be parsed or the passphrase is wrong. */
export function inspectSshPrivateKey(privateKey: string, passphrase?: string): SshKeyInfo {
  return native().inspectPrivateKey(privateKey, passphrase || undefined);
}
