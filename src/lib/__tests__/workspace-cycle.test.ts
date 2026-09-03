// What a swipe on the title is allowed to do, as assertions.
//
// The gesture itself cannot be tested here, so everything it decides is kept
// out of the screen: which workspace a direction lands on, that both ends wrap,
// that a lone workspace offers nothing to cycle to, and that a workspace comes
// back on the pane it was left on.
import { describe, expect, test } from 'bun:test';

import {
  canCycleWorkspaces,
  cycleWorkspace,
  cycleWorkspaceFrom,
  recallWorkspaceSelection,
  rememberWorkspaceSelection,
  swipeDirection,
  SWIPE_DISTANCE,
  SWIPE_VELOCITY,
  workspacePosition,
  workspaceSwitchDirection,
  type WorkspaceMemory,
} from '../workspace-cycle';

const workspaces = [
  { id: 'wE', title: 'api' },
  { id: 'wG', title: '.ws' },
  { id: 'wM', title: 'muqun' },
  { id: 'wN', title: '.osuki' },
];

describe('cycling', () => {
  test('next moves one forward', () => {
    expect(cycleWorkspace(workspaces, 'wE', 'next')?.workspaceId).toBe('wG');
  });

  test('previous moves one back', () => {
    expect(cycleWorkspace(workspaces, 'wM', 'previous')?.workspaceId).toBe('wG');
  });

  test('next wraps past the last workspace', () => {
    expect(cycleWorkspace(workspaces, 'wN', 'next')?.workspaceId).toBe('wE');
  });

  test('previous wraps before the first workspace', () => {
    expect(cycleWorkspace(workspaces, 'wE', 'previous')?.workspaceId).toBe('wN');
  });

  test('a full lap in either direction returns to where it started', () => {
    let forward = 'wE';
    let backward = 'wE';
    for (let step = 0; step < workspaces.length; step += 1) {
      forward = cycleWorkspace(workspaces, forward, 'next')?.workspaceId ?? '';
      backward = cycleWorkspace(workspaces, backward, 'previous')?.workspaceId ?? '';
    }
    expect(forward).toBe('wE');
    expect(backward).toBe('wE');
  });

  test('a single workspace has nothing to cycle to', () => {
    expect(canCycleWorkspaces([workspaces[0]])).toBe(false);
    expect(cycleWorkspace([workspaces[0]], 'wE', 'next')).toBeNull();
    expect(cycleWorkspace([workspaces[0]], 'wE', 'previous')).toBeNull();
  });

  test('an empty session cycles nowhere', () => {
    expect(canCycleWorkspaces([])).toBe(false);
    expect(cycleWorkspace([], '', 'next')).toBeNull();
  });

  test('two workspaces toggle, both directions', () => {
    const pair = workspaces.slice(0, 2);
    expect(cycleWorkspace(pair, 'wE', 'next')?.workspaceId).toBe('wG');
    expect(cycleWorkspace(pair, 'wG', 'next')?.workspaceId).toBe('wE');
    expect(cycleWorkspace(pair, 'wE', 'previous')?.workspaceId).toBe('wG');
  });

  test('a workspace that no longer exists lands on an end rather than nowhere', () => {
    expect(cycleWorkspace(workspaces, 'gone', 'next')?.workspaceId).toBe('wE');
    expect(cycleWorkspace(workspaces, 'gone', 'previous')?.workspaceId).toBe('wN');
  });
});

