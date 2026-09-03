import {
  type TerminalCell,
  type TerminalLine,
  type TerminalRun,
  type TerminalStyle,
} from '@/terminal/types';
import { codePointWidth, graphemeWidth } from '@/terminal/unicode';

/**
 * Typed-array screen model for the terminal emulator.
 *
 * The idea (a flat Uint32 cell grid, per-row dirty tracking, and a ring that
 * rotates an offset instead of moving rows) is borrowed from rahulpandita/
 * react-term's core buffer (MIT, Copyright (c) 2026 Rahul Pandita); none of its
 * code is copied -- the packing, the deque/ring split, and the frame cache below
 * are written for this codebase's cell shape (`TerminalCell` / `TerminalLine`).
 *
 * Why a typed array at all: the old model rebuilt an object tree
 * (`TerminalCell[][]` of `{ text, width, style }`, each style a fresh object) on
 * every write, so a burst of output churned tens of thousands of short-lived
 * objects through Hermes' GC. Here a cell is four Uint32 words and writing one
 * touches no heap. Object trees are materialised only in `lineAt`, only for rows
 * that actually changed, and are cached per physical slot so an unchanged row is
 * handed back by reference.
 *
 * ## Cell packing (WORDS_PER_CELL = 4, addressed as slot*columns*4 + col*4)
 *
 *   word0  text + width
 *     bits 0..20   code point (21 bits) OR, when bit21 is set, an index into
 *                  `textTable`. A single code point (ASCII, one CJK glyph, even a
 *                  non-BMP emoji -- U+1F642 fits in 21 bits) is stored inline; a
 *                  multi-code-point grapheme (combining marks, ZWJ emoji) is
 *                  interned. Code point 0 with the complex bit clear means "".
 *     bit  21      complex-text flag (bits0..20 are a `textTable` index)
 *     bits 22..23  display width (0, 1 or 2)
 *   word1  attributes + link
 *     bits 0..6    bold, dim, italic, underline, strikethrough, inverse, hidden
 *     bits 7..30   1-based index into `linkTable` (0 == no link)
 *   word2  foreground colour code (see `encodeColor`)
 *   word3  background colour code
 *
 * A colour is packed, not interned, when it is truecolor (`rgb(r, g, b)`, which
 * is exactly what the palette emits for 24-bit and 256-colour): bit31 set, low 24
 * bits the RGB. That keeps a truecolour gradient from growing an intern table
 * without bound. Named palette strings (hex) are interned instead, since there
 * are only a handful. Both round-trip to the exact same string the object model
 * produced, so the conformance suite's colour assertions are unaffected.
 *
 * ## Rows: a scrollback deque + a screen ring, over one slot pool
 *
 * Physical rows are `capacity = rows + maxScrollback` fixed slots in `words`.
 * Two structures index them so that no cell data is ever copied to scroll:
 *   - the screen is a ring of `rows` slot ids with a movable `screenHead`, so a
 *     full-screen scroll is an O(1) head rotation plus one blanked row;
 *   - scrollback is a deque of slot ids; a line leaving the top of the screen is
 *     handed to the deque by id, and an evicted slot is recycled as the new blank
 *     bottom row. Nothing shifts.
 * A region scroll (a DECSTBM sub-range) can't rotate the whole head, so it shifts
 * slot ids within the range -- O(region rows), never O(region * columns), and
 * only on the uncommon path.
 */

const WORDS_PER_CELL = 4;

// word0
const TEXT_INDEX_MASK = 0x001fffff; // bits 0..20
const TEXT_COMPLEX = 0x00200000; // bit 21
const WIDTH_SHIFT = 22; // bits 22..23
const WIDTH_MASK = 0x00c00000;
const TEXT_AND_COMPLEX_MASK = TEXT_INDEX_MASK | TEXT_COMPLEX;
/** A default blank cell: a space (U+0020), width 1. */
const SPACE_WORD0 = (0x20 | (1 << WIDTH_SHIFT)) >>> 0;

