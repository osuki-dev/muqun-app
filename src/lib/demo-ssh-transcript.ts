/**
 * The demo shell's transcript, byte by byte: what the fake shell writes back
 * for each byte the reader sends. Pure -- no timers, no i18n, no native -- so
 * it can be tested as a table and so `demo-ssh.ts`, which carries the
 * translated banner, is the only half a test cannot import.
 */
export const DEMO_SSH_HOST_ID = 'demo-ssh';

/** The key the demo "server" presents. Any fixed value will do; it never changes. */
export const DEMO_SSH_HOST_KEY = {
  algorithm: 'ssh-ed25519',
  fingerprint: 'SHA256:MuqunDemoHostKeyNotARealServer0000000000000',
  publicKey: 'AAAAC3NzaC1lZDI1NTE5AAAAIDemoDemoDemoDemoDemoDemoDemoDemoDemoDemoDemo',
};

export function isDemoSshHost(record: { id: string } | null | undefined): boolean {
  return record?.id === DEMO_SSH_HOST_ID;
}

export const DEMO_SSH_PROMPT = '\x1b[1;32mdemo@muqun\x1b[0m:\x1b[1;34m~\x1b[0m$ ';

/**
 * The transcript, keystroke by keystroke: what the demo shell writes back for
 * each byte the reader sends. Pure and separate from the timers so it can be
 * tested as a table.
 */
export class DemoShellTranscript {
  private line = '';

  /** Bytes in, text out, and whether the shell has exited. */
  feed(byte: number): { out: string; exited: boolean } {
    switch (byte) {
      case 0x0d: // enter
      case 0x0a: {
        const line = this.line;
        this.line = '';
        return { out: `\r\n${answer(line)}${DEMO_SSH_PROMPT}`, exited: false };
      }
      case 0x7f: // backspace
      case 0x08:
        if (this.line.length === 0) return { out: '', exited: false };
        this.line = this.line.slice(0, -1);
        return { out: '\b \b', exited: false };
      case 0x03: // ctrl+c
        this.line = '';
        return { out: `^C\r\n${DEMO_SSH_PROMPT}`, exited: false };
      case 0x04: // ctrl+d on an empty line ends the session, like a real shell
        if (this.line.length > 0) return { out: '', exited: false };
        return { out: '\r\nlogout\r\n', exited: true };
      case 0x0c: // ctrl+l
        return { out: `\x1b[2J\x1b[H${DEMO_SSH_PROMPT}${this.line}`, exited: false };
      case 0x15: // ctrl+u
        {
          const erase = '\b \b'.repeat(this.line.length);
          this.line = '';
          return { out: erase, exited: false };
        }
      default:
        if (byte >= 0x20 && byte !== 0x7f) {
          const char = String.fromCharCode(byte);
          this.line += char;
          return { out: char, exited: false };
        }
        // Escape sequences (arrows) and other control bytes are swallowed.
        return { out: '', exited: false };
    }
  }
}

function answer(line: string): string {
  const trimmed = line.trim();
  if (trimmed === '') return '';
  if (trimmed === 'ls') return 'README.md  muqun/  notes.txt\r\n';
  if (trimmed === 'pwd') return '/home/demo\r\n';
  if (trimmed === 'clear') return '\x1b[2J\x1b[H';
  return `you said: ${trimmed}\r\n`;
}
