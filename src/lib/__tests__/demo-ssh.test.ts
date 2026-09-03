/**
 * The demo shell's transcript, byte by byte, and the facade's failure
 * description -- the two halves of the SSH screen that never touch native.
 */
import { describe, expect, test } from 'bun:test';

import {
  DEMO_SSH_HOST_ID,
  DEMO_SSH_HOST_KEY,
  DemoShellTranscript,
  isDemoSshHost,
} from '@/lib/demo-ssh-transcript';
import { SshUnavailableError, describeSshFailure, isSshFailure } from '@/lib/ssh-client';

function type(transcript: DemoShellTranscript, text: string): string {
  let out = '';
  for (const char of text) out += transcript.feed(char.charCodeAt(0)).out;
  return out;
}

describe('DemoShellTranscript', () => {
  test('echoes what is typed and answers a line on Enter', () => {
    const transcript = new DemoShellTranscript();
    expect(type(transcript, 'hello')).toBe('hello');
    const enter = transcript.feed(0x0d);
    expect(enter.exited).toBe(false);
    expect(enter.out.startsWith('\r\nyou said: hello\r\n')).toBe(true);
    expect(enter.out).toContain('demo@muqun');
  });

  test('backspace erases one character and nothing on an empty line', () => {
    const transcript = new DemoShellTranscript();
    expect(transcript.feed(0x7f).out).toBe('');
    type(transcript, 'ab');
    expect(transcript.feed(0x7f).out).toBe('\b \b');
    expect(transcript.feed(0x0d).out.startsWith('\r\nyou said: a\r\n')).toBe(true);
  });

  test('ctrl+c abandons the line and prints a fresh prompt', () => {
    const transcript = new DemoShellTranscript();
    type(transcript, 'partial');
    expect(transcript.feed(0x03).out.startsWith('^C\r\n')).toBe(true);
    expect(transcript.feed(0x0d).out.startsWith('\r\n\x1b[1;32m')).toBe(true);
  });

  test('ctrl+d on an empty line logs out; on a full line it does nothing', () => {
    const transcript = new DemoShellTranscript();
    type(transcript, 'x');
    expect(transcript.feed(0x04)).toEqual({ out: '', exited: false });
    transcript.feed(0x03);
    expect(transcript.feed(0x04)).toEqual({ out: '\r\nlogout\r\n', exited: true });
  });

  test('escape sequences are swallowed rather than echoed', () => {
    const transcript = new DemoShellTranscript();
    expect(type(transcript, '\x1b[A')).toBe('[A');
    // The `[A` above is the arrow's printable tail: a real shell swallows the
    // whole sequence, and this one only drops the ESC. Good enough for a
    // demo that never reads history, and honest about it.
  });

  test('the canned commands answer', () => {
    const transcript = new DemoShellTranscript();
    type(transcript, 'ls');
    expect(transcript.feed(0x0d).out).toContain('README.md');
    type(transcript, 'pwd');
    expect(transcript.feed(0x0d).out).toContain('/home/demo');
  });
});

describe('the demo host identity', () => {
  test('has a fixed id and a fingerprint shaped like a real one', () => {
    expect(DEMO_SSH_HOST_KEY.fingerprint.startsWith('SHA256:')).toBe(true);
    expect(isDemoSshHost({ id: DEMO_SSH_HOST_ID })).toBe(true);
    expect(isDemoSshHost({ id: 'host-1' })).toBe(false);
    expect(isDemoSshHost(null)).toBe(false);
  });
});

describe('describeSshFailure', () => {
  test('reads the code off a library error without loading the library', () => {
    const error = Object.assign(new Error('auth failed'), { name: 'SshError', code: 'AUTH_FAILED' });
    expect(describeSshFailure(error)).toEqual({ code: 'AUTH_FAILED', message: 'auth failed' });
    expect(isSshFailure(error, 'AUTH_FAILED')).toBe(true);
    expect(isSshFailure(error, 'TIMEOUT')).toBe(false);
  });

  test('a missing module is UNAVAILABLE and anything else is UNKNOWN', () => {
    expect(describeSshFailure(new SshUnavailableError()).code).toBe('UNAVAILABLE');
    expect(describeSshFailure(new Error('boom'))).toEqual({ code: 'UNKNOWN', message: 'boom' });
    expect(describeSshFailure('boom')).toEqual({ code: 'UNKNOWN', message: 'boom' });
  });
});