// word1 attribute bits
const ATTR_BOLD = 1 << 0;
const ATTR_DIM = 1 << 1;
const ATTR_ITALIC = 1 << 2;
const ATTR_UNDERLINE = 1 << 3;
const ATTR_STRIKETHROUGH = 1 << 4;
const ATTR_INVERSE = 1 << 5;
const ATTR_HIDDEN = 1 << 6;
// Attributes end at bit 6; the link index starts where they stop. (There is no
// whole-field mask: every attribute is tested one bit at a time.)
const LINK_SHIFT = 7;
const LINK_MASK = 0xffffff; // bits 7..30 after the shift

// colour word
const COLOR_TRUECOLOR = 0x80000000; // bit 31 -> low 24 bits are RGB
const RGB_MASK = 0xffffff;

const RGB_PATTERN = /^rgb\((\d+), (\d+), (\d+)\)$/;

// FNV-1a constants, applied to whole words rather than bytes: two multiplies per
// cell is the most `buildLine` can spend on a signature without showing up in a
// full parse, and every input word is already a distinct u32.
const SIGNATURE_SEED = 0x811c9dc5;
const SIGNATURE_PRIME = 0x01000193;

/**
 * Intern tables, shared by every grid in the process. Index 0 is reserved so a
 * zero word means "none".
 *
 * Deliberately not per-grid. A cell's words are what `buildLine` folds into
 * `TerminalLine.signature`, and both consumers of that signature -- the chunk
 * cache and the scroll anchor -- compare rows produced by *different* emulators,
 * because `parseTerminalSnapshot` builds a fresh one for every refresh.
 * Numbering each grid's strings from 1 in first-appearance order made a code an
 * artefact of where a colour happened to first appear in that snapshot: scroll
 * one row off the top and unchanged text hashed differently, which silently
 * turned the anchor into a no-op (a parked reader drifted with the stream) and
 * the chunk cache into a full re-record. Interning once for the process makes a
 * code a property of the string, which is what the signature always claimed.
 *
 * Bounded by what a terminal can actually name: colours are palette hex strings
 * -- truecolour is packed into the word instead, so a gradient cannot grow this
 * -- complex text is multi-code-point graphemes only, since a single code point
 * (including CJK and non-BMP emoji) is stored inline, and links are a session's
 * distinct OSC-8 targets.
 */
const textTable: string[] = [''];
const textIndex = new Map<string, number>();
const colorTable: string[] = [''];
const colorCache = new Map<string, number>();
const linkTable: (string | null)[] = [null];
const linkIndex = new Map<string, number>();

export class TerminalGrid {
  readonly columns: number;
  readonly rows: number;
  readonly maxScrollback: number;
  private readonly capacity: number;

  private readonly words: Uint32Array;
  private readonly rowStride: number;

  // Screen ring: logical screen row r lives in slot screenRing[(screenHead+r) % rows].
  private readonly screenRing: Int32Array;
  private screenHead = 0;

  // Scrollback deque of slot ids; slot at logical scrollback index i is
  // sbRing[(sbHead + i) % ringSize].
  private readonly sbRing: Int32Array;
  private sbHead = 0;
  private sbCount = 0;

  // Slots not currently owned by the screen or the deque.
  private readonly freeStack: number[] = [];

  // Per-slot materialised line, cleared when the slot's cells change. Unchanged
  // rows -- including everything in scrollback -- are handed back by reference,
  // so a frame allocates only for the rows that actually moved.
  private readonly lineCache: (TerminalLine | null)[];
  // Screen rows written since the last takeDirtyRows(). Only useful to a caller
  // that keeps one emulator alive across refreshes; the renderer does not (see
  // takeDirtyRows) and tracks changes through `TerminalLine.signature` instead.
  private readonly dirtyRows = new Set<number>();

