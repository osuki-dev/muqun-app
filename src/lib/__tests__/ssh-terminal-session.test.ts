/**
 * The long-lived emulator between a shell's bytes and `SkiaTerminal`'s
 * frame. Node's `TextDecoder` stands in for the nitro one, and a hand-driven
 * scheduler stands in for the animation frame.
 */
import { describe, expect, test } from 'bun:test';

import {
  SSH_TERMINAL_SCROLLBACK,
  SshTerminalSession,
  animationFrameScheduler,
  type FrameScheduler,
} from '@/lib/ssh-terminal-session';
import { terminalFrameText } from '@/terminal/terminal-core';
import type { TerminalFrame } from '@/terminal/types';

/** A scheduler that runs nothing until `tick` is called; counts what was asked. */
function manualScheduler(): FrameScheduler & { tick(): void; scheduled: number; cancelled: number } {
  let queued: (() => void) | null = null;
  const schedule = ((run: () => void) => {
    schedule.scheduled += 1;
    queued = run;
    return () => {
      schedule.cancelled += 1;
      if (queued === run) queued = null;
    };
  }) as FrameScheduler & { tick(): void; scheduled: number; cancelled: number };
  schedule.scheduled = 0;
  schedule.cancelled = 0;
  schedule.tick = () => {
    const run = queued;
    queued = null;
    run?.();
  };
  return schedule;
}

function session(options: { columns?: number; rows?: number; scrollback?: number } = {}) {
  const schedule = manualScheduler();
  const s = new SshTerminalSession({
    decoder: new TextDecoder(),
    columns: options.columns ?? 20,
    rows: options.rows ?? 4,
    scrollback: options.scrollback ?? 10,
    schedule,
  });
  const frames: TerminalFrame[] = [];
  const versions: number[] = [];
  s.subscribe((frame, version) => {
    frames.push(frame);
    versions.push(version);
  });
  return { s, schedule, frames, versions };
}

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function text(frame: TerminalFrame): string {
  return terminalFrameText(frame);
}

