// The rule these tests are a fence around: a cache may remove a blank, and it
// may never invent a row.
//
// Everything the pane cache holds is a window `foldPaneRead` already folded,
// so the way it can hurt is not by folding wrongly -- it never folds -- but by
// handing back a window that is no longer true and saying nothing, or by
// letting a reply that was overtaken in flight write itself in as the truth.
// Both of those are revision arithmetic, and both are here. The bounds are the
// third thing that can be wrong quietly: a cache that grows without one is a
// leak nobody notices until a pane has been paged back two thousand lines.
import { describe, expect, test } from 'bun:test';

import {
  type PaneCacheBounds,
  type PaneWindow,
  emptyPaneCache,
  foldPaneFrame,
  warmPaneWindow,
  forgetPaneWindow,
  notePaneRevision,
  panePrefetchAccepted,
  panePrefetchTargets,
  paneReadIsCurrent,
  paneWindowIsCurrent,
  paneWindowWorthFiling,
  recallPaneWindow,
  rememberPaneWindow,
  retainPanes,
} from '../pane-cache';
import { foldPaneRead } from '../../terminal/history';

/** The shape every window in these tests is of, unless one is being contrasted with another. */
const ANSI = 'ansi:recent-unwrapped';

function windowOf(output: string, revision = 1, extra: Partial<PaneWindow> = {}): PaneWindow {
  return {
    shape: ANSI,
    output,
    lineLimit: 240,
    revision,
    canLoadEarlier: false,
    earlierRows: 12,
    rangeUnsupported: false,
    lastRead: null,
    ...extra,
  };
}

/** Small enough that eviction is reachable without building strings by the megabyte. */
const BOUNDS: PaneCacheBounds = { panes: 3, characters: 100 };

const paneIdsOf = (cache: { entries: readonly { paneId: string }[] }) =>
  cache.entries.map((entry) => entry.paneId);

describe('remembering and recalling', () => {
  test('a window comes back exactly as it went in', () => {
    const held = windowOf('rows', 7, { lineLimit: 720, canLoadEarlier: true, lastRead: { a: 1 } });
    const cache = rememberPaneWindow(emptyPaneCache, 'p1', held);
    expect(recallPaneWindow(cache, 'p1', ANSI)).toEqual(held);
  });

  test('a pane nobody remembers recalls as nothing, and so does the empty id', () => {
    expect(recallPaneWindow(emptyPaneCache, 'p1', ANSI)).toBeNull();
    expect(
      recallPaneWindow(rememberPaneWindow(emptyPaneCache, 'p1', windowOf('a')), '', ANSI)
    ).toBeNull();
  });

  test('remembering a pane twice replaces rather than duplicates it', () => {
    let cache = rememberPaneWindow(emptyPaneCache, 'p1', windowOf('old', 1));
    cache = rememberPaneWindow(cache, 'p1', windowOf('new', 2));
    expect(cache.entries).toHaveLength(1);
    expect(recallPaneWindow(cache, 'p1', ANSI)?.output).toBe('new');
  });

  // A pane can change shape while nobody is looking -- a shell hands its tty to
  // an editor -- and a window restored across that change is escape sequences
  // in a reading view.
  test('a window of another shape is not handed back', () => {
    const cache = rememberPaneWindow(emptyPaneCache, 'p1', windowOf('rows'));
    expect(recallPaneWindow(cache, 'p1', 'text:visible')).toBeNull();
    expect(recallPaneWindow(cache, 'p1', ANSI)?.output).toBe('rows');
  });

  test('a reshaped window replaces the one held under the old shape', () => {
    let cache = rememberPaneWindow(emptyPaneCache, 'p1', windowOf('rows'));
    cache = rememberPaneWindow(cache, 'p1', windowOf('screen', 1, { shape: 'text:visible' }));
    expect(cache.entries).toHaveLength(1);
    expect(recallPaneWindow(cache, 'p1', ANSI)).toBeNull();
    expect(recallPaneWindow(cache, 'p1', 'text:visible')?.output).toBe('screen');
  });

  // Recall runs during the render that paints the switch, so it must not write.
  test('recall does not reorder the cache', () => {
    let cache = rememberPaneWindow(emptyPaneCache, 'p1', windowOf('a'));
    cache = rememberPaneWindow(cache, 'p2', windowOf('b'));
    recallPaneWindow(cache, 'p1', ANSI);
    expect(paneIdsOf(cache)).toEqual(['p2', 'p1']);
  });
});