  constructor(columns: number, rows: number, maxScrollback: number) {
    this.columns = columns;
    this.rows = rows;
    this.maxScrollback = maxScrollback;
    this.capacity = rows + maxScrollback;
    this.rowStride = columns * WORDS_PER_CELL;
    this.words = new Uint32Array(this.capacity * this.rowStride);
    this.screenRing = new Int32Array(rows);
    this.sbRing = new Int32Array(Math.max(1, maxScrollback));
    this.lineCache = new Array(this.capacity).fill(null);
    for (let index = 0; index < rows; index += 1) {
      this.screenRing[index] = index;
      this.fillSlot(index, 0, 0, 0);
    }
    for (let index = rows; index < this.capacity; index += 1) this.freeStack.push(index);
  }

  scrollbackCount(): number {
    return this.sbCount;
  }

  totalRows(): number {
    return this.sbCount + this.rows;
  }

  private screenSlot(row: number): number {
    return this.screenRing[(this.screenHead + row) % this.rows];
  }

  private setScreenSlot(row: number, slot: number): void {
    this.screenRing[(this.screenHead + row) % this.rows] = slot;
  }

  private scrollbackSlot(index: number): number {
    return this.sbRing[(this.sbHead + index) % this.sbRing.length];
  }

  private physicalOf(row: number): number {
    return row < this.sbCount ? this.scrollbackSlot(row) : this.screenSlot(row - this.sbCount);
  }

  private markDirty(row: number, slot: number): void {
    this.dirtyRows.add(row);
    this.lineCache[slot] = null;
  }

  // --- cell writes -------------------------------------------------------

  putCell(row: number, col: number, grapheme: string, width: number, style: TerminalStyle): void {
    const slot = this.screenSlot(row);
    const base = slot * this.rowStride + col * WORDS_PER_CELL;
    this.words[base] = this.encodeWord0(grapheme, width);
    this.words[base + 1] = this.encodeAttrs(style);
    this.words[base + 2] = this.encodeColor(style.foreground);
    this.words[base + 3] = this.encodeColor(style.background);
    this.markDirty(row, slot);
  }

  /** Attaches a zero-width grapheme (a combining mark) to an existing cell. */
  appendGrapheme(row: number, col: number, grapheme: string): void {
    const slot = this.screenSlot(row);
    const base = slot * this.rowStride + col * WORDS_PER_CELL;
    const word0 = this.words[base];
    const width = (word0 & WIDTH_MASK) >>> WIDTH_SHIFT;
    this.words[base] = this.encodeWord0(this.decodeText(word0) + grapheme, width);
    this.markDirty(row, slot);
  }

  /**
   * Writes `text[start, end)` as one styled run, one BMP code unit per cell.
   *
   * The caller guarantees every unit is a standalone grapheme cluster (see
   * `isStandaloneCodeUnit`), which is what makes this cheap: no segmentation,
   * no per-cell string, and the style words are encoded once for the whole run
   * instead of once per cell as `putCell` does.
   *
   * Returns the column after the run, or -1 when the run would not fit the row
   * (or hits an unexpected zero-width unit). Both are cases the emulator
   * resolves by wrapping or by folding the mark into the previous cell, so the
   * caller must fall back to it rather than guess.
   */
  putCodeUnitRun(
    row: number,
    col: number,
    text: string,
    start: number,
    end: number,
    style: TerminalStyle
  ): number {
    const attrs = this.encodeAttrs(style);
    const fg = this.encodeColor(style.foreground);
    const bg = this.encodeColor(style.background);
    const words = this.words;
    const slot = this.screenSlot(row);
    const rowBase = slot * this.rowStride;
    let column = col;
    for (let index = start; index < end; index += 1) {
      const unit = text.charCodeAt(index);
      const width = codePointWidth(unit);
      if (width === 0 || column + width > this.columns) return -1;
      const base = rowBase + column * WORDS_PER_CELL;
      words[base] = (unit | (width << WIDTH_SHIFT)) >>> 0;
      words[base + 1] = attrs;
      words[base + 2] = fg;
      words[base + 3] = bg;
      if (width === 2) {
        // A zero-width continuation cell so the wide glyph owns both columns.
        words[base + WORDS_PER_CELL] = 0;
        words[base + WORDS_PER_CELL + 1] = attrs;
        words[base + WORDS_PER_CELL + 2] = fg;
        words[base + WORDS_PER_CELL + 3] = bg;
      }
      column += width;
    }
    this.markDirty(row, slot);
    return column;
  }