describe('SshTerminalSession', () => {
  test('starts at version 0 with an empty frame of the given size', () => {
    const { s } = session({ columns: 30, rows: 5 });
    expect(s.version).toBe(0);
    expect(s.columns).toBe(30);
    expect(s.rows).toBe(5);
    expect(s.frame.columns).toBe(30);
    expect(text(s.frame)).toBe('');
    expect(s.pending).toBe(false);
  });

  test('a chunk is published on the next frame, once, whatever arrived meanwhile', () => {
    const { s, schedule, frames, versions } = session();
    s.push(bytes('Welcome\r\n'));
    s.push(bytes('$ '));
    expect(s.pending).toBe(true);
    expect(frames).toHaveLength(0);
    expect(schedule.scheduled).toBe(1);
    schedule.tick();
    expect(frames).toHaveLength(1);
    expect(versions).toEqual([1]);
    expect(text(frames[0])).toBe('Welcome\n$');
    expect(s.frame).toBe(frames[0]);
    expect(s.pending).toBe(false);
  });

  test('a frame with nothing new publishes nothing', () => {
    const { s, schedule, frames } = session();
    s.push(bytes('x'));
    schedule.tick();
    schedule.tick();
    expect(frames).toHaveLength(1);
    expect(s.version).toBe(1);
  });

  test('accepts an ArrayBuffer, which is what the native shell hands over', () => {
    const { s, schedule } = session();
    const view = bytes('hello');
    const buffer = new ArrayBuffer(view.byteLength);
    new Uint8Array(buffer).set(view);
    s.push(buffer);
    schedule.tick();
    expect(text(s.frame)).toBe('hello');
  });

  test('an empty chunk changes nothing', () => {
    const { s, schedule } = session();
    s.push(new Uint8Array(0));
    s.pushText('');
    expect(s.pending).toBe(false);
    expect(schedule.scheduled).toBe(0);
  });

  test('a multi-byte character split across chunks is one cell once whole', () => {
    const { s, schedule } = session();
    const encoded = bytes('日'); // e6 97 a5
    s.push(encoded.subarray(0, 1));
    s.push(encoded.subarray(1, 2));
    schedule.tick();
    expect(text(s.frame)).toBe('');
    s.push(encoded.subarray(2));
    schedule.tick();
    expect(text(s.frame)).toBe('日');
    expect(s.frame.lines[0].cells[0].width).toBe(2);
  });

  test('an escape sequence split across chunks styles the text that follows', () => {
    const { s, schedule } = session();
    s.push(bytes('a\x1b['));
    schedule.tick();
    s.push(bytes('31mred\x1b[0m'));
    schedule.tick();
    expect(text(s.frame)).toBe('ared');
    expect(s.frame.lines[0].cells[1].style.foreground).not.toBeNull();
    expect(s.frame.lines[0].cells[0].style.foreground).toBeNull();
  });

  test('a carriage return overwrites in place and a bare line feed only moves down', () => {
    const { s, schedule } = session();
    s.pushText('12345\rab\ncd');
    schedule.tick();
    expect(text(s.frame)).toBe('ab345\n  cd');
  });

  test('clear screen and home clear the screen and keep the scrollback', () => {
    const { s, schedule } = session({ rows: 3, scrollback: 10 });
    s.pushText('one\r\ntwo\r\nthree\r\nfour\r\n');
    s.pushText('\x1b[2J\x1b[Hfresh');
    schedule.tick();
    // 'one' and 'two' scrolled off into scrollback; the screen itself is
    // cleared, and home is the first row under them.
    expect(text(s.frame)).toBe('one\ntwo\nfresh');
    expect(s.frame.cursor).toMatchObject({ row: 2, column: 5 });
  });

  test('the alternate screen shows only itself and the main screen comes back', () => {
    const { s, schedule } = session({ rows: 3, scrollback: 10 });
    s.pushText('main\r\nprompt$ ');
    s.pushText('\x1b[?1049h\x1b[Heditor\r\n~');
    schedule.tick();
    expect(text(s.frame)).toBe('editor\n~');
    s.pushText('\x1b[?1049l');
    schedule.tick();
    expect(text(s.frame)).toBe('main\nprompt$');
  });

  test('RIS starts over rather than replaying what it cleared', () => {
    const { s, schedule } = session();
    s.pushText('old\r\nlines\r\n');
    schedule.tick();
    s.pushText('\x1bcnew');
    schedule.tick();
    expect(text(s.frame)).toBe('new');
  });

  test('scrollback is bounded and the oldest rows go first', () => {
    const { s, schedule } = session({ rows: 2, scrollback: 3 });
    s.pushText(['a', 'b', 'c', 'd', 'e', 'f', 'g'].join('\r\n'));
    schedule.tick();
    expect(text(s.frame)).toBe('c\nd\ne\nf\ng');
  });

  test('resize changes the grid, keeps the scrollback and publishes', () => {
    const { s, schedule, frames } = session({ columns: 10, rows: 3, scrollback: 10 });
    s.pushText('r0\r\nr1\r\nr2\r\nr3');
    schedule.tick();
    s.resize(6, 2);
    expect(s.pending).toBe(true);
    schedule.tick();
    expect(frames).toHaveLength(2);
    expect(s.columns).toBe(6);
    expect(s.rows).toBe(2);
    expect(text(s.frame)).toBe('r0\nr1\nr2\nr3');
    expect(s.frame.columns).toBe(6);
  });

  test('a resize to the same size is not a change', () => {
    const { s, schedule } = session({ columns: 10, rows: 3 });
    s.resize(10, 3);
    expect(s.pending).toBe(false);
    expect(schedule.scheduled).toBe(0);
  });

  test('modes follow the stream', () => {
    const { s, schedule } = session();
    expect(s.modes.applicationCursorKeys).toBe(false);
    s.push(bytes('\x1b[?1h\x1b[?2004h'));
    // Live: readable before the frame is published, which is when a key is sent.
    expect(s.modes.applicationCursorKeys).toBe(true);
    expect(s.modes.bracketedPaste).toBe(true);
    schedule.tick();
    s.push(bytes('\x1b[?1l'));
    expect(s.modes.applicationCursorKeys).toBe(false);
  });

  test('pushText bypasses the decoder', () => {
    const { s, schedule } = session();
    s.push(bytes('日').subarray(0, 1));
    s.pushText('[status]');
    schedule.tick();
    expect(text(s.frame)).toBe('[status]');
  });

  test('reset empties the screen, cancels a pending publish and flushes a partial character', () => {
    const { s, schedule, frames } = session();
    s.push(bytes('日').subarray(0, 2));
    s.pushText('x');
    s.reset();
    expect(schedule.cancelled).toBe(1);
    expect(s.pending).toBe(false);
    expect(text(s.frame)).toBe('');
    schedule.tick();
    expect(frames).toHaveLength(0);
    // The held bytes must not surface as garbage on the next connection.
    s.push(bytes('fresh'));
    schedule.tick();
    expect(text(s.frame)).toBe('fresh');
    expect(s.version).toBe(1);
  });

  test('reset keeps the grid size and the modes go back to normal', () => {
    const { s, schedule } = session({ columns: 33, rows: 7 });
    s.push(bytes('\x1b[?1h'));
    schedule.tick();
    s.reset();
    expect(s.columns).toBe(33);
    expect(s.rows).toBe(7);
    expect(s.modes.applicationCursorKeys).toBe(false);
  });

  test('end publishes at once and finishes a held sequence the way a single write would', () => {
    const { s, schedule, frames } = session();
    s.push(bytes('bye\x1b]0;partial'));
    expect(frames).toHaveLength(0);
    s.end();
    expect(frames).toHaveLength(1);
    expect(text(s.frame)).toBe('bye');
    expect(s.frame.title).toBe('partial');
    expect(schedule.cancelled).toBe(1);
  });

  test('publish drains a pending frame on demand', () => {
    const { s, schedule, frames } = session();
    s.pushText('now');
    s.publish();
    expect(frames).toHaveLength(1);
    expect(schedule.cancelled).toBe(1);
    schedule.tick();
    expect(frames).toHaveLength(1);
  });

  test('unsubscribe stops the listener and dispose stops the frame', () => {
    const { s, schedule, frames } = session();
    const seen: number[] = [];
    const off = s.subscribe((_frame, version) => seen.push(version));
    s.pushText('a');
    schedule.tick();
    off();
    s.pushText('b');
    schedule.tick();
    expect(seen).toEqual([1]);
    expect(frames).toHaveLength(2);
    s.pushText('c');
    s.dispose();
    schedule.tick();
    expect(frames).toHaveLength(2);
  });

  test('every published frame is a new object, so identity is the version', () => {
    const { s, schedule, frames } = session();
    s.pushText('a');
    schedule.tick();
    s.pushText('b');
    schedule.tick();
    expect(frames[0]).not.toBe(frames[1]);
  });

  test('the default scrollback is five thousand rows', () => {
    expect(SSH_TERMINAL_SCROLLBACK).toBe(5000);
    const s = new SshTerminalSession({ decoder: new TextDecoder(), columns: 4, rows: 2, schedule: manualScheduler() });
    // One more row than the window holds: the first one is gone.
    s.pushText(Array.from({ length: 5003 }, (_, index) => `${index}`).join('\r\n'));
    s.publish();
    expect(s.frame.lines).toHaveLength(5002);
    expect(text(s.frame).startsWith('1\n2\n')).toBe(true);
  });

  test('the animation-frame scheduler falls back to a timer and can be cancelled', async () => {
    let ran = false;
    const cancel = animationFrameScheduler(() => {
      ran = true;
    });
    cancel();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(ran).toBe(false);
    await new Promise<void>((resolve) => {
      animationFrameScheduler(resolve);
    });
  });
});