// A pane is left twice when a program takes the screen: once on the way into
// the alternate screen and once on the way out, with the same pane id on both
// sides. The cache holds one window per pane, so what is filed on the way out
// decides whether the scrollback filed on the way in is still there to hand
// back. Filing the program's last frame was the blank after `less` quit.
describe('leaving the alternate screen', () => {
  const MAIN = `${ANSI}:main`;
  const ALT = `${ANSI}:alt`;
  const rows = (from: number, to: number) =>
    Array.from({ length: to - from }, (_, index) => String(from + index)).join('\n');

  /** The switch block's rule, driven the way the workspace drives it. */
  function turn(
    cache: ReturnType<typeof rememberPaneWindow>,
    leaving: string,
    arriving: string,
    held: PaneWindow
  ) {
    return paneWindowWorthFiling(leaving, arriving, held.shape.endsWith(':alt'))
      ? rememberPaneWindow(cache, leaving, held)
      : cache;
  }

  test('the scrollback filed on the way in comes back whole on the way out', () => {
    const scrollback = windowOf(rows(0, 480), 3, {
      shape: MAIN,
      lineLimit: 480,
      canLoadEarlier: true,
      earlierRows: 480,
      lastRead: { start: 100, end: 580 },
    });
    // In: the shell's window is filed under the same pane id.
    let cache = turn(emptyPaneCache, 'p1', 'p1', scrollback);
    expect(recallPaneWindow(cache, 'p1', ALT)).toBeNull();
    // Out: the program's last frame is not, so the scrollback is still there.
    const frame = windowOf('~\n~\n:q', 9, { shape: ALT, lineLimit: 240, earlierRows: 3 });
    cache = turn(cache, 'p1', 'p1', frame);
    expect(cache.entries).toHaveLength(1);
    expect(recallPaneWindow(cache, 'p1', MAIN)).toEqual(scrollback);
  });

  test('the way in still files the scrollback, whatever the pane held before', () => {
    const cache = turn(emptyPaneCache, 'p1', 'p1', windowOf('$ less notes', 1, { shape: MAIN }));
    expect(recallPaneWindow(cache, 'p1', MAIN)?.output).toBe('$ less notes');
  });

  // The #33 hit: leave an editor pane for another pane and come back to it
  // still running, and its frame is painted from the cache.
  test('a real switch away from an editor pane still files its frame', () => {
    let cache = turn(emptyPaneCache, 'p1', 'p1', windowOf('$ nvim', 1, { shape: MAIN }));
    const frame = windowOf('~\n~\n-- INSERT --', 4, { shape: ALT });
    cache = turn(cache, 'p1', 'p2', frame);
    expect(recallPaneWindow(cache, 'p1', ALT)).toEqual(frame);
    expect(recallPaneWindow(cache, 'p1', MAIN)).toBeNull();
  });

  // What the refresh that follows the restore does with rows the shell printed
  // while the program had the screen. The window comes back exactly as it was
  // filed, and the fold is the same one door -- so the tail is stitched when
  // the read reaches back into the window, and goes on top when it does not.
  test('rows printed behind the program are folded on top of the restored window, once', () => {
    const scrollback = windowOf(rows(0, 480), 3, { shape: MAIN, lineLimit: 480 });
    let cache = turn(emptyPaneCache, 'p1', 'p1', scrollback);
    cache = turn(cache, 'p1', 'p1', windowOf('~\n:q', 5, { shape: ALT }));
    const restored = recallPaneWindow(cache, 'p1', MAIN);
    expect(restored).not.toBeNull();

    // More than a page (240) printed, and the refresh at the restored depth
    // still reaches back into what the window holds.
    const stitched = foldPaneRead(restored!.output, rows(300, 780), 'refresh', restored!.lineLimit);
    expect(stitched).toBe(rows(300, 780));

    // So much printed that the refresh shares nothing with the window: it is
    // the newest thing there is and goes on top, bounded to the depth held.
    const outran = foldPaneRead(restored!.output, rows(600, 1080), 'refresh', restored!.lineLimit);
    expect(outran).toBe(rows(600, 1080));

    for (const window of [stitched, outran]) {
      const numbers = window.split('\n').map(Number);
      expect(new Set(numbers).size).toBe(numbers.length);
      expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
    }
  });
});