  /**
   * Writes pre-segmented graphemes as one styled run -- the same batching as
   * `putCodeUnitRun` for text that did need segmentation. Zero-width graphemes
   * are folded into the nearest cell to the left that owns a column, matching
   * the emulator's combining-mark handling. Returns the column after the run,
   * or -1 when it would not fit the row.
   */
  putGraphemeRun(row: number, col: number, graphemes: readonly string[], style: TerminalStyle): number {
    const attrs = this.encodeAttrs(style);
    const fg = this.encodeColor(style.foreground);
    const bg = this.encodeColor(style.background);
    const words = this.words;
    const slot = this.screenSlot(row);
    const rowBase = slot * this.rowStride;
    let column = col;
    for (const grapheme of graphemes) {
      const width = graphemeWidth(grapheme);
      if (width === 0) {
        let probe = column - 1;
        while (probe >= 0 && ((words[rowBase + probe * WORDS_PER_CELL] & WIDTH_MASK) >>> WIDTH_SHIFT) === 0) {
          probe -= 1;
        }
        if (probe < 0) continue;
        const base = rowBase + probe * WORDS_PER_CELL;
        const word0 = words[base];
        words[base] = this.encodeWord0(this.decodeText(word0) + grapheme, (word0 & WIDTH_MASK) >>> WIDTH_SHIFT);
        continue;
      }
      if (column + width > this.columns) return -1;
      const base = rowBase + column * WORDS_PER_CELL;
      words[base] = this.encodeWord0(grapheme, width);
      words[base + 1] = attrs;
      words[base + 2] = fg;
      words[base + 3] = bg;
      if (width === 2) {
        words[base + WORDS_PER_CELL] = 0;
        words[base + WORDS_PER_CELL + 1] = attrs;
        words[base + WORDS_PER_CELL + 2] = fg;
        words[base + WORDS_PER_CELL + 3] = bg;
      }
      column += width;
    }
    this.markDirty(row, slot);
    return column;
  }

  blankCell(row: number, col: number, style: TerminalStyle): void {
    const slot = this.screenSlot(row);
    const base = slot * this.rowStride + col * WORDS_PER_CELL;
    this.words[base] = SPACE_WORD0;
    this.words[base + 1] = this.encodeAttrs(style);
    this.words[base + 2] = this.encodeColor(style.foreground);
    this.words[base + 3] = this.encodeColor(style.background);
    this.markDirty(row, slot);
  }

  /** The grapheme in a screen cell; empty for a wide glyph's continuation cell. */
  textAt(row: number, col: number): string {
    const base = this.screenSlot(row) * this.rowStride + col * WORDS_PER_CELL;
    return this.decodeText(this.words[base]);
  }

  widthAt(row: number, col: number): number {
    const base = this.screenSlot(row) * this.rowStride + col * WORDS_PER_CELL;
    return (this.words[base] & WIDTH_MASK) >>> WIDTH_SHIFT;
  }

  eraseCells(row: number, start: number, end: number, style: TerminalStyle): void {
    for (let col = start; col <= end; col += 1) this.blankCell(row, col, style);
  }

  blankScreenRow(row: number, style: TerminalStyle): void {
    const slot = this.screenSlot(row);
    this.fillSlot(slot, this.encodeAttrs(style), this.encodeColor(style.foreground), this.encodeColor(style.background));
    this.markDirty(row, slot);
  }

  insertCells(row: number, col: number, count: number, style: TerminalStyle): void {
    const slot = this.screenSlot(row);
    const stride = this.rowStride;
    const rowBase = slot * stride;
    for (let target = this.columns - 1; target >= col + count; target -= 1) {
      const from = (rowBase + (target - count) * WORDS_PER_CELL) | 0;
      const to = (rowBase + target * WORDS_PER_CELL) | 0;
      this.words.copyWithin(to, from, from + WORDS_PER_CELL);
    }
    for (let target = col; target < Math.min(this.columns, col + count); target += 1) {
      this.writeBlank(rowBase + target * WORDS_PER_CELL, style);
    }
    this.markDirty(row, slot);
  }

