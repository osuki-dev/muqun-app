// What a two-finger swipe on the terminal is allowed to do, as assertions.
//
// The gesture itself cannot be tested here, so everything it decides is kept
// out of the screen: whether a pair of fingers meant a swipe or a pinch, which
// tab a direction lands on, that both ends wrap, that a lone tab offers
// nothing, and that a tab comes back on the pane it was left on.
//
// The pinch cases are the point of the file. The terminal answers a pinch by
// zooming its canvas, and the swipe fires on the same two fingers; a
// discrimination that gets this wrong does not merely miss a gesture, it throws
// the reader onto a different tab in the middle of a zoom.
import { describe, expect, test } from 'bun:test';

import {
  canCycleTabs,
  classifyTwoFingerGesture,
  cycleTab,
  cycleTabFrom,
  recallTabPane,
  rememberTabPane,
  swipeAppliesImmediately,
  TAB_SWIPE_AXIS_BIAS,
  TAB_SWIPE_COMMIT_QUIET_MS,
  TAB_SWIPE_DISTANCE,
  TAB_SWIPE_PINCH_SEPARATION,
  TAB_SWIPE_TOGETHER_SHARE,
  tabPosition,
  twoFingerFrame,
  type TabPaneMemory,
  type TwoFingerFrame,
} from '../tab-swipe';

const tabs = [
  { id: 't1', title: 'Development' },
  { id: 't2', title: 'Review' },
  { id: 't3', title: 'Logs' },
];

/**
 * Two fingers 200 points apart on a horizontal line, then both moved by the
 * same offset -- the shape of a deliberate two-finger pan.
 */
function pan(dx: number, dy = 0): [TwoFingerFrame, TwoFingerFrame] {
  const from: TwoFingerFrame = { a: { x: 100, y: 400 }, b: { x: 300, y: 400 } };
  const to: TwoFingerFrame = {
    a: { x: 100 + dx, y: 400 + dy },
    b: { x: 300 + dx, y: 400 + dy },
  };
  return [from, to];
}

/**
 * The same two fingers moved symmetrically apart (positive) or together
 * (negative) by `spread` in total, optionally drifting sideways as real pinches
 * do.
 */
function pinch(spread: number, drift = 0): [TwoFingerFrame, TwoFingerFrame] {
  const from: TwoFingerFrame = { a: { x: 100, y: 400 }, b: { x: 300, y: 400 } };
  const to: TwoFingerFrame = {
    a: { x: 100 - spread / 2 + drift, y: 400 },
    b: { x: 300 + spread / 2 + drift, y: 400 },
  };
  return [from, to];
}

