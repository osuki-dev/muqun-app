/**
 * The terminal emulator: a byte stream in, a grid of styled cells out.
 *
 * ## What the stream is allowed to do
 *
 * Everything this module parses comes from the far side of a connection --
 * the gateway's rendered panes, or, on the SSH screen, a shell on a host
 * that may be hostile or compromised. The emulator therefore has *no reply
 * channel and no side effects*: it draws cells, moves the cursor, keeps a
 * title and marks hyperlinks, and nothing else. In particular:
 *
 *  - It never answers the stream. Device attributes (`CSI c`, `ESC Z`),
 *    status and cursor-position reports (`CSI n`), `DECRQSS`, `XTGETTCAP`,
 *    window and size reports (`CSI ... t`), colour and clipboard queries --
 *    all are consumed and produce no output anywhere. Nothing here holds a
 *    handle to the shell, so a reply is not a thing this module *can* send.
 *  - Of the OSC commands only 0 and 2 (title) and 8 (hyperlink) do anything.
 *    52 (clipboard, both directions), 7 (working directory), 9 and 777
 *    (notifications), 4/10/11 (palette) and everything else are swallowed.
 *  - A title is plain text: control characters are stripped and it is cut
 *    at `TERMINAL_TITLE_LIMIT`. A hyperlink is kept only when it is an
 *    `http(s)` URI no longer than `TERMINAL_LINK_LIMIT` with nothing but
 *    printable characters in it; a link is never opened by this module --
 *    `SkiaTerminal` opens one on a tap, and checks it again first.
 *  - DCS, APC and PM strings are consumed whole and ignored.
 *  - Every count and position a sequence carries is parsed as an unsigned
 *    decimal, capped at `CSI_PARAMETER_LIMIT`, and then clamped to the grid,
 *    so no parameter can address a cell outside it.
 *  - A string sequence (OSC, DCS, APC, PM) longer than
 *    `STRING_SEQUENCE_LIMIT` is abandoned where the cap is; what follows is
 *    ordinary input. A cell's text (a base plus its combining marks) is cut
 *    at `CELL_TEXT_LIMIT` marks. Scrollback is bounded by the constructor's
 *    `scrollback`, and the grid by `MAX_GRID_COLUMNS` × `EMULATED_ROW_CAP`.
 *
 * `__tests__/hostile-output.test.ts` pins each of these.
 */
import { TerminalGrid } from '@/terminal/grid';
import { DEFAULT_TERMINAL_THEME, type TerminalTheme } from '@/terminal/palette';
import { applySgrCodes, parseSgrValues } from '@/terminal/sgr';
import {
  cloneTerminalStyle,
  DEFAULT_TERMINAL_STYLE,
  type TerminalFrame,
  type TerminalLine,
  type TerminalLink,
  type TerminalLinkKind,
} from '@/terminal/types';
import {
  codePointWidth,
  displayWidth,
  graphemeWidth,
  isStandaloneCodeUnit,
  splitGraphemes,
} from '@/terminal/unicode';

type BufferState = {
  grid: TerminalGrid;
  /** Whether this buffer feeds scrollback (the main buffer does; the alt does not). */
  isMain: boolean;
  cursorX: number;
  cursorY: number;
  savedCursorX: number;
  savedCursorY: number;
  scrollTop: number;
  scrollBottom: number;
};

type TerminalOptions = {
  columns: number;
  rows: number;
  scrollback?: number;
  convertEol?: boolean;
  theme?: TerminalTheme;
};

/**
 * The terminal modes a program flips that change what the *input* side has to
 * send, rather than how the screen is drawn. Read by whoever encodes keys for
 * a PTY (`@/lib/ssh-key-bytes`); nothing in the renderer looks at them.
 */
export type TerminalModes = {
  /** DECCKM (`CSI ?1 h/l`): arrows and Home/End go out as `ESC O x`, not `ESC [ x`. */
  applicationCursorKeys: boolean;
  /** `CSI ?2004 h/l`: pasted text is to be wrapped in `CSI 200~` … `CSI 201~`. */
  bracketedPaste: boolean;
  /**
   * `CSI ?47 / ?1047 / ?1049 h/l`: the program has taken the alternate screen.
   * Not an input mode, but the same kind of fact -- what the far side is,
   * rather than how it is drawn -- and the one true answer to "does this
   * program own the screen", which a gateway pane can only guess from names.
   */
  alternateScreen: boolean;
};

const CSI_FINAL = /[@-~]/;

/**
 * The most an OSC, DCS, APC or PM string may run to before it is abandoned.
 * A real terminal swallows everything until BEL or ST arrives; a stream that
 * never sends one would otherwise hold every byte after it forever, and one
 * that sends a terminator only after a hundred megabytes would have the
 * emulator hold those. Past this the sequence is dropped -- not acted on --
 * and parsing resumes with what follows as ordinary input. The cap is on the
 * string wherever the chunk boundaries fall, so a stream cut anywhere still
 * parses as the uncut text does. The same limit bounds what `write` holds
 * for a next chunk of any unfinished sequence.
 */
const STRING_SEQUENCE_LIMIT = 64 * 1024;

/** A title longer than this is cut; xterm sets no limit, and nobody needs one. */
export const TERMINAL_TITLE_LIMIT = 256;

/** A hyperlink longer than this is not one. Browsers cope with more; a tap target does not need to. */
export const TERMINAL_LINK_LIMIT = 2048;

/**
 * The largest value a CSI parameter can carry; xterm's own ceiling is 65535.
 * Every use is clamped to the grid anyway; this keeps an absurd count from
 * being an absurd number of iterations on the way there.
 */
const CSI_PARAMETER_LIMIT = 65535;

/**
 * How many combining marks a cell keeps after its base character. A real
 * cluster -- a flag, a family emoji, a letter under a few diacritics -- is a
 * handful of code points; a stream that sends a million marks is filling one
 * cell's string, and the renderer would shape all of it on every frame.
 */
const CELL_TEXT_LIMIT = 32;

/** C0 and C1 controls and DEL: nothing a title or a link may carry. */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/gu;

export class TerminalEmulator {
  private columnsValue: number;
  private rowsValue: number;

  private readonly maxScrollback: number;
  private readonly convertEol: boolean;
  private theme: TerminalTheme;
  private main: BufferState;
  private alternate: BufferState;
  private active: BufferState;
  private style = cloneTerminalStyle(DEFAULT_TERMINAL_STYLE);
  private cursorVisible = true;
  private insertMode = false;
  private autoWrap = true;
  private pendingWrap = false;
  private title: string | null = null;
  private readonly modeState: TerminalModes = {
    applicationCursorKeys: false,
    bracketedPaste: false,
    alternateScreen: false,
  };
  /**
   * The tail of the last `write` that could not be acted on yet: an escape
   * sequence whose final byte, or string terminator, is in the next chunk, or
   * the high half of a surrogate pair. Prepended to the next write, so a
   * stream cut at any byte parses exactly as the uncut text does.
   */
  private pending = '';
  /**
   * Whether the last `write` ended inside a run of printable text. A grapheme
   * cluster can straddle a chunk boundary -- half a flag, an emoji before its
   * ZWJ partner or skin tone -- and the segmenter only sees the halves
   * together if the next chunk's first grapheme is offered to the cell the
   * previous chunk ended on (see `joinPrevious`).
   */
  private openRun = false;

