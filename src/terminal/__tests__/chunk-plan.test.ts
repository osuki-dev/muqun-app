// Block planning for the Skia recorder (cards #561 and #626).
//
// The pane draws through per-block SkPictures so a refresh only re-records the
// rows that changed. That held for appends and failed for everything a streaming
// pane does: blocks used to be fixed slices of the window, so a window that
// dropped one row off the top moved every row into a different slice and missed
// on every block. Everything here is about the two properties that fixed it --
// a boundary decided by the rows rather than by their position, and an identity
// that is the rows and not where they sit.
import { describe, expect, test } from 'bun:test';
import {
  TERMINAL_CHUNK_MAX_ROWS,
  TERMINAL_CHUNK_MIN_ROWS,
  __recordedChunkCount,
  __recordedChunkRows,
  __resetRecordedChunkCount,
  nextHeadRecording,
  planTerminalChunks,
  terminalChunkLayoutKey,
  type TerminalChunkPlan,
  type TerminalHeadRecording,
} from '@/terminal/chunk-plan';
import type { TerminalLine } from '@/terminal/types';

const LAYOUT = terminalChunkLayoutKey({
  cellWidth: 8.13,
  fontSize: 13.5,
  lineHeight: 19,
  contentWidth: 990,
  themeId: 1,
  fontId: 1,
});

/** A frame's rows, stubbed down to what the planner actually reads. */
function rows(signatures: readonly number[]): TerminalLine[] {
  return signatures.map((signature) => ({ cells: [], runs: [], signature }));
}

/**
 * `count` distinct rows starting at `first`, as a window over a scrollback does.
 * Signatures are spread by a large odd multiplier so they look like the hashes
 * they stand in for rather than like a counter.
 */
function window(first: number, count: number): TerminalLine[] {
  return rows(Array.from({ length: count }, (_, index) => Math.imul(first + index, 0x9e3779b1)));
}

/** The component's cache, reduced to what the planner is told about it. */
function createRecorder() {
  let keys = new Set<string>();
  let head: TerminalHeadRecording | undefined;
  return {
    refresh(lines: TerminalLine[], layoutKey = LAYOUT) {
      __resetRecordedChunkCount();
      const plans = planTerminalChunks(lines, layoutKey, (key) => keys.has(key), head);
      head = nextHeadRecording(plans, lines, head);
      keys = new Set(plans.map((plan) => plan.key));
      return { plans, recorded: __recordedChunkCount, rows: __recordedChunkRows };
    },
  };
}

function covers(plans: readonly TerminalChunkPlan[], total: number): boolean {
  if (plans.length === 0) return total === 0;
  if (plans[0].startRow !== 0 || plans[plans.length - 1].endRow !== total) return false;
  return plans.every((plan, index) => index === 0 || plan.startRow === plans[index - 1].endRow);
}

describe('planTerminalChunks', () => {
  test('covers every row exactly once, in order, with no gap or overlap', () => {
    for (const count of [0, 1, 7, TERMINAL_CHUNK_MIN_ROWS, 250, 999]) {
      const plans = planTerminalChunks(window(0, count), LAYOUT, () => false);
      expect(covers(plans, count)).toBe(true);
      expect(plans.every((plan) => plan.endRow > plan.startRow)).toBe(true);
    }
  });

  test('block sizes stay between the floor and the cap', () => {
    const plans = planTerminalChunks(window(0, 4000), LAYOUT, () => false);
    for (const plan of plans.slice(0, -1)) {
      const size = plan.endRow - plan.startRow;
      expect(size).toBeGreaterThanOrEqual(TERMINAL_CHUNK_MIN_ROWS);
      expect(size).toBeLessThanOrEqual(TERMINAL_CHUNK_MAX_ROWS);
    }
  });

  test('a run of identical rows cannot shatter into a block per row', () => {
    // Blank rows and repeated prompts all carry the same signature, so without
    // the floor the boundary rule would answer the same thing about every one of
    // them and a screenful would plan as hundreds of blocks.
    const plans = planTerminalChunks(rows(new Array(2000).fill(7)), LAYOUT, () => false);
    expect(plans.length).toBeLessThanOrEqual(Math.ceil(2000 / TERMINAL_CHUNK_MIN_ROWS));
  });

  test('identical rows anywhere in the frame share one key and one recording', () => {
    // Two identical runs are one recording drawn twice, so the second must not
    // be planned as work of its own.
    const repeated = [...window(0, 400), ...window(0, 400)];
    __resetRecordedChunkCount();
    const plans = planTerminalChunks(repeated, LAYOUT, () => false);
    const distinct = new Set(plans.map((plan) => plan.key));
    expect(distinct.size).toBeLessThan(plans.length);
    expect(__recordedChunkCount).toBe(distinct.size);
  });

  test('a re-parse of unchanged output re-records nothing', () => {
    // A refresh parses a brand-new emulator, so identity has to come from the
    // rows and nothing else.
    const recorder = createRecorder();
    recorder.refresh(window(0, 900));
    expect(recorder.refresh(window(0, 900)).recorded).toBe(0);
  });

  test('a layout change re-records every block', () => {
    const recorder = createRecorder();
    const first = recorder.refresh(window(0, 900));
    const other = terminalChunkLayoutKey({
      cellWidth: 8.13,
      fontSize: 15,
      lineHeight: 21,
      contentWidth: 990,
      themeId: 1,
      fontId: 1,
    });
    const second = recorder.refresh(window(0, 900), other);
    expect(second.recorded).toBe(second.plans.length);
    expect(first.plans.length).toBeGreaterThan(1);
  });

  test('appending a line re-records only the tail block', () => {
    const recorder = createRecorder();
    recorder.refresh(window(0, 900));
    const appended = recorder.refresh([...window(0, 900), ...rows([12345])]);
    expect(appended.recorded).toBe(1);
    expect(appended.plans.filter((plan) => plan.stale).map((plan) => plan.index)).toEqual([
      appended.plans.length - 1,
    ]);
  });
});

