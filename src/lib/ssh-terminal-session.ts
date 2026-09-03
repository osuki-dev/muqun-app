/**
 * Shell bytes in, terminal frames out.
 *
 * One `TerminalEmulator` lives for the length of a connection and is fed the
 * stream as it arrives: decode the bytes, write the text, and hand
 * `SkiaTerminal` a frame -- at most once per animation frame, however many
 * chunks landed in it. Cursor movement, erase sequences, the alternate
 * screen and `ESC c` are therefore simply what the emulator does with them;
 * nothing here re-reads what was already drawn. (The first cut of this
 * screen kept a string and re-parsed all of it on every chunk, which was
 * right until a program painted a screen or cleared one.)
 *
 * The emulator's scrollback is the whole window `SkiaTerminal` draws:
 * `SSH_TERMINAL_SCROLLBACK` rows above the screen, and the oldest go when it
 * is full. There is no paging -- the gateway's "pull for earlier output" has
 * a server to ask; a shell's past is whatever the terminal kept.
 *
 * ## Decoding
 *
 * Bytes arrive at chunk boundaries that know nothing about UTF-8, so the
 * decoder is a streaming one and is *injected*: on a phone it is
 * `react-native-nitro-text-decoder`'s (Hermes has no `TextDecoder` global),
 * and under `bun test` it is Node's. Nothing native is imported here. An
 * escape sequence cut by the same boundary is the emulator's problem, and it
 * holds the cut half for the next write (`terminal-core.ts`).
 *
 * ## Publishing
 *
 * A chunk marks the session dirty and schedules one publish; every chunk
 * inside that frame rides along. `subscribe` gets the frame and a version,
 * and `frame` is the last one published. The scheduler is injected too, so a
 * test can drive it by hand.
 */
import type { TerminalTheme } from '@/terminal/palette';
import { TerminalEmulator, type TerminalModes } from '@/terminal/terminal-core';
import type { TerminalFrame } from '@/terminal/types';

export interface StreamingTextDecoder {
  decode(input: Uint8Array, options?: { stream?: boolean }): string;
}

/**
 * Rows kept above the screen. Enough for a long build log to be read back
 * through; bounded because every published frame lists every row, and the
 * canvas plans its picture blocks and scans for links over all of them --
 * linear in this number on every applied frame. Five thousand keeps that
 * under the gateway pane's own window (see `MAX_EMULATED_ROWS`, 2002) by a
 * factor the phone does not notice, while holding more than a screen-height
 * of typical output several hundred times over.
 */
export const SSH_TERMINAL_SCROLLBACK = 5000;

/** Runs `run` on the next animation frame; returns what cancels it. */
export type FrameScheduler = (run: () => void) => () => void;

/** The scheduler a phone uses: rAF where there is one, a 16 ms timer where not. */
export const animationFrameScheduler: FrameScheduler = (run) => {
  if (typeof requestAnimationFrame === 'function' && typeof cancelAnimationFrame === 'function') {
    const handle = requestAnimationFrame(run);
    return () => cancelAnimationFrame(handle);
  }
  const handle = setTimeout(run, 16);
  return () => clearTimeout(handle);
};

export type SshTerminalFrameListener = (frame: TerminalFrame, version: number) => void;

export interface SshTerminalSessionOptions {
  decoder: StreamingTextDecoder;
  columns: number;
  rows: number;
  theme?: TerminalTheme;
  /** @default SSH_TERMINAL_SCROLLBACK */
  scrollback?: number;
  /** @default animationFrameScheduler */
  schedule?: FrameScheduler;
}

export class SshTerminalSession {
  private readonly emulator: TerminalEmulator;
  private readonly decoder: StreamingTextDecoder;
  private readonly schedule: FrameScheduler;
  private readonly listeners = new Set<SshTerminalFrameListener>();
  private cancelScheduled: (() => void) | null = null;
  private dirty = false;
  private revision = 0;
  private published: TerminalFrame;