describe('bounds', () => {
  test('the least recently used pane is the one evicted by the count bound', () => {
    let cache = emptyPaneCache;
    for (const paneId of ['p1', 'p2', 'p3', 'p4']) {
      cache = rememberPaneWindow(cache, paneId, windowOf(paneId), BOUNDS);
    }
    expect(paneIdsOf(cache)).toEqual(['p4', 'p3', 'p2']);
    expect(recallPaneWindow(cache, 'p1', ANSI)).toBeNull();
  });

  test('re-remembering a pane moves it back to the front, so it survives the next eviction', () => {
    let cache = emptyPaneCache;
    for (const paneId of ['p1', 'p2', 'p3']) {
      cache = rememberPaneWindow(cache, paneId, windowOf(paneId), BOUNDS);
    }
    cache = rememberPaneWindow(cache, 'p1', windowOf('p1 again'), BOUNDS);
    cache = rememberPaneWindow(cache, 'p4', windowOf('p4'), BOUNDS);
    expect(paneIdsOf(cache)).toEqual(['p4', 'p1', 'p3']);
  });

  test('the byte bound evicts even when the count bound is satisfied', () => {
    let cache = rememberPaneWindow(emptyPaneCache, 'p1', windowOf('x'.repeat(60)), BOUNDS);
    cache = rememberPaneWindow(cache, 'p2', windowOf('y'.repeat(60)), BOUNDS);
    expect(paneIdsOf(cache)).toEqual(['p2']);
  });

  test('a window bigger than the whole budget is not stored, and takes the older copy with it', () => {
    let cache = rememberPaneWindow(emptyPaneCache, 'p1', windowOf('small'), BOUNDS);
    cache = rememberPaneWindow(cache, 'p2', windowOf('keep me'), BOUNDS);
    cache = rememberPaneWindow(cache, 'p1', windowOf('x'.repeat(200)), BOUNDS);
    expect(recallPaneWindow(cache, 'p1', ANSI)).toBeNull();
    expect(recallPaneWindow(cache, 'p2', ANSI)?.output).toBe('keep me');
  });

  test('the pane just written always survives its own write', () => {
    const cache = rememberPaneWindow(emptyPaneCache, 'p1', windowOf('x'.repeat(99)), BOUNDS);
    expect(recallPaneWindow(cache, 'p1', ANSI)?.output).toHaveLength(99);
  });

  test('an empty pane id is not cacheable', () => {
    expect(rememberPaneWindow(emptyPaneCache, '', windowOf('a'))).toBe(emptyPaneCache);
  });
});

