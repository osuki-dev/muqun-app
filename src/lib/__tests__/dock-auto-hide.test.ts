import { describe, expect, test } from 'bun:test';

import {
  dockScrollStep,
  HIDE_THRESHOLD,
  type DockScrollEvent,
  type DockScrollStep,
} from '../dock-auto-hide';

/** Mid-list on a page twice the viewport's height, the finger down. */
const mid: DockScrollEvent = {
  y: 400,
  delta: 10,
  contentHeight: 2000,
  viewportHeight: 1000,
  dragging: true,
  pinned: false,
};
const state = { travel: 0, offset: 0, distance: 120 };

describe('dockScrollStep', () => {
  test.each<
    [string, Partial<DockScrollEvent>, Partial<typeof state>, DockScrollStep['kind'], number | null]
  >([
    ['a short run below the threshold holds', {}, {}, 'hold', null],
    ['past the threshold it follows the finger', {}, { travel: HIDE_THRESHOLD + 20 }, 'follow', 30],
    ['and stops at its own height', { delta: 500 }, { travel: 100 }, 'follow', 120],
    ['a fling after release does not drag it', { dragging: false }, { travel: 100 }, 'hold', null],
    ['any upward step shows it', { delta: -2 }, { travel: 100, offset: 120 }, 'show', null],
    ['a resting finger’s jitter does not', { delta: -0.4 }, { travel: 100 }, 'hold', null],
    ['the top of the list shows it', { y: 2 }, { travel: 100, offset: 120 }, 'show', null],
    ['so does the bottom', { y: 998 }, { travel: 100, offset: 120 }, 'show', null],
    ['a focused field, keyboard or send pins it', { pinned: true }, { travel: 100 }, 'show', null],
  ])('%s', (_, event, from, kind, offset) => {
    const step = dockScrollStep({ ...mid, ...event }, { ...state, ...from });
    expect(step.kind).toBe(kind);
    if (offset !== null) expect(step.kind === 'follow' && step.offset).toBe(offset);
  });
});
