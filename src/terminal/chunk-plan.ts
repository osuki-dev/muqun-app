import type { TerminalLine } from '@/terminal/types';

/**
 * Which row blocks of a frame the renderer has to re-record.
 *
 * The terminal draws through SkPictures. Recording the whole scrollback (up to
 * 2000 rows, ~38000px) on every refresh means a one-line append pays for 2000
 * rows of glyph work, so the frame is split into row blocks and only the blocks
 * whose rows changed are recorded again.
 *
 * Blocks used to be fixed slices of the window -- rows [64k, 64k+64) -- and that
 * held up for exactly one case: appending to a window with room left in it. A
 * streaming pane is the other case. Once the scrollback window is full, every
 * line the agent prints costs one line off the top, every row slides up by one,
 * and every fixed slice covers different rows than it did a frame ago. The cache
 * missed on all of them, every frame, for the whole stream: 19 single-row
 * scrolls re-recorded 76 of 76 blocks.
 *
 * So a block boundary is now decided by the rows rather than by their position
 * (see `findChunkEnd`), and a block's identity is its rows and nothing else --
 * not where they sit in the window. A window that drops a row off the top keeps
 * every interior boundary exactly where it was, and every block downstream of
 * the first cut is the block that is already recorded, merely one row further up
 * the pane. The renderer draws it there by translating the recording it already
 * has (`skia-terminal.tsx` records blocks relative to their own first row and
 * puts the absolute offset in the draw transform).
 *
 * That leaves the two ends, which are partial blocks and so genuinely different
 * content on every frame. The tail has to be recorded -- it holds the row that
 * just arrived, and no cache can produce pixels that have never been drawn. The
 * head does not: the rows it has left are a *suffix* of the rows the recording
 * already covers, so the same display list is drawn `overhang` rows higher with
 * the rows above the pane's top clipped off, and it survives until the window
 * has eaten far enough into it that the boundary rule closes the block somewhere
 * else. A single-row scroll therefore costs exactly one recording: the tail.
 *
 * This module is deliberately Skia-free: the planning half is what needs to be
 * cheap and provable, and keeping it out of the component lets the benchmark
 * (`scripts/bench-terminal.ts`) run it under bun with no native canvas.
 */

/**
 * Rows a block must have before a boundary is allowed to close it.
 *
 * Terminals repeat themselves -- runs of blank rows, repeated prompts -- and a
 * boundary rule that reads one row's signature says the same thing about every
 * row of such a run. Without a floor, a screenful of identical rows would come
 * back as a block per row. The floor is the only thing that bounds the block
 * count from below, at the cost of a boundary that is not purely content-decided
 * within the first `MIN` rows of a block: after a one-row shift the two scans
 * disagree about a cut only if a cut fell exactly on the row the floor moved
 * past, which is `1/32` of shifts.
 */
export const TERMINAL_CHUNK_MIN_ROWS = 32;

/**
 * Rows a block is cut at whether or not the content agreed.
 *
 * Output with no boundary row in it for a long stretch would otherwise record as
 * one enormous display list that a single changed row invalidates. The cap is a
 * ceiling on that damage; at the boundary rate below, ~0.6% of blocks reach it.
 */
export const TERMINAL_CHUNK_MAX_ROWS = 192;

/**
 * One row in 32 starts a new block, so a block averages `MIN + 32` = 64 rows --
 * ~1200px at the default line height, roughly a screen and a half, so a viewport
 * spans two or three blocks and a scroll re-uses nearly all of them. It also
 * keeps a one-line append at ~3% of a full scrollback re-record. Smaller blocks
 * would shave that further at the cost of more Skia nodes and more per-frame
 * bounding-box tests on the render thread.
 */
const BOUNDARY_MASK = 0x1f;

const SIGNATURE_SEED = 0x811c9dc5;
const SIGNATURE_PRIME = 0x01000193;

export type TerminalChunkPlan = {
  /** Position in this frame's plan. Not part of the block's identity. */
  index: number;
  startRow: number;
  /** Exclusive. */
  endRow: number;
  /**
   * The cache handle for this block's recording -- which is its content, so the
   * same rows anywhere in any frame find the same display list.
   *
   * For a re-used head (`overhang > 0`) this is the key of the recording, which
   * covers `overhang` rows more than the block does; those rows are above the
   * pane's top and the renderer clips them.
   */
  key: string;
  /** Rows of the recording under `key` that sit above `startRow`. */
  overhang: number;
  /** No usable recording for this block: it has to be recorded again. */
  stale: boolean;
};

/** A recording still covering the top of the pane, as the last plan left it. */
export type TerminalHeadRecording = {
  key: string;
  /** Signatures of every row the recording covers, top to bottom. */
  rows: Int32Array;
};

/**
 * Blocks and rows planned as stale since the last reset. Test and benchmark only
 * -- there is no other way from outside to tell a refresh that re-recorded one
 * block from one that re-recorded the lot. Rows is the number that tracks the
 * actual glyph work: blocks are not all the same size.
 */
export let __recordedChunkCount = 0;
export let __recordedChunkRows = 0;

export function __resetRecordedChunkCount(): void {
  __recordedChunkCount = 0;
  __recordedChunkRows = 0;
}

/**
 * The half of a block key that does not come from the rows themselves.
 *
 * Everything here changes the pixels a block records without changing any row's
 * content: cell geometry (`cellWidth`, `fontSize`, `lineHeight`), the recording
 * width, and the identity of the two objects the painter reads that have no
 * cheap value identity -- the palette and the font provider. Leaving any of them
 * out would leave stale blocks on screen after a theme switch, a font-size
 * change, or the typeface finishing loading.
 */