describe('revision ordering', () => {
  // The defect this group is a fence around: one number cannot say both "the
  // revision this window holds" and "the revision this pane has reached".
  // While it tried to, news that a pane had printed while nobody was looking
  // marked its stale window as the whole truth -- the exact opposite of what
  // the news meant.
  test('a stream revision marks the window overtaken without touching it', () => {
    const cache = notePaneRevision(
      rememberPaneWindow(emptyPaneCache, 'p1', windowOf('a', 3)),
      'p1',
      9
    );
    expect(recallPaneWindow(cache, 'p1', ANSI)).toMatchObject({ output: 'a', revision: 3 });
    expect(paneWindowIsCurrent(cache, 'p1', 3)).toBe(false);
  });

  test('news never moves backwards, whatever order the events land in', () => {
    let cache = rememberPaneWindow(emptyPaneCache, 'p1', windowOf('a', 9));
    cache = notePaneRevision(cache, 'p1', 4);
    expect(paneWindowIsCurrent(cache, 'p1', 9)).toBe(true);
  });

  test('a window written while news was in flight does not un-hear it', () => {
    let cache = rememberPaneWindow(emptyPaneCache, 'p1', windowOf('a', 1));
    cache = notePaneRevision(cache, 'p1', 7);
    cache = rememberPaneWindow(cache, 'p1', windowOf('later', 4));
    expect(paneWindowIsCurrent(cache, 'p1', 4)).toBe(false);
    cache = rememberPaneWindow(cache, 'p1', windowOf('latest', 7));
    expect(paneWindowIsCurrent(cache, 'p1', 7)).toBe(true);
  });

  test('a revision for an uncached pane creates nothing', () => {
    expect(notePaneRevision(emptyPaneCache, 'p1', 9)).toBe(emptyPaneCache);
  });

  test('a window is current only up to the revision it was folded to', () => {
    const cache = rememberPaneWindow(emptyPaneCache, 'p1', windowOf('a', 5));
    expect(paneWindowIsCurrent(cache, 'p1', 5)).toBe(true);
    expect(paneWindowIsCurrent(cache, 'p1', 4)).toBe(true);
    expect(paneWindowIsCurrent(cache, 'p1', 6)).toBe(false);
  });

  // Guessing "current" with nothing to compare would leave stale output up for
  // as long as the reader stayed away.
  test('an unversioned pane on either side is never called current', () => {
    expect(
      paneWindowIsCurrent(rememberPaneWindow(emptyPaneCache, 'p1', windowOf('a', -1)), 'p1', 3)
    ).toBe(false);
    expect(
      paneWindowIsCurrent(rememberPaneWindow(emptyPaneCache, 'p1', windowOf('a', 3)), 'p1', -1)
    ).toBe(false);
    expect(paneWindowIsCurrent(emptyPaneCache, 'p1', 3)).toBe(false);
  });
});

describe('stale replies', () => {
  // Measured against the window, not against the news: news carries no text,
  // so refusing real text on the strength of it would leave the cache holding
  // something older than the reply it just threw away.
  test('a reply older than the window already held is refused', () => {
    const cache = rememberPaneWindow(emptyPaneCache, 'p1', windowOf('a', 7));
    expect(paneReadIsCurrent(cache, 'p1', 6)).toBe(false);
    expect(paneReadIsCurrent(cache, 'p1', 7)).toBe(true);
    expect(paneReadIsCurrent(cache, 'p1', 8)).toBe(true);
  });

  test('a reply for a pane nothing is held for is accepted', () => {
    expect(paneReadIsCurrent(emptyPaneCache, 'p1', 2)).toBe(true);
  });

  test('a gateway that versions nothing is never refused', () => {
    const cache = rememberPaneWindow(emptyPaneCache, 'p1', windowOf('a', 7));
    expect(paneReadIsCurrent(cache, 'p1', -1)).toBe(true);
  });
});