  constructor({
    decoder,
    columns,
    rows,
    theme,
    scrollback = SSH_TERMINAL_SCROLLBACK,
    schedule = animationFrameScheduler,
  }: SshTerminalSessionOptions) {
    this.decoder = decoder;
    this.schedule = schedule;
    // A PTY sends `\r\n` for a line end, so a bare `\n` is a line feed and
    // nothing more -- unlike the gateway's snapshots, which are line-oriented.
    this.emulator = new TerminalEmulator({ columns, rows, scrollback, theme, convertEol: false });
    this.published = this.emulator.frame();
  }

  get columns(): number {
    return this.emulator.columns;
  }

  get rows(): number {
    return this.emulator.rows;
  }

  /** The input-side modes the program has set -- live, read them when a key is sent. */
  get modes(): Readonly<TerminalModes> {
    return this.emulator.modes;
  }

  /** Bumped on every publish; 0 until the first. */
  get version(): number {
    return this.revision;
  }

  /** The frame as of the last publish. */
  get frame(): TerminalFrame {
    return this.published;
  }

  /** Whether output has arrived that no publish has shown yet. */
  get pending(): boolean {
    return this.dirty;
  }

  /** Raw bytes from the shell. */
  push(chunk: ArrayBuffer | Uint8Array): void {
    const view = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    if (view.byteLength === 0) return;
    this.write(this.decoder.decode(view, { stream: true }));
  }

  /**
   * Text that did not come off the wire -- a demo transcript, a line the app
   * writes into its own terminal. Bypasses the decoder so it cannot split a
   * multi-byte sequence the decoder is holding.
   */
  pushText(text: string): void {
    this.write(text);
  }

  /** A new grid. The emulator keeps its scrollback; the caller tells the PTY. */
  resize(columns: number, rows: number): void {
    if (columns === this.emulator.columns && rows === this.emulator.rows) return;
    this.emulator.resize(columns, rows);
    this.markDirty();
  }

  /** The palette from now on; see `TerminalEmulator.setTheme`. */
  setTheme(theme: TerminalTheme): void {
    this.emulator.setTheme(theme);
  }

  /**
   * Back to an empty screen, for a reconnect. Not published: the screen has
   * nothing to say until the next connection's first bytes, and the caller
   * decides what to show meanwhile. The grid size is kept.
   */
  reset(): void {
    this.cancel();
    // Flush whatever partial sequence the decoder was holding so it cannot
    // prefix the next connection's banner with half a glyph.
    this.decoder.decode(new Uint8Array(0), { stream: false });
    this.emulator.reset();
    this.dirty = false;
    this.published = this.emulator.frame();
  }

  /**
   * The stream has ended: a sequence the emulator was holding for a next
   * chunk is handled as it stands (`TerminalEmulator.flush`), and the last
   * frame goes out now rather than on the next animation frame.
   */
  end(): void {
    this.decoder.decode(new Uint8Array(0), { stream: false });
    this.emulator.flush();
    this.dirty = true;
    this.publish();
  }

  subscribe(listener: SshTerminalFrameListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Publishes now if anything is pending, without waiting for the frame. */
  publish(): void {
    this.cancel();
    if (!this.dirty) return;
    this.dirty = false;
    this.revision += 1;
    this.published = this.emulator.frame();
    for (const listener of this.listeners) listener(this.published, this.revision);
  }

  /** Nothing scheduled survives; the emulator's state does. */
  dispose(): void {
    this.cancel();
    this.listeners.clear();
  }

  private write(text: string): void {
    if (text === '') return;
    this.emulator.write(text);
    this.markDirty();
  }

  private markDirty(): void {
    this.dirty = true;
    if (this.cancelScheduled) return;
    this.cancelScheduled = this.schedule(() => {
      this.cancelScheduled = null;
      this.publish();
    });
  }

  private cancel(): void {
    if (!this.cancelScheduled) return;
    this.cancelScheduled();
    this.cancelScheduled = null;
  }
}