describe('SshTerminalSession has no reply channel', () => {
  // A shell can ask its terminal questions -- who are you, where is the
  // cursor, what is the window size, what is on the clipboard -- and a
  // terminal that answers gives a hostile server a way to put bytes into
  // the shell's input. This session is one-way: bytes in through `push`,
  // frames out through `subscribe`, and nothing that could carry a byte
  // back. The screen holds the shell handle; the session never sees it.
  const queries = [
    '\x1b[c',
    '\x1b[>c',
    '\x1b[5n',
    '\x1b[6n',
    '\x1b[?6n',
    '\x1bP$qm\x1b\\',
    '\x1bP+q544e\x1b\\',
    '\x1b[14t',
    '\x1b[18t',
    '\x1b]52;c;?\x07',
    '\x1bZ',
  ];

  test('feeding every query produces a frame of the surrounding text and nothing else', () => {
    const { s, schedule, frames } = session({ columns: 40 });
    for (const query of queries) s.push(bytes(`a${query}b`));
    schedule.tick();
    expect(frames).toHaveLength(1);
    expect(text(frames[0])).toBe('ab'.repeat(queries.length));
  });

  test('the session exposes no way to send bytes', () => {
    // Its whole surface: bytes and text in, a grid size, a theme, frames out.
    // No method name and no field reads like a channel to the far side, and
    // the options take no handle for one. A change here is a policy change.
    const suspect = /reply|respond|answer|send|output|shell|writer/iu;
    const names = Object.getOwnPropertyNames(SshTerminalSession.prototype);
    expect(names.filter((name) => suspect.test(name))).toEqual([]);
    const { s } = session();
    expect(Object.keys(s).filter((key) => suspect.test(key))).toEqual([]);
  });
});