  deleteCells(row: number, col: number, count: number, style: TerminalStyle): void {
    const slot = this.screenSlot(row);
    const stride = this.rowStride;
    const rowBase = slot * stride;
    for (let target = col; target < this.columns - count; target += 1) {
      const from = (rowBase + (target + count) * WORDS_PER_CELL) | 0;
      const to = (rowBase + target * WORDS_PER_CELL) | 0;
      this.words.copyWithin(to, from, from + WORDS_PER_CELL);
    }
    for (let target = Math.max(col, this.columns - count); target < this.columns; target += 1) {
      this.writeBlank(rowBase + target * WORDS_PER_CELL, style);
    }
    this.markDirty(row, slot);
  }

  // --- row / scroll operations ------------------------------------------

  /**
   * Scroll `[top, bottom]` up by `count`. When `retain` is set (the main buffer
   * scrolling from row 0) the rows leaving the top are pushed to scrollback
   * instead of discarded. The full-screen case is a head rotation; a sub-range
   * shifts slot ids.
   */
  scrollUp(count: number, top: number, bottom: number, retain: boolean, style: TerminalStyle): void {
    const times = Math.min(Math.max(1, count), bottom - top + 1);
    const fullScreen = top === 0 && bottom === this.rows - 1;
    for (let index = 0; index < times; index += 1) {
      const removed = fullScreen ? this.screenRing[this.screenHead] : this.screenSlot(top);
      const fill = retain ? this.retainAndRecycle(removed) : removed;
      if (fullScreen) {
        this.screenHead = (this.screenHead + 1) % this.rows;
        this.screenRing[(this.screenHead + this.rows - 1) % this.rows] = fill;
      } else {
        for (let row = top; row < bottom; row += 1) this.setScreenSlot(row, this.screenSlot(row + 1));
        this.setScreenSlot(bottom, fill);
      }
      this.fillSlot(fill, this.encodeAttrs(style), this.encodeColor(style.foreground), this.encodeColor(style.background));
      this.dirtyScreenRange(top, bottom);
    }
  }

  /** Scroll `[top, bottom]` down by `count`, inserting blank rows at the top. */
  scrollDown(count: number, top: number, bottom: number, style: TerminalStyle): void {
    const times = Math.min(Math.max(1, count), bottom - top + 1);
    const fullScreen = top === 0 && bottom === this.rows - 1;
    for (let index = 0; index < times; index += 1) {
      const removed = fullScreen
        ? this.screenRing[(this.screenHead + this.rows - 1) % this.rows]
        : this.screenSlot(bottom);
      if (fullScreen) {
        this.screenHead = (this.screenHead - 1 + this.rows) % this.rows;
        this.screenRing[this.screenHead] = removed;
      } else {
        for (let row = bottom; row > top; row -= 1) this.setScreenSlot(row, this.screenSlot(row - 1));
        this.setScreenSlot(top, removed);
      }
      this.fillSlot(removed, this.encodeAttrs(style), this.encodeColor(style.foreground), this.encodeColor(style.background));
      this.dirtyScreenRange(top, bottom);
    }
  }

  clearScreen(style: TerminalStyle): void {
    const attrs = this.encodeAttrs(style);
    const fg = this.encodeColor(style.foreground);
    const bg = this.encodeColor(style.background);
    for (let row = 0; row < this.rows; row += 1) {
      const slot = this.screenSlot(row);
      this.fillSlot(slot, attrs, fg, bg);
      this.markDirty(row, slot);
    }
  }

  clearScrollback(): void {
    while (this.sbCount > 0) {
      this.freeStack.push(this.sbRing[this.sbHead]);
      this.sbHead = (this.sbHead + 1) % this.sbRing.length;
      this.sbCount -= 1;
    }
  }

