import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';

import type { SshSessionHandle, SshShellEventsHandle, SshShellHandle } from '@/lib/ssh-client';
import {
  DEMO_SSH_HOST_ID,
  DEMO_SSH_HOST_KEY,
  DEMO_SSH_PROMPT,
  DemoShellTranscript,
  isDemoSshHost,
} from '@/lib/demo-ssh-transcript';
import { sshCancelledError, waitUnlessAborted } from '@/lib/ssh-cancel';
import { encodeTerminalText } from '@/lib/ssh-key-bytes';
import type { SshHostRecord } from '@/lib/ssh-hosts';

/**
 * The SSH screen's half of the offline demo.
 *
 * The whole end-to-end gate runs with no network, and an App Store reviewer
 * has no server to log in to, so the host list carries one host -- while the
 * demo is on, and whenever the list would otherwise be empty -- that
 * "connects" to a shell played from here: a banner, a prompt, and a
 * line-echo that answers `you said: <line>` the way the library's own test
 * server does. Nothing native is called -- this file implements the same
 * handles the facade returns, and the screen cannot tell the two apart.
 *
 * The label is resolved on read through `i18n._(msg...)`, for the reason
 * `demo-gateway.ts` gives at length: a module-scope `t` would freeze the
 * language the module was imported in.
 */
export { DEMO_SSH_HOST_ID, DEMO_SSH_HOST_KEY, isDemoSshHost };

export function demoSshHost(): SshHostRecord {
  return {
    id: DEMO_SSH_HOST_ID,
    label: i18n._(msg`Demo shell`),
    host: 'demo.invalid',
    port: 22,
    username: 'demo',
    auth: { type: 'password' },
    // Already trusted, so the demo connects without a fingerprint prompt: the
    // prompt is worth seeing once, against a real server, not every time the
    // reviewer opens the demo.
    trustedHostKey: DEMO_SSH_HOST_KEY,
    createdAt: 0,
  };
}

/** Lines the fake shell prints when it opens. `\r\n`, as a PTY would. */
function banner(): string {
  return [
    `\x1b[1mMuqun demo shell\x1b[0m`,
    '',
    i18n._(msg`This is a bundled transcript, not a real server.`),
    i18n._(msg`Type a line and press Enter; it is echoed back.`),
    '',
    '',
  ].join('\r\n');
}

/** UTF-8 text as the bytes the fake shell "receives". */
function toBytes(data: string | Uint8Array): Uint8Array {
  return typeof data === 'string' ? encodeTerminalText(data) : data;
}

const CONNECT_DELAY_MS = 450;
const BANNER_DELAY_MS = 120;

/**
 * A connection that is not one. Resolves after a beat, so the screen's
 * "connecting" state is seen, and then behaves like the real handle.
 */
export function connectDemoSsh(options: {
  verifyHostKey: (key: typeof DEMO_SSH_HOST_KEY) => Promise<boolean> | boolean;
  onDisconnected?: (reason: string) => void;
  /** Aborts the attempt with `CANCELLED`, as the library's `connect` does. */
  signal?: AbortSignal;
}): Promise<SshSessionHandle> {
  const { signal } = options;
  return waitUnlessAborted(CONNECT_DELAY_MS, signal)
    .then(() => options.verifyHostKey(DEMO_SSH_HOST_KEY))
    .then((trusted) => {
      // A Cancel on the host-key dialog aborts the attempt as well as
      // declining the key; the library reports that as the cancel it was.
      if (signal?.aborted) throw sshCancelledError();
      if (!trusted) throw demoSshError('HOST_KEY_REJECTED', 'host key rejected');
      let connected = true;
      const shells = new Set<DemoShell>();
      return {
        hostKey: DEMO_SSH_HOST_KEY,
        get isConnected() {
          return connected;
        },
        async openShell(_options, events) {
          const shell = new DemoShell(events, () => shells.delete(shell));
          shells.add(shell);
          shell.start();
          return shell;
        },
        async disconnect() {
          connected = false;
          for (const shell of [...shells]) await shell.close();
        },
      };
    });
}

/** The shape `describeSshFailure` reads off the library's own errors. */
function demoSshError(code: string, message: string): Error {
  const error = new Error(`RNSSH_${code}: ${message}`);
  error.name = 'SshError';
  (error as { code?: string }).code = code;
  return error;
}

class DemoShell implements SshShellHandle {
  private readonly transcript = new DemoShellTranscript();
  private open = true;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly events: SshShellEventsHandle,
    private readonly onGone: () => void
  ) {}

  start(): void {
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.open) return;
      this.events.onData(encodeTerminalText(banner() + DEMO_SSH_PROMPT));
    }, BANNER_DELAY_MS);
  }

  write(data: string | Uint8Array): void {
    if (!this.open) return;
    let out = '';
    let exited = false;
    for (const byte of toBytes(data)) {
      const step = this.transcript.feed(byte);
      out += step.out;
      if (step.exited) {
        exited = true;
        break;
      }
    }
    if (out) this.events.onData(encodeTerminalText(out));
    if (exited) void this.finish(0);
  }

  resize(): void {
    // The transcript has no grid to reflow.
  }

  async close(): Promise<void> {
    await this.finish(undefined);
  }

  private async finish(exitCode: number | undefined): Promise<void> {
    if (!this.open) return;
    this.open = false;
    if (this.timer) clearTimeout(this.timer);
    this.onGone();
    this.events.onClosed?.(exitCode);
  }
}
