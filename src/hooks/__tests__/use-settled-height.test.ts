// The dock height the PTY is sized by (the multi-line prompt regression).
//
// `useDockMeasurement` is `useSettledHeight` plus a ref around
// `nextSteadyHeight`, so driving the pure rule through a sequence of
// measurements is the same thing as driving the hook: each step is one
// `onLayout`, and what it returns is the height the grid is sized by on the
// render that follows.
//
// The rows below are the numbers that actually reach the far side. A shell
// with a two-line prompt reprints the whole prompt on every one of them, so
// "how many distinct row counts did this sequence produce" is the same
// question as "how many copies of the prompt did the reader watch march down
// the screen".
import { describe, expect, test } from 'bun:test';
import { nextSteadyHeight, type SteadyHeight } from '@/hooks/use-settled-height';
import { terminalGridFor } from '@/lib/ssh-grid-metrics';

/** A phone-sized terminal box, less the header and the status line. */
const VIEWPORT = { width: 393, height: 720, fontSize: 13 } as const;

/** The dock as it is measured while the app's keyboard is up. */
const KEYBOARD_UP = 'true:true:false:false:34';
/** The same dock with the keyboard closed: the key row and the composer only. */
const KEYBOARD_DOWN = 'false:true:false:false:34';

/** The rows the shell is told, for each measurement the dock reports. */
function rowsTold(measurements: readonly SteadyHeight[]): number[] {
  let steady: SteadyHeight = { shape: null, height: 96 };
  return measurements.map((measurement) => {
    steady = nextSteadyHeight(steady, measurement);
    return terminalGridFor({ ...VIEWPORT, height: VIEWPORT.height - steady.height }).rows;
  });
}

/** How many window changes a run of measurements would send. */
function resizesSent(measurements: readonly SteadyHeight[]): number {
  const rows = rowsTold(measurements);
  return rows.filter((value, index) => index > 0 && value !== rows[index - 1]).length;
}

describe('nextSteadyHeight', () => {
  test('takes the first measurement, whatever the shape', () => {
    expect(
      nextSteadyHeight({ shape: null, height: 96 }, { shape: KEYBOARD_UP, height: 300 })
    ).toEqual({ shape: KEYBOARD_UP, height: 300 });
  });

  test('holds the same object while the dock keeps its shape', () => {
    const held: SteadyHeight = { shape: KEYBOARD_DOWN, height: 140 };
    // The identical object, so a re-measure stops at React rather than
    // becoming a render -- which is the other half of card #20.
    expect(nextSteadyHeight(held, { shape: KEYBOARD_DOWN, height: 178 })).toBe(held);
  });

  test('follows the dock when the dock becomes a different dock', () => {
    expect(
      nextSteadyHeight({ shape: KEYBOARD_DOWN, height: 140 }, { shape: KEYBOARD_UP, height: 320 })
    ).toEqual({ shape: KEYBOARD_UP, height: 320 });
  });
});

describe('the rows the shell is told', () => {
  test('hold still across a run of key presses', () => {
    // What the dock measured while `nvim .` was typed on the app's keyboard,
    // one key at a time: the composer wraps, the key row swaps what it is
    // carrying, and none of it is a row of the terminal. Every one of these
    // used to be a window change, and every window change was a fresh copy of
    // the prompt.
    const pressing = [140, 141, 140, 159, 178, 178, 140].map((height) => ({
      shape: KEYBOARD_DOWN,
      height,
    }));
    expect(new Set(rowsTold(pressing)).size).toBe(1);
    expect(resizesSent(pressing)).toBe(0);
  });

  test('change once, and only once, when the keyboard opens and closes', () => {
    const transition = [
      { shape: KEYBOARD_DOWN, height: 140 },
      // The dock is re-measured a few times on the way up; the far side hears
      // one number, not four.
      { shape: KEYBOARD_UP, height: 320 },
      { shape: KEYBOARD_UP, height: 322 },
      { shape: KEYBOARD_UP, height: 320 },
      { shape: KEYBOARD_DOWN, height: 140 },
    ];
    expect(resizesSent(transition)).toBe(2);
  });

  test('settle on the height measured under the shape that is now showing', () => {
    // The failure this rules out is a latch that freezes on the *old* dock's
    // height: the keyboard opens, the shape changes, and the far side is told
    // the row count for a dock that is no longer on screen. The height that
    // wins has to be the one that arrived with the new shape.
    let steady: SteadyHeight = { shape: null, height: 96 };
    for (const measurement of [
      { shape: KEYBOARD_DOWN, height: 140 },
      { shape: KEYBOARD_UP, height: 320 },
      { shape: KEYBOARD_UP, height: 358 },
    ]) {
      steady = nextSteadyHeight(steady, measurement);
    }
    expect(steady).toEqual({ shape: KEYBOARD_UP, height: 320 });
    expect(terminalGridFor({ ...VIEWPORT, height: VIEWPORT.height - steady.height }).rows).toBe(
      terminalGridFor({ ...VIEWPORT, height: VIEWPORT.height - 320 }).rows
    );
  });
});