// A swipe is felt at once but applied once the swiping stops, so during a burst
// the screen's workspace is behind the finger. These are the assertions that a
// burst still travels as far as it was swiped -- the reason five fast flicks
// used to move one workspace, and the reason the crash fix does not cost the
// gesture its accuracy.
describe('cycling during a burst', () => {
  test('with nothing pending it is an ordinary cycle', () => {
    expect(cycleWorkspaceFrom(workspaces, 'wE', null, 'next')?.workspaceId).toBe('wG');
    expect(cycleWorkspaceFrom(workspaces, 'wE', null, 'previous')?.workspaceId).toBe('wN');
  });

  test('the next swipe steps from where the finger got to, not from the screen', () => {
    expect(cycleWorkspaceFrom(workspaces, 'wE', 'wG', 'next')?.workspaceId).toBe('wM');
  });

  test('a burst travels one workspace per swipe', () => {
    let pending: string | null = null;
    for (let swipe = 0; swipe < 3; swipe += 1) {
      pending = cycleWorkspaceFrom(workspaces, 'wE', pending, 'next')?.workspaceId ?? null;
    }
    expect(pending).toBe('wN');
  });

  test('a burst wraps at the end like a single swipe does', () => {
    let pending: string | null = null;
    for (let swipe = 0; swipe < 5; swipe += 1) {
      pending = cycleWorkspaceFrom(workspaces, 'wE', pending, 'next')?.workspaceId ?? null;
    }
    expect(pending).toBe('wG');
  });

  test('swiping back over a burst returns to the workspace it started on', () => {
    let pending: string | null = null;
    for (let swipe = 0; swipe < 3; swipe += 1) {
      pending = cycleWorkspaceFrom(workspaces, 'wE', pending, 'next')?.workspaceId ?? null;
    }
    for (let swipe = 0; swipe < 3; swipe += 1) {
      pending = cycleWorkspaceFrom(workspaces, 'wE', pending, 'previous')?.workspaceId ?? null;
    }
    expect(pending).toBe('wE');
  });

  test('a pending workspace the session has lost is ignored, not followed', () => {
    expect(cycleWorkspaceFrom(workspaces, 'wM', 'closed', 'next')?.workspaceId).toBe('wN');
  });

  test('a lone workspace still offers nothing, pending or not', () => {
    expect(cycleWorkspaceFrom([workspaces[0]], 'wE', 'wE', 'next')).toBeNull();
  });
});

describe('position indicator', () => {
  test('the current position is the one drawn before any swipe', () => {
    expect(workspacePosition(workspaces, 'wN')).toEqual({
      workspaceId: 'wN',
      title: '.osuki',
      position: 4,
      total: 4,
    });
  });

  test('an unknown workspace has no position', () => {
    expect(workspacePosition(workspaces, 'gone')).toBeNull();
  });
});

describe('what counts as a swipe', () => {
  test('a leftward drag is next, a rightward one is previous', () => {
    expect(swipeDirection(-80, 4, 0)).toBe('next');
    expect(swipeDirection(80, -4, 0)).toBe('previous');
  });

  test('a short drag is not a swipe', () => {
    expect(swipeDirection(-10, 0, 0)).toBeNull();
  });

  test('a short flick still counts', () => {
    expect(swipeDirection(-18, 2, -900)).toBe('next');
  });

  test('a flick with no travel at all is ignored', () => {
    expect(swipeDirection(-4, 0, -1200)).toBeNull();
  });

  test('a mostly vertical drag is never a workspace switch', () => {
    expect(swipeDirection(-60, 140, -600)).toBeNull();
  });

  // The thresholds are pinned rather than described, because this worklet's
  // closure is captured once on the UI thread: a constant that arrives there
  // undefined makes every comparison false and the swipe silently dead, which
  // only a device shows. These assertions at least fail loudly if a value moves.
  test('the distance threshold is exactly where it claims to be', () => {
    expect(SWIPE_DISTANCE).toBe(44);
    expect(swipeDirection(-(SWIPE_DISTANCE - 1), 0, 0)).toBeNull();
    expect(swipeDirection(-SWIPE_DISTANCE, 0, 0)).toBe('next');
  });

  test('the flick threshold is exactly where it claims to be', () => {
    expect(SWIPE_VELOCITY).toBe(420);
    expect(swipeDirection(-20, 0, -(SWIPE_VELOCITY - 1))).toBeNull();
    expect(swipeDirection(-20, 0, -SWIPE_VELOCITY)).toBe('next');
  });
});

