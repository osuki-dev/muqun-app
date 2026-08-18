// The interaction freeze (card #587).
//
// `useFrozenValue` is a ref around `nextFrozenValue`, so driving the pure rule
// through a sequence of frames is the same thing as driving the hook: each step
// is one render, and the value it returns is the frame that render paints.
import { describe, expect, test } from 'bun:test';
import { nextFrozenValue } from '@/hooks/use-frozen-value';

type Frame = { value: string; frozen: boolean; flush?: boolean };

/** What each render paints, given the props it was rendered with. */
function displayedFrames(initial: string, frames: readonly Frame[]): string[] {
  let displayed = initial;
  return frames.map((frame) => {
    displayed = nextFrozenValue(displayed, {
      value: frame.value,
      frozen: frame.frozen,
      flush: frame.flush ?? false,
    });
    return displayed;
  });
}

describe('nextFrozenValue', () => {
  test('passes output straight through while nothing is being touched', () => {
    expect(
      displayedFrames('a', [
        { value: 'b', frozen: false },
        { value: 'c', frozen: false },
      ])
    ).toEqual(['b', 'c']);
  });

  test('holds the frame that was on screen when the gesture began', () => {
    // The three snapshots that arrive mid-drag are the ones that used to
    // re-lay the grid out under the reader's thumb.
    expect(
      displayedFrames('a', [
        { value: 'b', frozen: false },
        { value: 'c', frozen: true },
        { value: 'd', frozen: true },
        { value: 'e', frozen: true },
      ])
    ).toEqual(['b', 'b', 'b', 'b']);
  });

  test('applies the newest snapshot on release, not the backlog', () => {
    // Intermediate frames are never painted: only where the stream ended up.
    const frames = displayedFrames('a', [
      { value: 'b', frozen: true },
      { value: 'c', frozen: true },
      { value: 'd', frozen: true },
      { value: 'd', frozen: false },
    ]);
    expect(frames).toEqual(['a', 'a', 'a', 'd']);
  });

  test('a release with no new output keeps painting the same frame', () => {
    expect(
      displayedFrames('a', [
        { value: 'a', frozen: true },
        { value: 'a', frozen: false },
      ])
    ).toEqual(['a', 'a']);
  });

  test('a pane switch paints its own first frame even mid-gesture', () => {
    // Holding the previous pane's output under the new pane's gestures is worse
    // than any jump, so the flush wins over the freeze.
    expect(
      displayedFrames('a', [
        { value: 'b', frozen: true },
        { value: 'fresh pane', frozen: true, flush: true },
        { value: 'fresh pane + more', frozen: true },
      ])
    ).toEqual(['a', 'fresh pane', 'fresh pane']);
  });

  test('a second gesture freezes at what the first one released to', () => {
    expect(
      displayedFrames('a', [
        { value: 'b', frozen: true },
        { value: 'c', frozen: false },
        { value: 'd', frozen: true },
        { value: 'e', frozen: true },
        { value: 'f', frozen: false },
      ])
    ).toEqual(['a', 'c', 'c', 'c', 'f']);
  });
});