  // --- resizing ----------------------------------------------------------

  /**
   * A grid of another size holding this grid's rows, in order and without
   * reflow. `shift` is how many rows move across the screen's top edge: positive
   * pushes that many rows off the top of the screen into scrollback, negative
   * pulls that many back out of scrollback onto the screen. Rows are cut at
   * the new width (a wide glyph left without its second cell is blanked) or
   * padded with blank cells; rows past the new screen's bottom are dropped,
   * and scrollback beyond `maxScrollback` loses its oldest rows.
   *
   * A new grid rather than a rebuild in place because everything here --
   * the word buffer, the two rings, the slot pool -- is sized once from the
   * dimensions, and a resize is rare enough (a rotation, a keyboard) that one
   * allocation and one row-by-row `set` is the simplest thing that is also
   * fast: no cell is decoded, no line object is built.
   */
  resized(columns: number, rows: number, shift: number): TerminalGrid {
    const next = new TerminalGrid(columns, rows, this.maxScrollback);
    const total = this.sbCount + this.rows;
    const screenStart = Math.max(0, Math.min(total, this.sbCount + shift));
    const kept = Math.min(screenStart, this.maxScrollback);
    const dropped = screenStart - kept;
    for (let index = 0; index < kept; index += 1) {
      const slot = next.freeStack.pop() as number;
      next.sbRing[index] = slot;
      this.copyRowInto(next, this.physicalOf(dropped + index), slot);
    }
    next.sbCount = kept;
    for (let row = 0; row < rows; row += 1) {
      const source = screenStart + row;
      if (source >= total) break;
      this.copyRowInto(next, this.physicalOf(source), next.screenSlot(row));
      next.dirtyRows.add(row);
    }
    return next;
  }

  /** The last screen row holding anything drawn, or -1 for a blank screen. */
  lastScreenRowWithContent(): number {
    for (let row = this.rows - 1; row >= 0; row -= 1) {
      if (this.rowHasContent(this.sbCount + row)) return row;
    }
    return -1;
  }

  private copyRowInto(target: TerminalGrid, sourceSlot: number, targetSlot: number): void {
    const copied = Math.min(this.columns, target.columns);
    const from = sourceSlot * this.rowStride;
    const to = targetSlot * target.rowStride;
    target.words.set(this.words.subarray(from, from + copied * WORDS_PER_CELL), to);
    if (target.columns < this.columns) {
      // The cut may fall between a wide glyph and its continuation cell.
      const last = to + (target.columns - 1) * WORDS_PER_CELL;
      if (((target.words[last] & WIDTH_MASK) >>> WIDTH_SHIFT) === 2) target.words[last] = SPACE_WORD0;
    }
    target.lineCache[targetSlot] = null;
  }

  // --- frame reconstruction ---------------------------------------------

  rowHasContent(row: number): boolean {
    const slot = this.physicalOf(row);
    for (let col = this.columns - 1; col >= 0; col -= 1) {
      if (this.contentAt(slot, col)) return true;
    }
    return false;
  }

  lineAt(row: number): TerminalLine {
    const slot = this.physicalOf(row);
    const cached = this.lineCache[slot];
    if (cached) return cached;
    const line = this.buildLine(slot);
    this.lineCache[slot] = line;
    return line;
  }

  /** Screen rows dirtied since the last call; clears the set. */
  takeDirtyRows(): number[] {
    const rows = [...this.dirtyRows].sort((left, right) => left - right);
    this.dirtyRows.clear();
    return rows;
  }

  // --- internals ---------------------------------------------------------