  constructor(options: TerminalOptions) {
    this.columnsValue = clamp(options.columns, 2, MAX_GRID_COLUMNS);
    this.rowsValue = clamp(options.rows, 2, EMULATED_ROW_CAP);
    this.maxScrollback = Math.max(0, options.scrollback ?? 1000);
    this.convertEol = options.convertEol ?? false;
    this.theme = options.theme ?? DEFAULT_TERMINAL_THEME;
    this.main = this.createBuffer(true);
    this.alternate = this.createBuffer(false);
    this.active = this.main;
  }

  get columns(): number {
    return this.columnsValue;
  }

  get rows(): number {
    return this.rowsValue;
  }

  /** The input-side modes the program has set; see `TerminalModes`. Live, not a copy. */
  get modes(): Readonly<TerminalModes> {
    return this.modeState;
  }

  /**
   * The palette SGR colours resolve against from now on. Cells already written
   * keep the colours they were written with: the grid stores resolved strings,
   * not palette indices.
   */
  setTheme(theme: TerminalTheme): void {
    this.theme = theme;
  }

  reset(): void {
    this.main = this.createBuffer(true);
    this.alternate = this.createBuffer(false);
    this.active = this.main;
    this.style = cloneTerminalStyle(DEFAULT_TERMINAL_STYLE);
    this.cursorVisible = true;
    this.insertMode = false;
    this.autoWrap = true;
    this.pendingWrap = false;
    this.title = null;
    this.modeState.applicationCursorKeys = false;
    this.modeState.bracketedPaste = false;
    this.modeState.alternateScreen = false;
    this.pending = '';
    this.openRun = false;
  }

  /**
   * Feeds text. Safe to call with a stream cut anywhere: an incomplete escape
   * sequence (or half a surrogate pair) at the end is held and completed by
   * the next call, so the frame after N chunks is the frame after their
   * concatenation. `flush` is what ends a stream; nothing here assumes one.
   */
  write(input: string): void {
    const text = this.pending === '' ? input : this.pending + input;
    this.pending = '';
    const joinable = this.openRun;
    this.openRun = false;
    const length = text.length;
    let index = 0;
    while (index < length) {
      const code = text.charCodeAt(index);
      if (code === 0x1b) {
        const next = this.consumeEscape(text, index, false);
        if (next < 0) {
          this.hold(text.slice(index));
          return;
        }
        index = next;
        continue;
      }
      if (code < 0x20 || code === 0x7f) {
        this.handleControl(code);
        index += 1;
        continue;
      }
      let end = index + 1;
      while (end < length) {
        const next = text.charCodeAt(end);
        if (next === 0x1b || next < 0x20 || next === 0x7f) break;
        end += 1;
      }
      // A high surrogate on the very last code unit is half a code point whose
      // other half is in the next chunk. Written now it would be a lone
      // surrogate cell; held, the pair is written whole.
      const open = end === length;
      const held = open && isHighSurrogate(text.charCodeAt(end - 1));
      const run = text.slice(index, held ? end - 1 : end);
      const graphemes =
        (index === 0 && joinable ? this.joinPrevious(run) : null) ?? splitGraphemes(run);
      for (const grapheme of graphemes) this.putGrapheme(grapheme);
      if (held) {
        this.pending = text.slice(end - 1);
        this.openRun = true;
        return;
      }
      this.openRun = open;
      index = end;
    }
  }

  /**
   * Ends the stream: whatever `write` was holding for a next chunk that will
   * not come is handled the way a single `write` of the whole text always
   * handled its tail -- an unterminated OSC is acted on with what it has, an
   * unfinished CSI is dropped, a lone surrogate is written as it is. This is
   * exactly the pre-streaming behaviour, which is what keeps
   * `parseTerminalSnapshot` (one write, then this) byte-identical.
   */
  flush(): void {
    const rest = this.pending;
    if (rest === '') return;
    this.pending = '';
    if (rest.charCodeAt(0) === 0x1b) this.consumeEscape(rest, 0, true);
    else for (const grapheme of splitGraphemes(rest)) this.putGrapheme(grapheme);
  }

  /**
   * A new grid size, keeping the scrollback.
   *
   * No reflow: rows are cut or padded to the new width (a wide glyph cut in
   * half is blanked), never re-wrapped. Shrinking pushes rows off the top of
   * the screen into scrollback only as far as is needed to keep the cursor
   * row and the last row with content on screen -- so a prompt at the top of
   * an otherwise empty screen stays where it is -- and growing pulls rows back
   * out of scrollback to fill the new space, so a shrink followed by the same
   * grow is a round trip. The alternate screen has no scrollback and simply
   * loses rows off its top, which is what every full-screen program expects: it
   * repaints on SIGWINCH. Scroll margins are reset, as xterm resets them.
   */
  resize(columns: number, rows: number): void {
    const nextColumns = clamp(columns, 2, MAX_GRID_COLUMNS);
    const nextRows = clamp(rows, 2, EMULATED_ROW_CAP);
    if (nextColumns === this.columnsValue && nextRows === this.rowsValue) return;
    this.resizeBuffer(this.main, nextColumns, nextRows);
    this.resizeBuffer(this.alternate, nextColumns, nextRows);
    this.columnsValue = nextColumns;
    this.rowsValue = nextRows;
    this.pendingWrap = false;
    this.openRun = false;
  }

  frame(): TerminalFrame {
    const buffer = this.active;
    return buildTerminalFrame(
      buffer.grid,
      this.columns,
      buffer.cursorX,
      buffer.cursorY,
      this.cursorVisible,
      this.title
    );
  }

  /**
   * Screen rows changed since the last call, cleared on read.
   *
   * Not what the incremental recorder uses: `parseTerminalSnapshot` builds a new
   * emulator per refresh, so every row of a fresh grid is dirty and the set says
   * nothing about what changed between two snapshots. The recorder compares
   * `TerminalLine.signature`, which is derived from content and therefore
   * comparable across emulator instances. This stays for a caller that does hold
   * one emulator open across writes.
   */
  takeDirtyRows(): number[] {
    return this.active.grid.takeDirtyRows();
  }

  private createBuffer(isMain: boolean): BufferState {
    return {
      grid: new TerminalGrid(this.columns, this.rows, isMain ? this.maxScrollback : 0),
      isMain,
      cursorX: 0,
      cursorY: 0,
      savedCursorX: 0,
      savedCursorY: 0,
      scrollTop: 0,
      scrollBottom: this.rows - 1,
    };
  }