describe('per-workspace memory', () => {
  test('a workspace comes back on the pane it was left on', () => {
    let memory: WorkspaceMemory = {};
    memory = rememberWorkspaceSelection(memory, {
      workspaceId: 'wM',
      tabId: 'wM:t3',
      paneId: 'wM:t3.p2',
    });
    memory = rememberWorkspaceSelection(memory, {
      workspaceId: 'wN',
      tabId: 'wN:t1',
      paneId: 'wN:t1.p1',
    });

    expect(recallWorkspaceSelection(memory, 'wM')).toEqual({
      workspaceId: 'wM',
      tabId: 'wM:t3',
      paneId: 'wM:t3.p2',
    });
  });

  test('the newest visit wins', () => {
    let memory: WorkspaceMemory = {};
    memory = rememberWorkspaceSelection(memory, { workspaceId: 'wM', tabId: 't1', paneId: 'p1' });
    memory = rememberWorkspaceSelection(memory, { workspaceId: 'wM', tabId: 't2', paneId: 'p2' });
    expect(recallWorkspaceSelection(memory, 'wM').paneId).toBe('p2');
  });

  test('a half-loaded selection does not overwrite what is remembered', () => {
    const memory = rememberWorkspaceSelection(
      {},
      {
        workspaceId: 'wM',
        tabId: 't1',
        paneId: 'p1',
      }
    );
    const after = rememberWorkspaceSelection(memory, {
      workspaceId: 'wM',
      tabId: '',
      paneId: '',
    });
    expect(after).toBe(memory);
    expect(recallWorkspaceSelection(after, 'wM').paneId).toBe('p1');
  });

  test('an unchanged selection keeps the same object, so no render is caused', () => {
    const memory = rememberWorkspaceSelection(
      {},
      {
        workspaceId: 'wM',
        tabId: 't1',
        paneId: 'p1',
      }
    );
    expect(
      rememberWorkspaceSelection(memory, { workspaceId: 'wM', tabId: 't1', paneId: 'p1' })
    ).toBe(memory);
  });

  test('a workspace never visited recalls an empty candidate for the screen to fill in', () => {
    expect(recallWorkspaceSelection({}, 'wE')).toEqual({
      workspaceId: 'wE',
      tabId: '',
      paneId: '',
    });
  });
});

// A workspace can change without a swipe -- the panels sheet, a notification's
// deep link, the gateway reconciling its own focus -- and the title carousel
// needs a direction for those too, or it does not play at all and the title
// swaps between two frames.
describe('the direction of a switch nobody swiped', () => {
  test('one step forward is next', () => {
    expect(workspaceSwitchDirection(workspaces, 'wE', 'wG')).toBe('next');
  });

  test('one step back is previous', () => {
    expect(workspaceSwitchDirection(workspaces, 'wM', 'wG')).toBe('previous');
  });

  test('the short way round wins: last to first is forward, not three back', () => {
    expect(workspaceSwitchDirection(workspaces, 'wN', 'wE')).toBe('next');
  });

  test('and first to last is backward, not three forward', () => {
    expect(workspaceSwitchDirection(workspaces, 'wE', 'wN')).toBe('previous');
  });

  test('exactly half way round is called next, so the answer never depends on which end you counted from', () => {
    expect(workspaceSwitchDirection(workspaces, 'wE', 'wM')).toBe('next');
    expect(workspaceSwitchDirection(workspaces, 'wM', 'wE')).toBe('next');
  });

  test('staying put has no direction, so nothing plays', () => {
    expect(workspaceSwitchDirection(workspaces, 'wM', 'wM')).toBeNull();
  });

  test('a workspace the session has since closed has no direction worth animating', () => {
    expect(workspaceSwitchDirection(workspaces, 'gone', 'wM')).toBeNull();
    expect(workspaceSwitchDirection(workspaces, 'wM', 'gone')).toBeNull();
  });
});