describe('a window sliding a row at a time', () => {
  test('boundaries are content-decided, so a shift moves them with the rows', () => {
    // The heart of it: cut the same rows out of two windows that disagree about
    // where row 0 is, and the cuts have to land between the same two rows.
    const before = planTerminalChunks(window(0, 600), LAYOUT, () => false);
    const after = planTerminalChunks(window(1, 600), LAYOUT, () => false);
    // Absolute row of each cut, in the shared numbering of the content.
    const beforeCuts = before.slice(1).map((plan) => plan.startRow);
    const afterCuts = after.slice(1).map((plan) => plan.startRow + 1);
    // Everything past the first cut is shared; the head is the one block that
    // genuinely lost a row.
    expect(afterCuts.slice(1)).toEqual(beforeCuts.slice(1, afterCuts.length));
    expect(beforeCuts.length).toBeGreaterThan(4);
  });

  test('one block per scroll, and it is the tail', () => {
    const recorder = createRecorder();
    recorder.refresh(window(0, 250));
    let recorded = 0;
    let recordedRows = 0;
    let planned = 0;
    for (let step = 1; step <= 19; step += 1) {
      const result = recorder.refresh(window(step, 250));
      recorded += result.recorded;
      recordedRows += result.rows;
      planned += result.plans.length;
      const stale = result.plans.filter((plan) => plan.stale);
      // Never anything in the middle: whatever is re-recorded is at one end.
      for (const plan of stale) {
        expect(plan.index === 0 || plan.index === result.plans.length - 1).toBe(true);
      }
    }
    // Was 76 of 76 under fixed 64-row slices -- the cache never hit once.
    expect(recorded).toBeLessThanOrEqual(19 + 19 / 2);
    expect(recorded).toBeGreaterThanOrEqual(19);
    expect(planned).toBeGreaterThan(19 * 3);
    // The number that stands for the glyph work: 250 rows a frame, before.
    // Now it is a tail block a frame, so a quarter of the old cost is already a
    // loose bound -- the bench's real output measures 379 of 4750.
    expect(recordedRows).toBeLessThan(250 * 19 * 0.25);
  });

  test('the head is re-used from a recording that still has rows above it', () => {
    const recorder = createRecorder();
    const cold = recorder.refresh(window(0, 250));
    const headRows = cold.plans[0].endRow;
    const scrolled = recorder.refresh(window(1, 250));
    expect(scrolled.plans[0].overhang).toBe(1);
    expect(scrolled.plans[0].stale).toBe(false);
    // Re-used against the ORIGINAL recording, not against the previous frame's
    // view of it, or the reuse would last exactly one frame.
    expect(recorder.refresh(window(2, 250)).plans[0].overhang).toBe(2);
    expect(recorder.refresh(window(3, 250)).plans[0].overhang).toBe(3);
    expect(scrolled.plans[0].key).toBe(cold.plans[0].key);
    expect(headRows).toBeGreaterThanOrEqual(TERMINAL_CHUNK_MIN_ROWS);
  });

  test('the head is recorded again once the window has eaten through it', () => {
    const recorder = createRecorder();
    const cold = recorder.refresh(window(0, 400));
    const headRows = cold.plans[0].endRow;
    let heads = 0;
    // Far enough that the first block cannot still be the first block.
    const steps = headRows + TERMINAL_CHUNK_MIN_ROWS;
    for (let step = 1; step <= steps; step += 1) {
      if (recorder.refresh(window(step, 400)).plans[0].stale) heads += 1;
    }
    expect(heads).toBeGreaterThan(0);
    // Amortised over the rows the head covers, not paid on every frame -- which
    // is the whole difference between this and re-recording it 76 times.
    expect(heads * 8).toBeLessThanOrEqual(steps);
  });

  test('prepended history is not mistaken for a scroll', () => {
    // Pull-to-load puts rows ABOVE the window's top. The head then covers rows
    // the recording never held, so it must not be re-used at some offset.
    const recorder = createRecorder();
    recorder.refresh(window(100, 400));
    const prepended = recorder.refresh(window(0, 500));
    expect(prepended.plans[0].overhang).toBe(0);
    expect(prepended.plans[0].stale).toBe(true);
  });

  test('a pane switch re-uses nothing it should not', () => {
    const recorder = createRecorder();
    recorder.refresh(window(0, 400));
    const other = recorder.refresh(window(9_000_000, 400));
    expect(other.recorded).toBe(other.plans.length);
    expect(other.plans.every((plan) => plan.overhang === 0)).toBe(true);
  });
});

describe('nextHeadRecording', () => {
  test('describes the head by its own rows when the head was recorded', () => {
    const lines = window(0, 300);
    const plans = planTerminalChunks(lines, LAYOUT, () => false);
    const head = nextHeadRecording(plans, lines, undefined);
    expect(head?.key).toBe(plans[0].key);
    expect(head?.rows.length).toBe(plans[0].endRow);
    expect([...(head?.rows ?? [])]).toEqual(lines.slice(0, plans[0].endRow).map((l) => l.signature));
  });

  test('an empty frame leaves no head behind', () => {
    expect(nextHeadRecording([], [], undefined)).toBeUndefined();
  });
});