  private retainAndRecycle(removed: number): number {
    // With no scrollback, retain must degrade to discard: the evict path below
    // would otherwise hand back sbRing[0]'s placeholder slot, which the screen
    // still owns, leaving two screen rows aliased to one slot.
    if (this.maxScrollback === 0) return removed;
    // `removed` joins scrollback; the returned slot becomes the new blank row.
    const ring = this.sbRing;
    if (this.sbCount < this.maxScrollback) {
      ring[(this.sbHead + this.sbCount) % ring.length] = removed;
      this.sbCount += 1;
      return this.freeStack.pop() as number;
    }
    // Scrollback full: evict the oldest and reuse its slot.
    const recycled = ring[this.sbHead];
    this.sbHead = (this.sbHead + 1) % ring.length;
    ring[(this.sbHead + this.sbCount - 1) % ring.length] = removed;
    this.lineCache[recycled] = null;
    return recycled;
  }

  private dirtyScreenRange(top: number, bottom: number): void {
    for (let row = top; row <= bottom; row += 1) this.dirtyRows.add(row);
  }

  private fillSlot(slot: number, attrs: number, fg: number, bg: number): void {
    const stride = this.rowStride;
    const rowBase = slot * stride;
    for (let offset = 0; offset < stride; offset += WORDS_PER_CELL) {
      const base = rowBase + offset;
      this.words[base] = SPACE_WORD0;
      this.words[base + 1] = attrs;
      this.words[base + 2] = fg;
      this.words[base + 3] = bg;
    }
    this.lineCache[slot] = null;
  }

  private writeBlank(base: number, style: TerminalStyle): void {
    this.words[base] = SPACE_WORD0;
    this.words[base + 1] = this.encodeAttrs(style);
    this.words[base + 2] = this.encodeColor(style.foreground);
    this.words[base + 3] = this.encodeColor(style.background);
  }

  private contentAt(slot: number, col: number): boolean {
    const base = slot * this.rowStride + col * WORDS_PER_CELL;
    const word0 = this.words[base];
    if ((word0 & WIDTH_MASK) >>> WIDTH_SHIFT === 0) return true; // wide-glyph continuation
    if (this.words[base + 3] !== 0) return true; // background set
    if (this.words[base + 1] & ATTR_INVERSE) return true;
    return (word0 & TEXT_AND_COMPLEX_MASK) !== 0x20; // anything but a plain space
  }

  private buildLine(slot: number): TerminalLine {
    const columns = this.columns;
    const words = this.words;
    const rowBase = slot * this.rowStride;
    let lastColumn = -1;
    for (let col = columns - 1; col >= 0; col -= 1) {
      if (this.contentAt(slot, col)) {
        lastColumn = col;
        break;
      }
    }
    const cells: TerminalCell[] = [];
    const runs: TerminalRun[] = [];
    // Hashed over the same columns the line exposes -- columns past lastColumn
    // are blank by `contentAt`'s definition and are never drawn, so folding them
    // in would invalidate a renderer's cache for pixels that cannot change.
    let signature = SIGNATURE_SEED;
    let run: TerminalRun | null = null;
    let runW1 = -1;
    let runW2 = -1;
    let runW3 = -1;
    for (let col = 0; col <= lastColumn; col += 1) {
      const base = rowBase + col * WORDS_PER_CELL;
      const word0 = words[base];
      const w1 = words[base + 1];
      const w2 = words[base + 2];
      const w3 = words[base + 3];
      signature = (Math.imul(signature ^ word0, SIGNATURE_PRIME) ^ w1) >>> 0;
      signature = (Math.imul(signature ^ w2, SIGNATURE_PRIME) ^ w3) >>> 0;
      const width = ((word0 & WIDTH_MASK) >>> WIDTH_SHIFT) as 0 | 1 | 2;
      const text = this.decodeText(word0);
      cells.push({ text, width, style: this.decodeStyle(w1, w2, w3) });
      if (width === 0) continue;
      const endColumn = Math.min(columns, col + width);
      if (run && w1 === runW1 && w2 === runW2 && w3 === runW3 && run.endColumn === col) {
        run.text += text;
        run.endColumn = endColumn;
      } else {
        run = { text, startColumn: col, endColumn, style: this.decodeStyle(w1, w2, w3) };
        runs.push(run);
        runW1 = w1;
        runW2 = w2;
        runW3 = w3;
      }
    }
    // Length is mixed in last so a row that only lost trailing content -- same
    // words, fewer of them -- cannot keep its old signature.
    return { cells, runs, signature: Math.imul(signature ^ (lastColumn + 1), SIGNATURE_PRIME) >>> 0 };
  }