describe('telling a swipe from a pinch', () => {
  test('both fingers left is next, both right is previous', () => {
    expect(classifyTwoFingerGesture(...pan(-100))).toBe('next');
    expect(classifyTwoFingerGesture(...pan(100))).toBe('previous');
  });

  test('a symmetric spread or squeeze is a pinch, whichever way it went', () => {
    expect(classifyTwoFingerGesture(...pinch(200))).toBe('pinch');
    expect(classifyTwoFingerGesture(...pinch(-160))).toBe('pinch');
  });

  test('a pinch that also drifts sideways is still a pinch', () => {
    // 240 points of spread against 60 of pair travel: the fingers did far more
    // in opposition than in common. This is the case the old one-finger test
    // could not see at all -- finger b alone travelled 180 points left to
    // right, which read as a swipe and moved the pane mid-zoom.
    expect(classifyTwoFingerGesture(...pinch(240, 60))).toBe('pinch');
  });

  test('a swipe whose fingers drift apart a little is still a swipe', () => {
    // 100 points of travel, 20 of drift: fingers are not a rigid body.
    const from: TwoFingerFrame = { a: { x: 100, y: 400 }, b: { x: 300, y: 400 } };
    const to: TwoFingerFrame = { a: { x: 0, y: 400 }, b: { x: 220, y: 400 } };
    expect(classifyTwoFingerGesture(from, to)).toBe('next');
  });

  test('one finger planted while the other sweeps past reads as opposition', () => {
    // Not a swipe, and specifically a pinch: a finger sweeping 280 points away
    // from a planted one has changed the gap by 280, which is what a
    // one-handed squeeze looks like when the thumb does not move.
    const from: TwoFingerFrame = { a: { x: 100, y: 380 }, b: { x: 100, y: 420 } };
    const to: TwoFingerFrame = { a: { x: 100, y: 380 }, b: { x: -180, y: 420 } };
    expect(classifyTwoFingerGesture(from, to)).toBe('pinch');
  });

  test('fingers shearing in opposite directions are not a swipe', () => {
    // Far enough apart (400 points, the length of a phone) that the gap grows
    // by less than the pair appears to travel, so the separation test lets this
    // through and only the same-direction test rejects it. This is the case
    // that keeps that test from being decoration.
    const from: TwoFingerFrame = { a: { x: 200, y: 200 }, b: { x: 200, y: 600 } };
    const to: TwoFingerFrame = { a: { x: 400, y: 200 }, b: { x: 160, y: 600 } };
    expect(classifyTwoFingerGesture(from, to)).toBe('none');
  });

  test('a mostly vertical two-finger drag is not a tab switch', () => {
    expect(classifyTwoFingerGesture(...pan(-80, 220))).toBe('none');
  });

  test('two fingers that barely moved are nothing at all', () => {
    expect(classifyTwoFingerGesture(...pan(-6, 3))).toBe('none');
    expect(classifyTwoFingerGesture(...pan(0, 0))).toBe('none');
  });

  // The thresholds are pinned rather than described: this is the arithmetic
  // standing between a zoom and being thrown onto another tab, so a value that
  // moves should fail here rather than on someone's phone.
  test('the travel threshold is exactly where it claims to be', () => {
    expect(TAB_SWIPE_DISTANCE).toBe(72);
    expect(classifyTwoFingerGesture(...pan(-(TAB_SWIPE_DISTANCE - 1)))).toBe('none');
    expect(classifyTwoFingerGesture(...pan(-TAB_SWIPE_DISTANCE))).toBe('next');
  });

  test('the axis bias is exactly where it claims to be', () => {
    expect(TAB_SWIPE_AXIS_BIAS).toBe(1.35);
    // 100 across: vertical travel of 100/1.35 still passes, a hair more fails.
    expect(classifyTwoFingerGesture(...pan(-100, 74))).toBe('next');
    expect(classifyTwoFingerGesture(...pan(-100, 75))).toBe('none');
  });

  test('the separation threshold is exactly where it claims to be', () => {
    expect(TAB_SWIPE_PINCH_SEPARATION).toBe(24);
    // Spread just under it is wobble on a pan that still counts...
    expect(classifyTwoFingerGesture(...pinch(TAB_SWIPE_PINCH_SEPARATION - 2, -80))).toBe('next');
    // ...and at it, with the pair barely moving, opposition wins.
    expect(classifyTwoFingerGesture(...pinch(TAB_SWIPE_PINCH_SEPARATION, 20))).toBe('pinch');
  });

  test('the together share is exactly where it claims to be', () => {
    expect(TAB_SWIPE_TOGETHER_SHARE).toBe(0.5);
    // Pair travel 90: the slower finger must cover at least 45.
    const from: TwoFingerFrame = { a: { x: 200, y: 300 }, b: { x: 200, y: 500 } };
    const passing: TwoFingerFrame = { a: { x: 200 - 135, y: 300 }, b: { x: 200 - 45, y: 500 } };
    const failing: TwoFingerFrame = { a: { x: 200 - 136, y: 300 }, b: { x: 200 - 44, y: 500 } };
    expect(classifyTwoFingerGesture(from, passing)).toBe('next');
    expect(classifyTwoFingerGesture(from, failing)).toBe('none');
  });
});

// The shape gesture-handler reports each pointer in (`TouchData`), of which
// only the position is read here.
describe('reading a touch list', () => {
  test('exactly two fingers make a frame', () => {
    expect(twoFingerFrame([
      { x: 10, y: 20 },
      { x: 30, y: 40 },
    ])).toEqual({ a: { x: 10, y: 20 }, b: { x: 30, y: 40 } });
  });

  test('one finger is not a two-finger gesture', () => {
    expect(twoFingerFrame([{ x: 10, y: 20 }])).toBeNull();
    expect(twoFingerFrame([])).toBeNull();
  });

  test('three fingers are ignored rather than guessed at', () => {
    expect(twoFingerFrame([
      { x: 10, y: 20 },
      { x: 30, y: 40 },
      { x: 50, y: 60 },
    ])).toBeNull();
  });
});