  private resizeBuffer(buffer: BufferState, columns: number, rows: number): void {
    const grid = buffer.grid;
    let shift: number;
    if (rows < this.rowsValue) {
      const needed = Math.max(buffer.cursorY, grid.lastScreenRowWithContent()) + 1;
      shift = Math.max(0, needed - rows);
    } else {
      shift = -Math.min(grid.scrollbackCount(), rows - this.rowsValue);
    }
    buffer.grid = grid.resized(columns, rows, shift);
    buffer.cursorY = clamp(buffer.cursorY - shift, 0, rows - 1);
    buffer.cursorX = clamp(buffer.cursorX, 0, columns - 1);
    buffer.savedCursorY = clamp(buffer.savedCursorY - shift, 0, rows - 1);
    buffer.savedCursorX = clamp(buffer.savedCursorX, 0, columns - 1);
    buffer.scrollTop = 0;
    buffer.scrollBottom = rows - 1;
  }

  /**
   * Keeps an unfinished sequence for the next write, within the limit. A
   * string sequence never reaches the limit here -- `consumeEscape` abandons
   * it at the cap -- so what can exceed it is a CSI whose final byte never
   * comes, and that is dropped as `flush` would drop it.
   */
  private hold(rest: string): void {
    this.pending = rest.length > STRING_SEQUENCE_LIMIT ? '' : rest;
  }

  /**
   * Handles the escape sequence at `start` and returns the index after it, or
   * -1 when the sequence is not complete in `input` -- unless `atEnd`, in
   * which case there is no more input coming and the sequence is dealt with
   * as it stands: an OSC acts on what it has, everything else is dropped.
   */
  private consumeEscape(input: string, start: number, atEnd: boolean): number {
    const introducer = input[start + 1];
    if (!introducer) return atEnd ? input.length : -1;
    if (introducer === '[') {
      let end = start + 2;
      while (end < input.length && !CSI_FINAL.test(input[end])) end += 1;
      if (end >= input.length) return atEnd ? input.length : -1;
      this.handleCsi(input.slice(start + 2, end), input[end]);
      return end + 1;
    }
    if (introducer === ']' || introducer === 'P' || introducer === '^' || introducer === '_') {
      const payloadStart = start + 2;
      const cap = payloadStart + STRING_SEQUENCE_LIMIT;
      let end = payloadStart;
      let terminatorLength = 0;
      while (end < input.length && end < cap) {
        if (input.charCodeAt(end) === 0x07) {
          terminatorLength = 1;
          break;
        }
        if (input.charCodeAt(end) === 0x1b && input[end + 1] === '\\') {
          terminatorLength = 2;
          break;
        }
        end += 1;
      }
      // Over the cap with no terminator in sight: the string is abandoned
      // here and whatever follows is ordinary input (see the module notes).
      if (terminatorLength === 0 && end >= cap) return cap;
      if (terminatorLength === 0 && !atEnd) return -1;
      if (introducer === ']') this.handleOsc(input.slice(payloadStart, end));
      return Math.min(input.length, end + terminatorLength);
    }
    if ('()#%*+-./'.includes(introducer)) {
      if (start + 2 >= input.length && !atEnd) return -1;
      return Math.min(input.length, start + 3);
    }
    this.handleEscape(introducer);
    return start + 2;
  }

  private handleControl(code: number): void {
    if (code === 0x08) {
      this.active.cursorX = Math.max(0, this.active.cursorX - 1);
      this.pendingWrap = false;
    } else if (code === 0x09) {
      this.active.cursorX = Math.min(
        this.columns - 1,
        (Math.floor(this.active.cursorX / 8) + 1) * 8
      );
      this.pendingWrap = false;
    } else if (code === 0x0a || code === 0x0b || code === 0x0c) {
      if (this.convertEol) this.active.cursorX = 0;
      this.lineFeed();
    } else if (code === 0x0d) {
      this.active.cursorX = 0;
      this.pendingWrap = false;
    }
  }

  private handleEscape(final: string): void {
    if (final === '7') this.saveCursor();
    else if (final === '8') this.restoreCursor();
    else if (final === 'D') this.lineFeed();
    else if (final === 'E') {
      this.active.cursorX = 0;
      this.lineFeed();
    } else if (final === 'M') this.reverseIndex();
    else if (final === 'c') this.reset();
  }

  /**
   * Only the title (0, 2) and hyperlinks (8) are acted on; every other OSC --
   * the clipboard (52), the working directory (7), notifications (9, 777),
   * palette queries (4, 10, 11), semantic prompts (133) and any number this
   * module has never heard of -- is swallowed without effect.
   */
  private handleOsc(value: string): void {
    const separator = value.indexOf(';');
    if (separator < 0) return;
    const command = value.slice(0, separator);
    if (command === '0' || command === '2') {
      this.title = sanitizeTerminalTitle(value.slice(separator + 1));
    } else if (command === '8') {
      const parametersAndUri = value.slice(separator + 1);
      const uriSeparator = parametersAndUri.indexOf(';');
      if (uriSeparator >= 0) {
        const uri = parametersAndUri.slice(uriSeparator + 1);
        this.style.link = isSupportedTerminalUri(uri) ? uri : null;
      }
    }
  }

  private handleCsi(raw: string, final: string): void {
    const privateMode = raw.startsWith('?');
    const prefixed = /^[?>=!]/.test(raw);
    const values = parseCsiParameters(raw);
    const first = values[0] || 1;
    const buffer = this.active;
    this.pendingWrap = false;

    if (final === 'A') buffer.cursorY = Math.max(buffer.scrollTop, buffer.cursorY - first);
    else if (final === 'B') buffer.cursorY = Math.min(buffer.scrollBottom, buffer.cursorY + first);
    else if (final === 'C' || final === 'a')
      buffer.cursorX = Math.min(this.columns - 1, buffer.cursorX + first);
    else if (final === 'D') buffer.cursorX = Math.max(0, buffer.cursorX - first);
    else if (final === 'E') {
      buffer.cursorY = Math.min(buffer.scrollBottom, buffer.cursorY + first);
      buffer.cursorX = 0;
    } else if (final === 'F') {
      buffer.cursorY = Math.max(buffer.scrollTop, buffer.cursorY - first);
      buffer.cursorX = 0;
    } else if (final === 'G' || final === '`')
      buffer.cursorX = clamp(first - 1, 0, this.columns - 1);
    else if (final === 'd') buffer.cursorY = clamp(first - 1, 0, this.rows - 1);
    else if (final === 'H' || final === 'f') {
      buffer.cursorY = clamp((values[0] || 1) - 1, 0, this.rows - 1);
      buffer.cursorX = clamp((values[1] || 1) - 1, 0, this.columns - 1);
    } else if (final === 'J') this.eraseDisplay(values[0] || 0);
    else if (final === 'K') this.eraseLine(values[0] || 0);
    else if (final === '@') this.insertCells(first);
    else if (final === 'P') this.deleteCells(first);
    else if (final === 'X') this.eraseCells(first);
    else if (final === 'L') this.insertLines(first);
    else if (final === 'M') this.deleteLines(first);
    else if (final === 'S') this.scrollUp(first);
    else if (final === 'T') this.scrollDown(first);
    else if (final === 'm') this.applySgr(parseSgrValues(raw));
    // `CSI s` / `CSI u` save and restore the cursor; with a private prefix
    // (`CSI ? u` is the kitty keyboard-protocol query) they are something
    // else, and something this emulator does not do.
    else if (final === 's' && !prefixed) this.saveCursor();
    else if (final === 'u' && !prefixed) this.restoreCursor();
    else if (final === 'r') this.setScrollRegion(values);
    else if (final === 'h' || final === 'l') this.setMode(values, privateMode, final === 'h');
  }