export function terminalChunkLayoutKey(layout: {
  cellWidth: number;
  fontSize: number;
  lineHeight: number;
  contentWidth: number;
  themeId: number;
  fontId: number;
}): string {
  return [
    layout.cellWidth,
    layout.fontSize,
    layout.lineHeight,
    layout.contentWidth,
    layout.themeId,
    layout.fontId,
  ].join('|');
}

/**
 * Blocks covering `lines`, each marked stale when `isRecorded` has no recording
 * under its key.
 *
 * A block's identity is its rows' signatures folded together plus the layout
 * key. Its position is deliberately absent: that is what lets a recording made
 * for rows sitting at one offset be drawn again after those same rows have
 * scrolled to another. Two blocks in the same frame whose rows are identical --
 * a pane with two matching runs of blank rows -- therefore share one key and one
 * recording, which is why the first of them marks the rest as already planned.
 */
export function planTerminalChunks(
  lines: readonly TerminalLine[],
  layoutKey: string,
  isRecorded: (key: string) => boolean,
  head?: TerminalHeadRecording
): TerminalChunkPlan[] {
  const chunks: TerminalChunkPlan[] = [];
  const planned = new Set<string>();
  let startRow = 0;
  while (startRow < lines.length) {
    const endRow = findChunkEnd(lines, startRow);
    const overhang =
      startRow === 0 && head && isRecorded(head.key) ? headOverhang(head.rows, lines, endRow) : 0;
    const key =
      overhang > 0
        ? head!.key
        : `${chunkSignature(lines, startRow, endRow).toString(36)}|${layoutKey}`;
    const stale = overhang === 0 && !planned.has(key) && !isRecorded(key);
    if (stale) {
      __recordedChunkCount += 1;
      __recordedChunkRows += endRow - startRow;
    }
    planned.add(key);
    chunks.push({ index: chunks.length, startRow, endRow, key, overhang, stale });
    startRow = endRow;
  }
  return chunks;
}

/**
 * The head block's rows as the next plan will need to see them.
 *
 * A head that was re-used is still described by the recording it was re-used
 * from, overhang and all, so the run of rows it can still be matched against
 * does not shrink a row every time the window does -- otherwise the reuse would
 * last exactly one frame.
 */
export function nextHeadRecording(
  plans: readonly TerminalChunkPlan[],
  lines: readonly TerminalLine[],
  previous: TerminalHeadRecording | undefined
): TerminalHeadRecording | undefined {
  const head = plans[0];
  if (!head) return undefined;
  if (head.overhang > 0) return previous;
  const rows = new Int32Array(head.endRow);
  for (let row = 0; row < head.endRow; row += 1) rows[row] = lines[row].signature | 0;
  return { key: head.key, rows };
}

/**
 * How many rows of `recorded` sit above the pane's top, or 0 if the pane's top
 * rows are not the end of that recording.
 *
 * This is the whole of the head reuse: a window that dropped rows off the top
 * left the rows it still has as a suffix of what was recorded, so the recording
 * is drawn that far higher and the difference is clipped. It is a suffix test
 * and not a search -- an ambiguous match is not a risk worth taking for one
 * block, and anything the test rejects (prepended history, a pane switch, a
 * clear) just records the head again.
 */
function headOverhang(
  recorded: Int32Array,
  lines: readonly TerminalLine[],
  headRows: number
): number {
  const overhang = recorded.length - headRows;
  if (overhang <= 0) return 0;
  for (let row = 0; row < headRows; row += 1) {
    if (recorded[overhang + row] !== (lines[row].signature | 0)) return 0;
  }
  return overhang;
}

/**
 * Where the block starting at `startRow` ends (exclusive).
 *
 * The test is on the row that would *start* the next block, so the answer is a
 * property of the rows and not of where the scan began: shift the whole window
 * up by a row and every cut past the first lands between the same two rows it
 * did before.
 */
function findChunkEnd(lines: readonly TerminalLine[], startRow: number): number {
  const earliest = Math.min(lines.length, startRow + TERMINAL_CHUNK_MIN_ROWS);
  const latest = Math.min(lines.length, startRow + TERMINAL_CHUNK_MAX_ROWS);
  for (let row = earliest; row < latest; row += 1) {
    if (isBoundaryRow(lines[row].signature)) return row;
  }
  return latest;
}

/**
 * Whether a row starts a block.
 *
 * The row signature is an FNV fold, whose low bits are the weakest part of it,
 * so it is mixed before the boundary rate is read off it -- otherwise runs of
 * near-identical rows (a counter in the last column) would land on boundaries
 * in lockstep and the block sizes would stop being independent of the content.
 */
function isBoundaryRow(signature: number): boolean {
  let mixed = signature ^ (signature >>> 16);
  mixed = Math.imul(mixed, 0x7feb352d) >>> 0;
  mixed ^= mixed >>> 15;
  return (mixed & BOUNDARY_MASK) === 0;
}

function chunkSignature(lines: readonly TerminalLine[], startRow: number, endRow: number): number {
  let hash = SIGNATURE_SEED;
  for (let row = startRow; row < endRow; row += 1) {
    hash = Math.imul(hash ^ lines[row].signature, SIGNATURE_PRIME) >>> 0;
  }
  // A short block must not collide with a longer one whose extra rows happen to
  // hash back to the seed.
  return Math.imul(hash ^ (endRow - startRow), SIGNATURE_PRIME) >>> 0;
}