describe('cycling tabs', () => {
  test('next moves one forward and previous one back', () => {
    expect(cycleTab(tabs, 't1', 'next')?.tabId).toBe('t2');
    expect(cycleTab(tabs, 't3', 'previous')?.tabId).toBe('t2');
  });

  test('both ends wrap', () => {
    expect(cycleTab(tabs, 't3', 'next')?.tabId).toBe('t1');
    expect(cycleTab(tabs, 't1', 'previous')?.tabId).toBe('t3');
  });

  test('a full lap in either direction returns to where it started', () => {
    let forward = 't1';
    let backward = 't1';
    for (let step = 0; step < tabs.length; step += 1) {
      forward = cycleTab(tabs, forward, 'next')?.tabId ?? '';
      backward = cycleTab(tabs, backward, 'previous')?.tabId ?? '';
    }
    expect(forward).toBe('t1');
    expect(backward).toBe('t1');
  });

  test('a workspace with one tab has nothing to cycle to', () => {
    expect(canCycleTabs([tabs[0]])).toBe(false);
    expect(cycleTab([tabs[0]], 't1', 'next')).toBeNull();
    expect(cycleTab([tabs[0]], 't1', 'previous')).toBeNull();
  });

  test('a workspace with no tabs cycles nowhere', () => {
    expect(canCycleTabs([])).toBe(false);
    expect(cycleTab([], '', 'next')).toBeNull();
  });

  test('a tab that no longer exists lands on an end rather than nowhere', () => {
    expect(cycleTab(tabs, 'closed', 'next')?.tabId).toBe('t1');
    expect(cycleTab(tabs, 'closed', 'previous')?.tabId).toBe('t3');
  });
});

// A swipe is felt at once but applied once the swiping stops, so during a burst
// the screen's tab is behind the fingers. This is the same P0 the workspace
// switch was fixed for: every landing refetches the session and reopens the
// event stream, so a burst must cost settles, not swipes -- and must still
// arrive where the fingers asked.
describe('cycling during a burst', () => {
  test('with nothing pending it is an ordinary cycle', () => {
    expect(cycleTabFrom(tabs, 't1', null, 'next')?.tabId).toBe('t2');
    expect(cycleTabFrom(tabs, 't1', null, 'previous')?.tabId).toBe('t3');
  });

  test('the next swipe steps from where the fingers got to, not from the screen', () => {
    expect(cycleTabFrom(tabs, 't1', 't2', 'next')?.tabId).toBe('t3');
  });

  test('a burst travels one tab per swipe and wraps like a single one does', () => {
    let pending: string | null = null;
    for (let swipe = 0; swipe < 4; swipe += 1) {
      pending = cycleTabFrom(tabs, 't1', pending, 'next')?.tabId ?? null;
    }
    expect(pending).toBe('t2');
  });

  test('swiping back over a burst returns to the tab it started on', () => {
    let pending: string | null = null;
    for (let swipe = 0; swipe < 5; swipe += 1) {
      pending = cycleTabFrom(tabs, 't1', pending, 'next')?.tabId ?? null;
    }
    for (let swipe = 0; swipe < 5; swipe += 1) {
      pending = cycleTabFrom(tabs, 't1', pending, 'previous')?.tabId ?? null;
    }
    expect(pending).toBe('t1');
  });

  test('two hundred swipes land exactly where two hundred steps should', () => {
    // The bombardment, as arithmetic: whatever the settle timer does with the
    // requests, the destination has to stay honest.
    let pending: string | null = null;
    for (let swipe = 0; swipe < 200; swipe += 1) {
      pending = cycleTabFrom(tabs, 't1', pending, 'next')?.tabId ?? null;
    }
    // Starting at t1 (index 0), 200 steps forward across three tabs.
    expect(pending).toBe(tabs[200 % tabs.length].id);
  });

  test('a pending tab the workspace has lost is ignored, not followed', () => {
    expect(cycleTabFrom(tabs, 't2', 'closed', 'next')?.tabId).toBe('t3');
  });

  test('a lone tab still offers nothing, pending or not', () => {
    expect(cycleTabFrom([tabs[0]], 't1', 't1', 'next')).toBeNull();
  });
});