  private putGrapheme(cluster: string): void {
    // One cluster can be a base and any number of marks; past the limit the
    // rest are dropped, so a stream of them fills nothing (`CELL_TEXT_LIMIT`).
    const grapheme = cluster.length > CELL_TEXT_LIMIT ? truncateCluster(cluster) : cluster;
    const width = graphemeWidth(grapheme);
    if (width === 0) {
      const column = this.previousWritableColumn();
      if (column < 0) return;
      const row = this.active.cursorY;
      // A cell is a base plus its marks; past the limit the marks are dropped,
      // so a stream of them fills nothing (see `CELL_TEXT_LIMIT`).
      if (this.active.grid.textAt(row, column).length >= CELL_TEXT_LIMIT) return;
      this.active.grid.appendGrapheme(row, column, grapheme);
      return;
    }
    if (this.pendingWrap && this.autoWrap) {
      this.active.cursorX = 0;
      this.lineFeed();
    }
    const buffer = this.active;
    if (width === 2 && buffer.cursorX === this.columns - 1) {
      if (!this.autoWrap) return;
      buffer.cursorX = 0;
      this.lineFeed();
    }
    const row = buffer.cursorY;
    this.clearWideCell(row, buffer.cursorX);
    if (this.insertMode) this.insertCells(width);
    buffer.grid.putCell(row, buffer.cursorX, grapheme, width, this.style);
    if (width === 2 && buffer.cursorX + 1 < this.columns) {
      // A zero-width continuation cell so the wide glyph owns both columns.
      buffer.grid.putCell(row, buffer.cursorX + 1, '', 0, this.style);
    }
    const next = buffer.cursorX + width;
    if (next >= this.columns) {
      buffer.cursorX = this.columns - 1;
      this.pendingWrap = true;
    } else {
      buffer.cursorX = next;
    }
  }

  /**
   * Segments a chunk's opening run of text together with the cell the previous
   * chunk's text ended on, as one write would have seen them. If the first
   * cluster turns out to reach into the new text, it is put again from that
   * cell -- through `putGrapheme`, so its width is measured exactly as a single
   * write measures it -- and the graphemes still to put are returned. Null
   * means there was nothing to join and the run segments on its own. Not in
   * insert mode, where a re-put would insert cells.
   */
  private joinPrevious(run: string): string[] | null {
    if (this.insertMode || run === '') return null;
    const column = this.previousWritableColumn();
    if (column < 0) return null;
    const buffer = this.active;
    const previous = buffer.grid.textAt(buffer.cursorY, column);
    if (previous === '') return null;
    const graphemes = splitGraphemes(previous + run);
    if (graphemes[0].length <= previous.length) return null;
    buffer.cursorX = column;
    this.pendingWrap = false;
    this.putGrapheme(graphemes[0]);
    return graphemes.slice(1);
  }

  private previousWritableColumn(): number {
    const buffer = this.active;
    let column = this.pendingWrap ? this.columns - 1 : buffer.cursorX - 1;
    while (column >= 0 && buffer.grid.widthAt(buffer.cursorY, column) === 0) column -= 1;
    return column;
  }

  private clearWideCell(row: number, column: number): void {
    const grid = this.active.grid;
    const width = grid.widthAt(row, column);
    if (width === 0 && column > 0) grid.blankCell(row, column - 1, this.style);
    if (width === 2 && column + 1 < this.columns) grid.blankCell(row, column + 1, this.style);
  }

  private lineFeed(): void {
    this.pendingWrap = false;
    const buffer = this.active;
    if (buffer.cursorY === buffer.scrollBottom) this.scrollUp(1);
    else buffer.cursorY = Math.min(this.rows - 1, buffer.cursorY + 1);
  }

  private reverseIndex(): void {
    const buffer = this.active;
    if (buffer.cursorY === buffer.scrollTop) this.scrollDown(1);
    else buffer.cursorY = Math.max(0, buffer.cursorY - 1);
  }

  private scrollUp(amount: number): void {
    const buffer = this.active;
    // Rows leaving the top are kept in scrollback only when the main buffer
    // scrolls from row 0; a region scroll or the alt buffer just discards them.
    const retain = buffer.isMain && buffer.scrollTop === 0 && this.maxScrollback > 0;
    buffer.grid.scrollUp(amount, buffer.scrollTop, buffer.scrollBottom, retain, this.style);
  }

  private scrollDown(amount: number): void {
    const buffer = this.active;
    buffer.grid.scrollDown(amount, buffer.scrollTop, buffer.scrollBottom, this.style);
  }

  private eraseDisplay(mode: number): void {
    const buffer = this.active;
    const grid = buffer.grid;
    if (mode === 2 || mode === 3) {
      grid.clearScreen(this.style);
      if (mode === 3) grid.clearScrollback();
      return;
    }
    if (mode === 0) {
      this.eraseRange(buffer.cursorY, buffer.cursorX, this.columns - 1);
      for (let row = buffer.cursorY + 1; row < this.rows; row += 1)
        grid.blankScreenRow(row, this.style);
    } else if (mode === 1) {
      for (let row = 0; row < buffer.cursorY; row += 1) grid.blankScreenRow(row, this.style);
      this.eraseRange(buffer.cursorY, 0, buffer.cursorX);
    }
  }

  private eraseLine(mode: number): void {
    const buffer = this.active;
    if (mode === 0) this.eraseRange(buffer.cursorY, buffer.cursorX, this.columns - 1);
    else if (mode === 1) this.eraseRange(buffer.cursorY, 0, buffer.cursorX);
    else if (mode === 2) buffer.grid.blankScreenRow(buffer.cursorY, this.style);
  }

  private eraseCells(amount: number): void {
    const buffer = this.active;
    this.eraseRange(
      buffer.cursorY,
      buffer.cursorX,
      Math.min(this.columns - 1, buffer.cursorX + amount - 1)
    );
  }