  // --- codecs ------------------------------------------------------------

  private encodeWord0(grapheme: string, width: number): number {
    let textBits: number;
    if (grapheme === '') {
      textBits = 0;
    } else {
      const codePoint = grapheme.codePointAt(0) as number;
      if (codePoint <= TEXT_INDEX_MASK && String.fromCodePoint(codePoint) === grapheme) {
        textBits = codePoint;
      } else {
        textBits = TEXT_COMPLEX | this.internText(grapheme);
      }
    }
    return (textBits | (width << WIDTH_SHIFT)) >>> 0;
  }

  private decodeText(word0: number): string {
    if (word0 & TEXT_COMPLEX) return textTable[word0 & TEXT_INDEX_MASK];
    const codePoint = word0 & TEXT_INDEX_MASK;
    return codePoint === 0 ? '' : String.fromCodePoint(codePoint);
  }

  private encodeAttrs(style: TerminalStyle): number {
    let attrs = 0;
    if (style.bold) attrs |= ATTR_BOLD;
    if (style.dim) attrs |= ATTR_DIM;
    if (style.italic) attrs |= ATTR_ITALIC;
    if (style.underline) attrs |= ATTR_UNDERLINE;
    if (style.strikethrough) attrs |= ATTR_STRIKETHROUGH;
    if (style.inverse) attrs |= ATTR_INVERSE;
    if (style.hidden) attrs |= ATTR_HIDDEN;
    return (attrs | (this.internLink(style.link) << LINK_SHIFT)) >>> 0;
  }

  private decodeStyle(w1: number, w2: number, w3: number): TerminalStyle {
    return {
      foreground: this.decodeColor(w2),
      background: this.decodeColor(w3),
      bold: (w1 & ATTR_BOLD) !== 0,
      dim: (w1 & ATTR_DIM) !== 0,
      italic: (w1 & ATTR_ITALIC) !== 0,
      underline: (w1 & ATTR_UNDERLINE) !== 0,
      strikethrough: (w1 & ATTR_STRIKETHROUGH) !== 0,
      inverse: (w1 & ATTR_INVERSE) !== 0,
      hidden: (w1 & ATTR_HIDDEN) !== 0,
      link: linkTable[(w1 >>> LINK_SHIFT) & LINK_MASK] ?? null,
    };
  }

  private encodeColor(color: string | null): number {
    if (color === null) return 0;
    const cached = colorCache.get(color);
    if (cached !== undefined) return cached;
    const match = RGB_PATTERN.exec(color);
    let code: number;
    if (match) {
      const rgb = ((Number(match[1]) << 16) | (Number(match[2]) << 8) | Number(match[3])) & RGB_MASK;
      code = (COLOR_TRUECOLOR | rgb) >>> 0;
    } else {
      code = colorTable.length;
      colorTable.push(color);
    }
    colorCache.set(color, code);
    return code;
  }

  private decodeColor(code: number): string | null {
    if (code === 0) return null;
    if (code >= COLOR_TRUECOLOR) {
      const rgb = code & RGB_MASK;
      return `rgb(${(rgb >>> 16) & 0xff}, ${(rgb >>> 8) & 0xff}, ${rgb & 0xff})`;
    }
    return colorTable[code];
  }

  private internText(grapheme: string): number {
    const existing = textIndex.get(grapheme);
    if (existing !== undefined) return existing;
    const index = textTable.length;
    textTable.push(grapheme);
    textIndex.set(grapheme, index);
    return index;
  }

  private internLink(link: string | null): number {
    if (link === null) return 0;
    const existing = linkIndex.get(link);
    if (existing !== undefined) return existing;
    const index = linkTable.length;
    linkTable.push(link);
    linkIndex.set(link, index);
    return index;
  }
}