describe('frames for a pane nobody is looking at', () => {
  // The caller's own fold, stubbed: this module supplies none and must not
  // start having an opinion about what a folded window looks like.
  const append = (text: string) => (held: string, lineLimit: number) =>
    `${held}+${text}@${lineLimit}`;

  test('a frame folds into the remembered window and carries its revision forward', () => {
    const cache = rememberPaneWindow(emptyPaneCache, 'p1', windowOf('rows', 4, { lineLimit: 720 }));
    const next = foldPaneFrame(notePaneRevision(cache, 'p1', 5), 'p1', ANSI, 5, append('more'));
    expect(recallPaneWindow(next, 'p1', ANSI)).toMatchObject({
      output: 'rows+more@720',
      revision: 5,
      lineLimit: 720,
    });
    // Folded, so the window is caught up again and the next switch back to it
    // needs nothing from the network.
    expect(paneWindowIsCurrent(next, 'p1', 5)).toBe(true);
  });

  // The other half of the same story: news the fold could not act on leaves the
  // window honestly marked as behind, so the warm-up goes and gets it.
  test('a frame refused for its shape leaves the window marked overtaken', () => {
    const cache = notePaneRevision(
      rememberPaneWindow(emptyPaneCache, 'p1', windowOf('rows', 4)),
      'p1',
      5
    );
    const next = foldPaneFrame(cache, 'p1', 'text:visible', 5, append('more'));
    expect(recallPaneWindow(next, 'p1', ANSI)?.output).toBe('rows');
    expect(paneWindowIsCurrent(next, 'p1', 5)).toBe(false);
  });

  test('a pane nothing is held for is not created by a frame', () => {
    expect(foldPaneFrame(emptyPaneCache, 'p1', ANSI, 5, append('more'))).toBe(emptyPaneCache);
  });

  test('a frame of another shape is refused', () => {
    const cache = rememberPaneWindow(emptyPaneCache, 'p1', windowOf('rows', 4));
    expect(foldPaneFrame(cache, 'p1', 'text:visible', 5, append('more'))).toBe(cache);
  });

  test('a frame older than the window already held is refused', () => {
    const cache = rememberPaneWindow(emptyPaneCache, 'p1', windowOf('rows', 9));
    expect(foldPaneFrame(cache, 'p1', ANSI, 5, append('more'))).toBe(cache);
  });

  test('an unversioned frame folds without inventing a revision', () => {
    const cache = rememberPaneWindow(emptyPaneCache, 'p1', windowOf('rows', 4));
    const next = foldPaneFrame(cache, 'p1', ANSI, -1, append('more'));
    expect(recallPaneWindow(next, 'p1', ANSI)).toMatchObject({
      output: 'rows+more@240',
      revision: 4,
    });
  });

  test('a fold that changes nothing leaves the cache identical', () => {
    const cache = rememberPaneWindow(emptyPaneCache, 'p1', windowOf('rows', 4));
    expect(foldPaneFrame(cache, 'p1', ANSI, 4, (held) => held)).toBe(cache);
  });

  // A pane still printing while the reader is elsewhere is the case this whole
  // path exists for, so its window must stay the most recently used one.
  test('a folded pane moves to the front of the cache', () => {
    let cache = rememberPaneWindow(emptyPaneCache, 'p1', windowOf('a', 1));
    cache = rememberPaneWindow(cache, 'p2', windowOf('b', 1));
    const next = foldPaneFrame(cache, 'p1', ANSI, 2, append('more'));
    expect(paneIdsOf(next)).toEqual(['p1', 'p2']);
  });
});

describe('warming a pane the reader has already paged', () => {
  // The defect: the warm-up wrote its first page over whatever was remembered,
  // so a pane the reader had paged five pages back and then left came back at
  // one page and their paging was silently undone. A warm-up exists to remove a
  // blank, and there is no blank behind a window that is already deeper.
  test('a warm-up does not shallow out a deeper window', () => {
    const deep = windowOf('paged', 4, { lineLimit: 1200, canLoadEarlier: true });
    const cache = rememberPaneWindow(emptyPaneCache, 'p1', deep);
    const warmed = warmPaneWindow(cache, 'p1', windowOf('one page', 9, { lineLimit: 240 }));
    expect(recallPaneWindow(warmed, 'p1', ANSI)).toMatchObject({
      output: 'paged',
      lineLimit: 1200,
    });
  });

  test('a warm-up still fills a pane nothing is held for', () => {
    const warmed = warmPaneWindow(emptyPaneCache, 'p1', windowOf('one page', 2));
    expect(recallPaneWindow(warmed, 'p1', ANSI)?.output).toBe('one page');
  });

  test('a warm-up refreshes a window no deeper than itself', () => {
    const cache = rememberPaneWindow(emptyPaneCache, 'p1', windowOf('stale', 2));
    const warmed = warmPaneWindow(cache, 'p1', windowOf('fresh', 5));
    expect(recallPaneWindow(warmed, 'p1', ANSI)).toMatchObject({ output: 'fresh', revision: 5 });
  });

  // A window of another shape is not a deeper reading of this one, so it is no
  // reason to refuse the warm-up.
  test('depth held under another shape does not block a warm-up', () => {
    const other = windowOf('screen', 4, { lineLimit: 1200, shape: 'text:visible' });
    const cache = rememberPaneWindow(emptyPaneCache, 'p1', other);
    const warmed = warmPaneWindow(cache, 'p1', windowOf('one page', 5, { lineLimit: 240 }));
    expect(recallPaneWindow(warmed, 'p1', ANSI)?.output).toBe('one page');
  });
});