  private eraseRange(row: number, start: number, end: number): void {
    const grid = this.active.grid;
    for (let column = start; column <= end; column += 1) {
      this.clearWideCell(row, column);
      grid.blankCell(row, column, this.style);
    }
  }

  private insertCells(amount: number): void {
    const buffer = this.active;
    const count = Math.min(Math.max(1, amount), this.columns - buffer.cursorX);
    buffer.grid.insertCells(buffer.cursorY, buffer.cursorX, count, this.style);
  }

  private deleteCells(amount: number): void {
    const buffer = this.active;
    const count = Math.min(Math.max(1, amount), this.columns - buffer.cursorX);
    buffer.grid.deleteCells(buffer.cursorY, buffer.cursorX, count, this.style);
  }

  private insertLines(amount: number): void {
    const buffer = this.active;
    if (buffer.cursorY < buffer.scrollTop || buffer.cursorY > buffer.scrollBottom) return;
    buffer.grid.scrollDown(amount, buffer.cursorY, buffer.scrollBottom, this.style);
  }

  private deleteLines(amount: number): void {
    const buffer = this.active;
    if (buffer.cursorY < buffer.scrollTop || buffer.cursorY > buffer.scrollBottom) return;
    buffer.grid.scrollUp(amount, buffer.cursorY, buffer.scrollBottom, false, this.style);
  }

  private setScrollRegion(values: number[]): void {
    const top = clamp((values[0] || 1) - 1, 0, this.rows - 1);
    const bottom = clamp((values[1] || this.rows) - 1, 0, this.rows - 1);
    if (top >= bottom) return;
    this.active.scrollTop = top;
    this.active.scrollBottom = bottom;
    this.active.cursorX = 0;
    this.active.cursorY = 0;
  }

  private setMode(values: number[], privateMode: boolean, enabled: boolean): void {
    for (const mode of values) {
      if (!privateMode && mode === 4) this.insertMode = enabled;
      else if (privateMode && mode === 1) this.modeState.applicationCursorKeys = enabled;
      else if (privateMode && mode === 7) this.autoWrap = enabled;
      else if (privateMode && mode === 25) this.cursorVisible = enabled;
      else if (privateMode && mode === 2004) this.modeState.bracketedPaste = enabled;
      else if (privateMode && (mode === 47 || mode === 1047 || mode === 1049)) {
        if (enabled) {
          if (mode === 1049) this.saveCursor();
          this.alternate = this.createBuffer(false);
          this.active = this.alternate;
        } else {
          this.active = this.main;
          if (mode === 1049) this.restoreCursor();
        }
        this.modeState.alternateScreen = enabled;
      } else if (privateMode && mode === 1048) {
        if (enabled) this.saveCursor();
        else this.restoreCursor();
      }
    }
  }

  private saveCursor(): void {
    this.active.savedCursorX = this.active.cursorX;
    this.active.savedCursorY = this.active.cursorY;
  }

  private restoreCursor(): void {
    this.active.cursorX = clamp(this.active.savedCursorX, 0, this.columns - 1);
    this.active.cursorY = clamp(this.active.savedCursorY, 0, this.rows - 1);
    this.pendingWrap = false;
  }

  private applySgr(codes: number[]): void {
    this.style = applySgrCodes(this.style, codes, this.theme);
  }
}

/**
 * Materialises a frame from a grid: trailing blank rows are trimmed, but never
 * below the cursor row. `rowHasContent` reads the packed cells directly, so the
 * scan allocates nothing -- only the (changed) lines kept below are built.
 *
 * Shared by `TerminalEmulator.frame()` and the snapshot fast path so both
 * produce byte-identical frames from identical cells.
 */
function buildTerminalFrame(
  grid: TerminalGrid,
  columns: number,
  cursorX: number,
  cursorY: number,
  cursorVisible: boolean,
  title: string | null
): TerminalFrame {
  const total = grid.totalRows();
  const cursorRow = grid.scrollbackCount() + cursorY;
  let lastLine = Math.max(cursorRow, 0);
  for (let row = total - 1; row >= 0; row -= 1) {
    if (grid.rowHasContent(row)) {
      lastLine = Math.max(lastLine, row);
      break;
    }
  }
  const lines: TerminalLine[] = [];
  for (let row = 0; row <= lastLine; row += 1) lines.push(grid.lineAt(row));
  return {
    columns,
    rows: lines.length,
    lines,
    cursor: { column: cursorX, row: cursorRow, visible: cursorVisible },
    title,
  };
}

let forceFullEmulation = false;

/**
 * Parses a rendered pane into a frame. Flat snapshots -- text, line ends and
 * SGR, which is what the gateway actually sends -- take `parseFlatSnapshot`;
 * everything else is replayed through the emulator.
 */
export function parseTerminalSnapshot(
  input: string,
  theme: TerminalTheme = DEFAULT_TERMINAL_THEME,
  columns?: number
): TerminalFrame {
  if (!forceFullEmulation) {
    const flat = parseFlatSnapshot(input, theme, columns);
    if (flat) return flat;
  }
  const measured = measureSnapshot(input);
  // A reported width is the pane's own; the measurement is what to do when
  // nobody said. Clamping a reported width against MAX_SNAPSHOT_COLUMNS would
  // reintroduce exactly the overflow this parameter exists to remove.
  const dimensions = {
    columns: columns && columns > 0 ? columns : measured.columns,
    rows: measured.rows,
  };
  const terminal = new TerminalEmulator({
    columns: dimensions.columns,
    rows: dimensions.rows,
    scrollback: 0,
    convertEol: true,
    theme,
  });
  terminal.write(input);
  // A snapshot is the whole text: a sequence its last bytes cut short is not
  // going to be finished by a next chunk, and `flush` handles it exactly as
  // the single write did before `write` learned to wait for one.
  terminal.flush();
  return terminal.frame();
}

/**
 * Test and benchmark switch: forces every snapshot through the full emulator so
 * a fast-path frame can be diffed against the reference one. Not used by the
 * app -- production always lets `parseTerminalSnapshot` pick the path.
 */
export function setTerminalFullEmulation(force: boolean): void {
  forceFullEmulation = force;
}

/**
 * Whether `input` clears the fast path's prescan. Exposed for tests that assert
 * which inputs reach it; a qualifying input can still fall back later if the
 * write hits a case the flat model does not cover (see `parseFlatSnapshot`).
 */
export function snapshotQualifiesForFlatPath(input: string): boolean {
  return scanFlatSnapshot(input) !== null;
}