// The P0 from card #608, as arithmetic. A landing is not free -- it reconciles
// the selection and reads a new pane's output, shortcuts and parts -- so what
// matters is not that the destination is right (above) but that the number of
// landings is bounded by how many times the fingers came to rest, never by how
// many times they moved.
describe('what a burst of swipes costs', () => {
  /**
   * How many landings a burst arriving at these times costs, modelled exactly
   * the way `useTabSwipe` behaves: an immediate swipe commits and cancels any
   * armed timer, a swipe inside the quiet window re-arms it, and whatever is
   * still armed when the fingers stop fires once.
   */
  function landings(times: readonly number[]): number {
    let total = 0;
    let armedAt: number | null = null;
    let previous = Number.NEGATIVE_INFINITY;
    for (const now of times) {
      if (armedAt !== null && armedAt <= now) {
        total += 1;
        armedAt = null;
      }
      if (swipeAppliesImmediately(previous, now)) {
        total += 1;
        armedAt = null;
      } else {
        armedAt = now + TAB_SWIPE_COMMIT_QUIET_MS;
      }
      previous = now;
    }
    return armedAt === null ? total : total + 1;
  }

  test('the quiet window is exactly where it claims to be', () => {
    expect(TAB_SWIPE_COMMIT_QUIET_MS).toBe(320);
    expect(swipeAppliesImmediately(0, TAB_SWIPE_COMMIT_QUIET_MS - 1)).toBe(false);
    expect(swipeAppliesImmediately(0, TAB_SWIPE_COMMIT_QUIET_MS)).toBe(true);
  });

  test('one deliberate swipe lands once, immediately', () => {
    expect(landings([1_000])).toBe(1);
  });

  test('deliberate swipes seconds apart each land on their own', () => {
    expect(landings([0, 1_000, 2_000, 3_000])).toBe(4);
  });

  test('two hundred flicks cost two landings, not two hundred', () => {
    // 200 swipes 20 ms apart: one at the head of the burst, one when the
    // fingers finally stop. This is the bombardment, and the assertion is the
    // whole point of the settle -- at one landing per flick this is 200 session
    // reads queued faster than they retire.
    const burst = Array.from({ length: 200 }, (_, index) => index * 20);
    expect(landings(burst)).toBe(2);
  });

  test('a burst three times as long still costs two landings', () => {
    const burst = Array.from({ length: 600 }, (_, index) => index * 20);
    expect(landings(burst)).toBe(2);
  });

  test('two bursts with a pause between them cost four, not four hundred', () => {
    const first = Array.from({ length: 200 }, (_, index) => index * 20);
    const second = first.map((time) => time + 10_000);
    expect(landings([...first, ...second])).toBe(4);
  });
});

describe('position indicator', () => {
  test('the current position is the one drawn before any swipe', () => {
    expect(tabPosition(tabs, 't3')).toEqual({
      tabId: 't3',
      title: 'Logs',
      position: 3,
      total: 3,
    });
  });

  test('an unknown tab has no position', () => {
    expect(tabPosition(tabs, 'closed')).toBeNull();
  });
});

describe('per-tab pane memory', () => {
  test('a tab comes back on the pane it was left on', () => {
    let memory: TabPaneMemory = {};
    memory = rememberTabPane(memory, { tabId: 't1', paneId: 'p9' });
    memory = rememberTabPane(memory, { tabId: 't2', paneId: 'p4' });
    expect(recallTabPane(memory, 't1')).toBe('p9');
    expect(recallTabPane(memory, 't2')).toBe('p4');
  });

  test('the newest visit wins', () => {
    let memory: TabPaneMemory = {};
    memory = rememberTabPane(memory, { tabId: 't1', paneId: 'p1' });
    memory = rememberTabPane(memory, { tabId: 't1', paneId: 'p2' });
    expect(recallTabPane(memory, 't1')).toBe('p2');
  });

  test('a half-loaded selection does not overwrite what is remembered', () => {
    const memory = rememberTabPane({}, { tabId: 't1', paneId: 'p1' });
    expect(rememberTabPane(memory, { tabId: 't1', paneId: '' })).toBe(memory);
    expect(rememberTabPane(memory, { tabId: '', paneId: 'p7' })).toBe(memory);
    expect(recallTabPane(memory, 't1')).toBe('p1');
  });

  test('an unchanged selection keeps the same object, so no render is caused', () => {
    const memory = rememberTabPane({}, { tabId: 't1', paneId: 'p1' });
    expect(rememberTabPane(memory, { tabId: 't1', paneId: 'p1' })).toBe(memory);
  });

  test('a tab never visited recalls nothing, for the screen to fill in', () => {
    expect(recallTabPane({}, 't3')).toBe('');
  });
});