describe('a pane that goes away', () => {
  test('forgetting drops it, and is a no-op for a pane not held', () => {
    const cache = rememberPaneWindow(emptyPaneCache, 'p1', windowOf('a'));
    expect(recallPaneWindow(forgetPaneWindow(cache, 'p1'), 'p1', ANSI)).toBeNull();
    expect(forgetPaneWindow(cache, 'p2')).toBe(cache);
  });

  // A closed pane's id can be reused, so aging out is not good enough.
  test('retaining keeps only the panes the session still lists', () => {
    let cache = rememberPaneWindow(emptyPaneCache, 'p1', windowOf('a'));
    cache = rememberPaneWindow(cache, 'p2', windowOf('b'));
    cache = rememberPaneWindow(cache, 'p3', windowOf('c'));
    const kept = retainPanes(cache, ['p3', 'p1']);
    expect(paneIdsOf(kept)).toEqual(['p3', 'p1']);
    expect(retainPanes(kept, ['p3', 'p1'])).toBe(kept);
  });
});

describe('prefetch', () => {
  const ring = ['p1', 'p2', 'p3', 'p4'];
  const unversioned = () => -1;

  test('both neighbours in the ring, wrapping at either end', () => {
    expect(panePrefetchTargets(ring, 'p1', emptyPaneCache, unversioned)).toEqual(['p2', 'p4']);
    expect(panePrefetchTargets(ring, 'p4', emptyPaneCache, unversioned)).toEqual(['p1', 'p3']);
  });

  test('a ring of two yields one neighbour rather than the same pane twice', () => {
    expect(panePrefetchTargets(['p1', 'p2'], 'p1', emptyPaneCache, unversioned)).toEqual(['p2']);
  });

  test('a ring of one, and a selection the ring does not contain, warm nothing', () => {
    expect(panePrefetchTargets(['p1'], 'p1', emptyPaneCache, unversioned)).toEqual([]);
    expect(panePrefetchTargets(ring, 'gone', emptyPaneCache, unversioned)).toEqual([]);
  });

  test('a neighbour already current is not fetched again', () => {
    const cache = rememberPaneWindow(emptyPaneCache, 'p2', windowOf('a', 5));
    const revisions = (paneId: string) => (paneId === 'p2' ? 5 : -1);
    expect(panePrefetchTargets(ring, 'p1', cache, revisions)).toEqual(['p4']);
  });

  test('a neighbour the stream has moved past is fetched again', () => {
    const cache = rememberPaneWindow(emptyPaneCache, 'p2', windowOf('a', 5));
    const revisions = (paneId: string) => (paneId === 'p2' ? 6 : -1);
    expect(panePrefetchTargets(ring, 'p1', cache, revisions)).toEqual(['p2', 'p4']);
  });

  test('a prefetch is accepted only by the generation that issued it', () => {
    expect(panePrefetchAccepted(3, 3)).toBe(true);
    expect(panePrefetchAccepted(3, 4)).toBe(false);
  });
});