/**
 * Line-oriented fast path for `parseTerminalSnapshot`.
 *
 * Pane snapshots the gateway hands us are almost never a terminal session's
 * byte stream -- they are the *rendered* screen, so they carry text, line ends
 * and colour, and nothing that moves the cursor. Measured over five real panes
 * (tmux/agent output, 111 B to 113 kB): zero tabs, zero bare CRs, zero OSC, and
 * every one of the ~10k escape sequences was `CSI ... m`. Running those through
 * the full VT state machine costs a per-character dispatch and two grapheme
 * segmentations per line; this path instead splits on line ends, cuts each line
 * at its SGR sequences and writes whole runs into the grid.
 *
 * It is a strict subset, not an approximation: anything outside {printable,
 * `\n`, `\r\n`, `CSI ... m`} -- including a bare `\r`, a tab, any other CSI, any
 * OSC or ESC -- returns null and the caller runs the real emulator. So does a
 * snapshot wide or tall enough that the emulator would wrap or scroll, and any
 * line whose layout turns out not to fit the flat model mid-write.
 *
 * Dimensions and cell contents are computed exactly as the slow path computes
 * them (`measureSnapshot`'s clamps, `putCell`'s packing, `buildTerminalFrame`'s
 * trimming), and `__tests__/flat-fast-path.test.ts` asserts frame-deep equality
 * against the forced-slow path on real and synthetic panes.
 */
function parseFlatSnapshot(
  input: string,
  theme: TerminalTheme,
  columns?: number
): TerminalFrame | null {
  const scan = scanFlatSnapshot(input);
  if (!scan) return null;
  const lineCount = scan.starts.length;
  // A supplied width is the grid the line will actually be laid into, so it is
  // what "wider than the grid" has to mean here; `MAX_SNAPSHOT_COLUMNS` is only
  // the ceiling for the case nobody supplied one (see `measureSnapshot`, which
  // clamps to it for the same reason). A line wider than that grid wraps and a
  // snapshot with more lines than the grid has rows scrolls; neither is
  // modelled here, so the emulator takes those. Exactly `EMULATED_ROW_CAP`
  // lines still fit: the last line feed lands on the bottom row rather than
  // pushing past it.
  //
  // A supplied width is trusted as the pane's own and is not clamped against
  // `MAX_SNAPSHOT_COLUMNS` -- that cap exists only to bound a *guess*. It is
  // still clamped against `MAX_GRID_COLUMNS`, because unlike a guess it is not
  // bounded at all on its own: it comes off the wire, and `TerminalGrid` below
  // allocates `rows * columns` words with no ceiling of its own. Without this,
  // a corrupt or hostile width report sizes that allocation directly.
  // `TerminalEmulator` already clamps every width to `MAX_GRID_COLUMNS`
  // (`terminal-core.ts:60`); this is the fast path carrying the same ceiling
  // rather than being the one path a bad number reaches unguarded.
  const hasWidth = columns !== undefined && columns > 0;
  const suppliedColumns = hasWidth ? Math.min(columns, MAX_GRID_COLUMNS) : null;
  const widthCeiling = suppliedColumns ?? MAX_SNAPSHOT_COLUMNS;
  if (scan.widest > widthCeiling || lineCount > EMULATED_ROW_CAP) return null;
  const gridColumns =
    suppliedColumns ?? clamp(Math.max(MIN_SNAPSHOT_COLUMNS, scan.widest), 2, MAX_SNAPSHOT_COLUMNS);
  const rows = clamp(Math.max(2, lineCount + 1), 2, EMULATED_ROW_CAP);
  const grid = new TerminalGrid(gridColumns, rows, 0);
  // One mutable style carried across lines, exactly as the emulator carries it:
  // an unterminated SGR keeps applying to the rows below.
  let style = cloneTerminalStyle(DEFAULT_TERMINAL_STYLE);
  let cursorX = 0;

  for (let row = 0; row < lineCount; row += 1) {
    const end = scan.ends[row];
    const segmented = scan.kinds[row] === FLAT_LINE_SEGMENTED;
    let column = 0;
    let chunkStart = scan.starts[row];
    let index = chunkStart;
    while (index <= end) {
      if (index < end && input.charCodeAt(index) !== 0x1b) {
        index += 1;
        continue;
      }
      if (index > chunkStart) {
        // ASCII and other standalone code units go in verbatim; only text that
        // can form multi-code-point clusters pays for segmentation.
        column = segmented
          ? grid.putGraphemeRun(row, column, splitGraphemes(input.slice(chunkStart, index)), style)
          : grid.putCodeUnitRun(row, column, input, chunkStart, index, style);
        if (column < 0) return null;
      }
      if (index >= end) break;
      const next = skipSgrSequence(input, index);
      if (next < 0) return null;
      style = applySgrCodes(style, parseSgrValues(input.slice(index + 2, next - 1)), theme);
      index = next;
      chunkStart = next;
    }
    // Filling the last column parks the cursor there with a pending wrap, which
    // the next line end clears -- so only the final line's column survives.
    cursorX = column >= gridColumns ? gridColumns - 1 : column;
  }

  return buildTerminalFrame(grid, gridColumns, cursorX, lineCount - 1, true, null);
}

/** Lines made only of ASCII printables; laid out without any width lookup. */
const FLAT_LINE_ASCII = 0;
/** Lines whose non-ASCII is all standalone code units; still no segmentation. */
const FLAT_LINE_STANDALONE = 1;
/** Lines that can hold multi-code-point clusters, so they must be segmented. */
const FLAT_LINE_SEGMENTED = 2;

type FlatScan = {
  /** Index of each line's first character. */
  starts: number[];
  /** Index just past each line's last character (the `\r` or `\n`, or the end). */
  ends: number[];
  kinds: number[];
  /** Widest line, measured exactly as `measureSnapshot` measures it. */
  widest: number;
};

const SGR_SEQUENCE = /\u001B\[[0-9;:]*m/g;

/**
 * Validates that `input` is flat -- printables, `\n`, `\r\n` and `CSI ... m`
 * only -- and, in the same pass, records where each line sits, how wide it is
 * and whether it needs grapheme segmentation. Returns null the moment anything
 * else shows up.
 */
function scanFlatSnapshot(input: string): FlatScan | null {
  const length = input.length;
  const starts: number[] = [];
  const ends: number[] = [];
  const kinds: number[] = [];
  let widest = 0;
  let index = 0;

  for (;;) {
    const start = index;
    let kind = FLAT_LINE_ASCII;
    let width = 0;
    let end = -1;
    let nextStart = -1;
    while (index < length) {
      const code = input.charCodeAt(index);
      if (code >= 0x20 && code < 0x7f) {
        width += 1;
        index += 1;
        continue;
      }
      if (code >= 0x80) {
        if (kind !== FLAT_LINE_SEGMENTED) {
          if (isStandaloneCodeUnit(code)) {
            kind = FLAT_LINE_STANDALONE;
            width += codePointWidth(code);
          } else {
            kind = FLAT_LINE_SEGMENTED;
          }
        }
        index += 1;
        continue;
      }
      if (code === 0x0a) {
        end = index;
        nextStart = index + 1;
        break;
      }
      if (code === 0x0d) {
        // A bare CR would overwrite the line in place; only CRLF is flat.
        if (input.charCodeAt(index + 1) !== 0x0a) return null;
        end = index;
        nextStart = index + 2;
        break;
      }
      if (code === 0x1b) {
        const next = skipSgrSequence(input, index);
        if (next < 0) return null;
        index = next;
        continue;
      }
      return null; // tab, backspace, DEL, anything else the emulator acts on
    }
    if (end < 0) end = length;
    if (kind === FLAT_LINE_SEGMENTED) {
      width = displayWidth(input.slice(start, end).replace(SGR_SEQUENCE, ''));
    }
    starts.push(start);
    ends.push(end);
    kinds.push(kind);
    if (width > widest) widest = width;
    if (nextStart < 0) break;
    index = nextStart;
  }

  return { starts, ends, kinds, widest };
}

/**
 * Index just past the `ESC [ <digits ; :> m` starting at `index`, or -1 when
 * the escape is anything else (including one truncated by the end of input).
 */
function skipSgrSequence(input: string, index: number): number {
  if (input.charCodeAt(index + 1) !== 0x5b) return -1; // '['
  let cursor = index + 2;
  while (cursor < input.length) {
    const code = input.charCodeAt(cursor);
    if (code >= 0x30 && code <= 0x3b) {
      cursor += 1; // digit, ':' or ';'
      continue;
    }
    break;
  }
  return input.charCodeAt(cursor) === 0x6d ? cursor + 1 : -1; // 'm'
}

export function terminalFrameText(frame: TerminalFrame): string {
  return frame.lines
    .map((line) =>
      line.cells
        .filter((cell) => cell.width > 0)
        .map((cell) => cell.text)
        .join('')
        .trimEnd()
    )
    .join('\n');
}

/**
 * A rooted path printed in the output, e.g. `/Users/me/report.md` or
 * `~/out/chart.png`.
 *
 * The leading group is an explicit boundary rather than a lookbehind, so the
 * rule does not depend on lookbehind support in the runtime's regex engine; its
 * length is added back to recover the path's own index.
 *
 * Deliberately narrow, because a wrong link is worse than a missing one: the
 * path must be rooted at `/` or `~/`, must have at least one segment, and must
 * end in a known extension (checked by `isPreviewableFilePath`). Prose like
 * "see /etc/hosts" or "3/4 done" therefore stays plain text.
 */
const TERMINAL_FILE_PATH_PATTERN = /(^|[\s"'`([{<>|=,:])(~?(?:\/[\w.~@+-]+)+)/gu;

/**
 * Extensions worth turning into a tap target: the ones the gateway's content
 * model can preview (image | markdown | text | pdf). A path the asset viewer
 * could only show as "no preview" is a link that mostly misfires, so binaries
 * and archives are left out on purpose.
 */
const PREVIEWABLE_FILE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'heic',
  'svg',
  'md',
  'markdown',
  'txt',
  'log',
  'csv',
  'tsv',
  'json',
  'jsonl',
  'yaml',
  'yml',
  'toml',
  'xml',
  'html',
  'css',
  'diff',
  'patch',
  'pdf',
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'py',
  'rs',
  'go',
  'rb',
  'java',
  'kt',
  'swift',
  'c',
  'h',
  'cpp',
  'hpp',
  'sh',
  'sql',
]);

function isPreviewableFilePath(path: string): boolean {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  // `dot <= 0` also rejects dotfiles such as `.env`, which have no extension.
  if (dot <= 0) return false;
  return PREVIEWABLE_FILE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

export function terminalFrameLinks(frame: TerminalFrame): TerminalLink[] {
  const links: TerminalLink[] = [];

  frame.lines.forEach((line, row) => {
    for (const run of line.runs) {
      if (!run.style.link) continue;
      links.push({
        uri: run.style.link,
        kind: 'url',
        row,
        startColumn: run.startColumn,
        endColumn: run.endColumn,
      });
    }

    const { text, spans } = terminalLineTextSpans(line);
    for (const match of text.matchAll(/https?:\/\/[^\s<>"'`]+/giu)) {
      if (match.index === undefined) continue;
      const uri = trimTrailingPunctuation(match[0]);
      if (!uri || !isSupportedTerminalUri(uri)) continue;
      addTextLink(links, spans, row, match.index, uri, 'url');
    }

    // Runs after the URL pass on purpose: the path inside an already-matched
    // URL ("https://host/report.md") overlaps that link and is dropped, so a
    // remote document is never mistaken for a local artifact.
    for (const match of text.matchAll(TERMINAL_FILE_PATH_PATTERN)) {
      if (match.index === undefined) continue;
      const path = trimTrailingPunctuation(match[2] ?? '');
      if (!isPreviewableFilePath(path)) continue;
      addTextLink(links, spans, row, match.index + (match[1]?.length ?? 0), path, 'file');
    }
  });

  return links;
}

/**
 * Map a match on the row's plain text back to the grid columns it covers, and
 * keep it only when it does not overlap a link already found on that row.
 */
function addTextLink(
  links: TerminalLink[],
  spans: TerminalTextSpan[],
  row: number,
  startIndex: number,
  uri: string,
  kind: TerminalLinkKind
): void {
  const endIndex = startIndex + uri.length;
  const startSpan = spans.find(
    (span) => startIndex >= span.startIndex && startIndex < span.endIndex
  );
  const endSpan = [...spans]
    .reverse()
    .find((span) => endIndex > span.startIndex && endIndex <= span.endIndex);
  if (!startSpan || !endSpan) return;
  const candidate: TerminalLink = {
    uri,
    kind,
    row,
    startColumn: startSpan.startColumn,
    endColumn: endSpan.endColumn,
  };
  if (links.some((link) => terminalLinksOverlap(link, candidate))) return;
  links.push(candidate);
}

function measureSnapshot(input: string): { columns: number; rows: number } {
  const visible = input
    // An OSC string ends at ITS OWN terminator, so the payload class has to
    // exclude both characters a terminator can begin with. Excluding only BEL
    // -- what this did -- is the same rule as "run to the end of the screen" on
    // any pane whose strings are ST-terminated: the class then matches ESC,
    // newline and everything else on the way to the LAST `ESC \` in the whole
    // snapshot, and every line end in between disappears with it. `rows` below
    // is measured off what is left, and `parseTerminalSnapshot` hands that
    // count to an emulator built with `scrollback: 0` -- so the rows the write
    // then scrolls off the top of a grid that short are gone, not stored.
    //
    // Measured on the reported pane (card #832 -- nvim, 357x83, four OSC 8 file
    // links, not one BEL anywhere): 83 rows measured as 22, and the app drew
    // the last 22 with the other 61 missing. tmux passes an application's OSC 8
    // through `capture-pane -e` verbatim, and ST is what nvim, delta, `ls
    // --hyperlink` and the agent CLIs emit, so this is the ordinary case and
    // not an exotic one.
    //
    // Newline is in the class for the same reason said the other way round: an
    // OSC that never closes must cost the rows below it nothing HERE. The
    // emulator still consumes such a string to the end of the write, which is
    // what a terminal does; this measurement must not also take away the grid
    // that would hold whatever it goes on to print.
    .replace(/\u001B\][^\u0007\u001B\n]*(?:\u0007|\u001B\\)/g, '')
    .replace(/\u001B[P^_][\s\S]*?(?:\u0007|\u001B\\)/g, '')
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001B[()#%*+\-./]?./g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  const lines = visible.split('\n');
  const widest = lines.reduce((width, line) => Math.max(width, displayWidth(line)), 0);
  return {
    columns: clamp(Math.max(MIN_SNAPSHOT_COLUMNS, widest), 2, MAX_SNAPSHOT_COLUMNS),
    rows: clamp(Math.max(2, lines.length + 1), 2, EMULATED_ROW_CAP),
  };
}

/** Narrowest grid a snapshot is parsed into, so short output still has room. */
const MIN_SNAPSHOT_COLUMNS = 40;
/** Widest; beyond this the emulator wraps the overflow onto the next row. */
const MAX_SNAPSHOT_COLUMNS = 320;

/**
 * Hard ceiling on a grid's column count, shared by every path that can size a
 * grid from a number outside its own control -- `TerminalEmulator`'s own
 * constructor clamp, and the flat path's grid when a caller supplies a width.
 *
 * A caller-supplied width (the gateway's `pane.width`) is trusted as the
 * pane's own -- see `parseFlatSnapshot` -- but "trusted" still has to mean
 * "not used to size an allocation with no ceiling": a corrupt or hostile
 * report of, say, two million columns would otherwise ask `TerminalGrid` for
 * `rows * columns * WORDS_PER_CELL` words unclamped, tens of MB to tens of GB
 * for one pane. 512 is comfortably above any real terminal (a 5K monitor's
 * widest pane observed so far is 357 columns) while still being small enough
 * that even `EMULATED_ROW_CAP` rows of it is a bounded, unremarkable
 * allocation -- the same number `TerminalEmulator` already clamps to, so a
 * width this wide behaves identically whichever path renders it.
 */
const MAX_GRID_COLUMNS = 512;

/**
 * Rows the emulator's grid physically holds -- the single cap the constructor
 * and snapshot measurement now share. It used to be two numbers: the constructor
 * clamped to 2000 while measurement clamped to `MAX_EMULATED_ROWS` (2002), so a
 * 2001-2002 row snapshot was measured, allocated, then silently truncated by the
 * constructor. Both sites clamp here instead.
 */
const EMULATED_ROW_CAP = 2000;

/**
 * Gateway line-request ceiling, kept two rows above the grid cap so a read that
 * overshoots by a row (cursor line, off-by-one) still fits the grid rather than
 * being measured larger than the emulator can hold.
 *
 * Must stay in step with `MAX_PANE_OUTPUT_LINES` in the gateway client: asking
 * the gateway for more lines than this parses them and then throws them away,
 * which is bytes and milliseconds spent on output nobody can scroll back to.
 * Raising it is not free -- parse cost is linear in rows, and it runs on the JS
 * thread on every refresh.
 */
export const MAX_EMULATED_ROWS = EMULATED_ROW_CAP + 2;

/** One grapheme of a row: where it sits in the row's text and in its columns. */
type TerminalTextSpan = {
  startIndex: number;
  endIndex: number;
  startColumn: number;
  endColumn: number;
};

function terminalLineTextSpans(line: TerminalLine): {
  text: string;
  spans: TerminalTextSpan[];
} {
  let text = '';
  const spans: TerminalTextSpan[] = [];
  line.cells.forEach((cell, column) => {
    if (cell.width === 0) return;
    const startIndex = text.length;
    text += cell.text;
    spans.push({
      startIndex,
      endIndex: text.length,
      startColumn: column,
      endColumn: column + cell.width,
    });
  });
  return { text, spans };
}

/** Strip sentence punctuation a link picked up from surrounding prose. */
function trimTrailingPunctuation(value: string): string {
  let uri = value;
  while (/[.,;:!?\]}]$/.test(uri)) uri = uri.slice(0, -1);
  while (uri.endsWith(')') && countCharacter(uri, ')') > countCharacter(uri, '(')) {
    uri = uri.slice(0, -1);
  }
  return uri;
}

function countCharacter(value: string, character: string): number {
  return Array.from(value).filter((entry) => entry === character).length;
}

/**
 * A link the app is prepared to hand to the system: `http(s)` only, no
 * whitespace or control characters, and no longer than `TERMINAL_LINK_LIMIT`.
 * Anything else -- `javascript:`, `file:`, a custom scheme, a URI with a
 * control character folded into it -- is not a link at all.
 */
function isSupportedTerminalUri(value: string): boolean {
  if (value.length > TERMINAL_LINK_LIMIT) return false;
  CONTROL_CHARACTERS.lastIndex = 0;
  if (CONTROL_CHARACTERS.test(value)) return false;
  return /^https?:\/\/[^\s]+$/iu.test(value);
}

/** The first `CELL_TEXT_LIMIT` code points of a cluster, cut on a code point boundary. */
function truncateCluster(cluster: string): string {
  let end = 0;
  let count = 0;
  while (end < cluster.length && count < CELL_TEXT_LIMIT) {
    end += isHighSurrogate(cluster.charCodeAt(end)) ? 2 : 1;
    count += 1;
  }
  return cluster.slice(0, end);
}

/** The title a stream set, as plain text: no control characters, and no longer than the limit. */
function sanitizeTerminalTitle(value: string): string {
  const plain = value.replace(CONTROL_CHARACTERS, '');
  return plain.length > TERMINAL_TITLE_LIMIT ? plain.slice(0, TERMINAL_TITLE_LIMIT) : plain;
}

/**
 * The numeric parameters of a CSI sequence. Each `;`-separated entry is an
 * unsigned decimal (a `:` sub-parameter list contributes its first value);
 * anything else -- a sign, a decimal point, a stray intermediate -- reads as
 * 0, which every use here treats as "default". Values are capped at
 * `CSI_PARAMETER_LIMIT`. Never negative and never fractional, so a cursor
 * moved by one cannot leave the grid (the negative-count bug this replaced).
 */
function parseCsiParameters(raw: string): number[] {
  return raw
    .replace(/^[?>!]/, '')
    .split(';')
    .map((entry) => {
      const digits = entry.split(':')[0];
      if (!/^\d+$/.test(digits)) return 0;
      return Math.min(CSI_PARAMETER_LIMIT, Number(digits));
    });
}

function terminalLinksOverlap(left: TerminalLink, right: TerminalLink): boolean {
  return (
    left.row === right.row &&
    left.startColumn < right.endColumn &&
    right.startColumn < left.endColumn
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}
