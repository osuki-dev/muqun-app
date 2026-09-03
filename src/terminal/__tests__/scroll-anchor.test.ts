// Keeping the reader's place across a frame swap (card #587).
//
// The pane freezes its frame for the length of a gesture, so a release applies
// a whole burst at once instead of a line at a time. That turns what used to be
// an invisible per-frame creep into a visible jump, and this is the arithmetic
// that has to cancel it out. Everything here runs on row signatures, which is
// the only continuity two frames have: a refresh parses a brand-new emulator.
import { describe, expect, test } from 'bun:test';
import {
  TERMINAL_ANCHOR_PROBE_ROWS,
  TERMINAL_ANCHOR_SEARCH_ROWS,
  captureScrollAnchor,
  clampScrollOffset,
  followCatchUpDurationMs,
  historyHintOpacity,
  measureRowsDropped,
  measureRowsPrepended,
  terminalBottomStop,
  terminalContentRows,
  terminalFollowsOutput,
  terminalPullOvershoot,
  terminalRestOffset,
  terminalTopStop,
  TERMINAL_APPLIED_FRAME_MS,
  TERMINAL_FOLLOW_SLACK,
  TERMINAL_HISTORY_HINT_REST_OPACITY,
} from '@/terminal/scroll-anchor';
import { parseTerminalSnapshot } from '@/terminal/terminal-core';
import { DEFAULT_TERMINAL_STYLE, type TerminalLine } from '@/terminal/types';

/** A frame's worth of rows, stubbed down to what the anchor actually reads. */
function rows(signatures: readonly number[]): TerminalLine[] {
  return signatures.map((signature) => ({ cells: [], runs: [], signature }));
}

/** A window of `count` distinct rows starting at `first`, as a rolling buffer does. */
function window(first: number, count: number): TerminalLine[] {
  return rows(Array.from({ length: count }, (_, index) => first + index + 1));
}

describe('measureRowsDropped', () => {
  test('reports nothing dropped when the top of the window has not moved', () => {
    const lines = window(0, 300);
    expect(measureRowsDropped(captureScrollAnchor(lines), lines)).toBe(0);
  });

  test('reports the rows a full window trimmed off the top', () => {
    const before = captureScrollAnchor(window(0, 300));
    expect(measureRowsDropped(before, window(17, 300))).toBe(17);
  });

  test('finds a drop of exactly one row', () => {
    const before = captureScrollAnchor(window(0, 64));
    expect(measureRowsDropped(before, window(1, 64))).toBe(1);
  });

  test('ignores prepended history, which the revision path owns', () => {
    // Pull-to-load puts rows in ABOVE the old top row, so the new top rows are
    // nowhere in the previous frame. Guessing at a drop here would double-count
    // against the compensation the revision path already applied.
    const before = captureScrollAnchor(window(100, 300));
    expect(measureRowsDropped(before, window(60, 340))).toBe(0);
  });

  test('ignores a frame with nothing in common, which is a clear or a switch', () => {
    const before = captureScrollAnchor(window(0, 300));
    expect(measureRowsDropped(before, window(90_000, 300))).toBe(0);
  });

  test('still measures a drop when the row count wobbled', () => {
    // A snapshot that lands mid-line comes back a row short. Skipping those
    // frames would let a burst of drift through, so only the fingerprint
    // decides.
    const before = captureScrollAnchor(window(0, 300));
    expect(measureRowsDropped(before, window(11, 299))).toBe(11);
    expect(measureRowsDropped(before, window(11, 301))).toBe(11);
  });

  test('declines to guess when the fingerprint matches in more than one place', () => {
    // A screenful of blank rows: the probe matches at every offset, so any
    // answer would be a coin toss and the wrong one throws the reader.
    const blank = rows(Array.from({ length: 300 }, () => 0));
    expect(measureRowsDropped(captureScrollAnchor(blank), blank.slice())).toBe(0);
  });

  test('declines when the drop is further than the search reaches', () => {
    const before = captureScrollAnchor(window(0, 600));
    const dropped = TERMINAL_ANCHOR_SEARCH_ROWS + TERMINAL_ANCHOR_PROBE_ROWS + 40;
    expect(measureRowsDropped(before, window(dropped, 600))).toBe(0);
  });

  test('declines on a frame too short to fingerprint', () => {
    const before = captureScrollAnchor(window(0, 3));
    expect(measureRowsDropped(before, window(1, 3))).toBe(0);
    expect(measureRowsDropped(captureScrollAnchor([]), [])).toBe(0);
  });

  test('rewritten rows below the anchor do not read as a drop', () => {
    // The live screen at the bottom of the window is rewritten constantly --
    // a spinner, a progress bar -- while the history above it is fixed. Only
    // the top matters, and it did not move.
    const before = captureScrollAnchor(window(0, 300));
    const after = window(0, 300);
    for (let row = 280; row < 300; row += 1) after[row] = rows([9_000 + row])[0];
    expect(measureRowsDropped(before, after)).toBe(0);
  });

  test('anchors real parsed output through a trim', () => {
    // End to end on actual signatures rather than stubs: same text, same rows,
    // shifted up by the three lines a full window would have dropped.
    const lines = Array.from({ length: 40 }, (_, index) => `line ${index} of output`);
    const before = parseTerminalSnapshot(lines.join('\n'));
    const after = parseTerminalSnapshot(
      [...lines.slice(3), 'line 40 of output', 'line 41', 'line 42'].join('\n')
    );
    expect(after.lines.length).toBe(before.lines.length);
    expect(measureRowsDropped(captureScrollAnchor(before.lines), after.lines)).toBe(3);
  });

  test('anchors COLOURED output through a trim', () => {
    // The case above passes on plain text whatever the signature is made of,
    // because plain text interns nothing. Agent output is colour from end to
    // end, and a row's colours are what used to make its signature depend on
    // the snapshot it was parsed in rather than on the row: scroll the row that
    // first used a colour off the top and every remaining row hashed
    // differently, so the anchor found nothing, returned 0, and left the reader
    // to drift with the stream.
    const palette = [31, 32, 33, 34, 35, 36, 91, 92, 93, 96];
    const line = (index: number) =>
      `[1;${palette[index % palette.length]}mrow ${index}[0m ${'#'.repeat(8 + (index % 7))}`;
    const lines = Array.from({ length: 60 }, (_, index) => line(index));
    const before = parseTerminalSnapshot(lines.join('\n'));
    const after = parseTerminalSnapshot(
      [...lines.slice(4), line(60), line(61), line(62), line(63)].join('\n')
    );
    expect(measureRowsDropped(captureScrollAnchor(before.lines), after.lines)).toBe(4);
  });

  test('recognises a burst larger than the old 256-row search window', () => {
    // The interaction freeze pays a whole gesture in one frame: a streaming
    // pane held for ten seconds rolls past 256 rows, and with the old cap the
    // probe missed, nothing was compensated, and the parked reader was carried
    // toward the bottom by the whole burst on every release.
    const before = captureScrollAnchor(window(0, 3_000));
    expect(measureRowsDropped(before, window(500, 3_000))).toBe(500);
  });
});

describe('measureRowsPrepended', () => {
  test('reports nothing prepended when the top has not moved', () => {
    const lines = window(0, 300);
    expect(measureRowsPrepended(captureScrollAnchor(lines), lines)).toBe(0);
  });

  test('reports zero, not the length delta, for append-only growth', () => {
    // An agent printed forty rows at the bottom between two applied frames.
    // The delta says 40; nothing at all went in above the reader.
    const before = captureScrollAnchor(window(0, 300));
    expect(measureRowsPrepended(before, window(0, 340))).toBe(0);
  });

  test('measures a pure history-page prepend exactly', () => {
    const before = captureScrollAnchor(window(100, 300));
    expect(measureRowsPrepended(before, window(50, 350))).toBe(50);
  });

  test('measures only the prepend when the tail also grew during the fetch', () => {
    // The reported bug, as arithmetic: a page of 50 went in above while the
    // live pane printed 40 more below. The length delta is 90, and shifting by
    // 90 threw the reader 40 rows past their place -- into the clamp, which
    // parked them at the bottom.
    const before = captureScrollAnchor(window(100, 300));
    expect(measureRowsPrepended(before, window(50, 390))).toBe(50);
  });

  test('answers -1, not zero, when the old top is nowhere in the new frame', () => {
    const before = captureScrollAnchor(window(0, 300));
    expect(measureRowsPrepended(before, window(5_000, 300))).toBe(-1);
  });

  test('answers -1 when the probe matches in more than one place', () => {
    // A previous top of repeated rows proves nothing about where the frame
    // moved; the caller falls back to the delta rather than trusting a guess.
    const repeated = rows(Array.from({ length: 40 }, () => 7));
    const before = captureScrollAnchor(repeated);
    expect(measureRowsPrepended(before, rows(Array.from({ length: 80 }, () => 7)))).toBe(-1);
  });

  test('answers -1 for a frame too short to hold the probe', () => {
    const before = captureScrollAnchor(window(0, 300));
    expect(measureRowsPrepended(before, window(0, TERMINAL_ANCHOR_PROBE_ROWS - 1))).toBe(-1);
  });
});

describe('captureScrollAnchor', () => {
  test('keeps only as many leading rows as the search can use', () => {
    const anchor = captureScrollAnchor(window(0, 5_000));
    expect(anchor.rows).toBe(5_000);
    expect(anchor.leading.length).toBe(TERMINAL_ANCHOR_SEARCH_ROWS + TERMINAL_ANCHOR_PROBE_ROWS);
  });

  test('keeps a short frame whole', () => {
    const anchor = captureScrollAnchor(window(0, 9));
    expect(anchor.rows).toBe(9);
    expect(Array.from(anchor.leading)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

// A freshly opened pane's frame (card #829): one prompt line, and the rest of
// the pane's rows blank underneath it because nothing upstream trims them.
describe('terminalContentRows', () => {
  const blank = (signature: number): TerminalLine => ({ cells: [], runs: [], signature });
  const text = (signature: number): TerminalLine => ({
    cells: [{ text: 'x', width: 1, style: DEFAULT_TERMINAL_STYLE }],
    runs: [],
    signature,
  });

  test('counts every row when nothing is blank', () => {
    expect(terminalContentRows([text(1), text(2), text(3)])).toBe(3);
  });

  test('excludes the blank tail of a mostly-empty screen', () => {
    const lines = [text(1), ...Array.from({ length: 55 }, (_, index) => blank(index))];
    expect(terminalContentRows(lines)).toBe(1);
  });

  test('leaves blank rows alone when they are not trailing', () => {
    // Deliberate spacing in the middle of real output must not be trimmed --
    // only the untouched remainder of the screen at the very end is.
    expect(terminalContentRows([text(1), blank(2), text(3)])).toBe(3);
  });

  test('is zero for a screen nothing has been written to at all', () => {
    expect(terminalContentRows([blank(1), blank(2)])).toBe(0);
  });

  test('is zero for no rows at all', () => {
    expect(terminalContentRows([])).toBe(0);
  });
});

describe('followCatchUpDurationMs', () => {
  const lineHeight = 19;

  test('does not animate the ordinary per-refresh step at all', () => {
    // A line or two is what a followed pane moves while nobody is touching it.
    // Easing it is what made a printing pane judder: applied frames land every
    // TERMINAL_APPLIED_FRAME_MS, so an animation is cancelled and restarted from
    // a partial position before it can arrive. The content moving is the scroll;
    // 0 tells the caller to put the pane on the bottom and leave it there.
    expect(followCatchUpDurationMs(lineHeight, lineHeight)).toBe(0);
    expect(followCatchUpDurationMs(2 * lineHeight, lineHeight)).toBe(0);
    expect(followCatchUpDurationMs(0, lineHeight)).toBe(0);
  });

  test('grows with the debt a released gesture pays off in one frame', () => {
    expect(followCatchUpDurationMs(5 * lineHeight, lineHeight)).toBeGreaterThan(0);
    expect(followCatchUpDurationMs(8 * lineHeight, lineHeight)).toBeGreaterThan(
      followCatchUpDurationMs(5 * lineHeight, lineHeight)
    );
  });

  test('stops growing', () => {
    expect(followCatchUpDurationMs(400 * lineHeight, lineHeight)).toBe(220);
  });

  test('an eased debt outlasts a frame interval, which is why it is one-off', () => {
    // Stated rather than implied, because the previous version of this file
    // asserted the opposite by name -- "never still chasing when the next line
    // lands" -- while returning more than twice the interval. The number was
    // right for the case it is now reserved to; what was wrong was starting it
    // on every frame. The caller must not begin a second ease over one in
    // flight, and this test is here so that stays a stated requirement.
    expect(followCatchUpDurationMs(8 * lineHeight, lineHeight)).toBeGreaterThan(
      TERMINAL_APPLIED_FRAME_MS
    );
  });

  test('measures the debt in rows, so a pinched-out pane is not slower', () => {
    expect(followCatchUpDurationMs(5 * 40, 40)).toBe(followCatchUpDurationMs(5 * 12, 12));
  });

  test('reads a catch-up in either direction', () => {
    expect(followCatchUpDurationMs(-6 * lineHeight, lineHeight)).toBe(
      followCatchUpDurationMs(6 * lineHeight, lineHeight)
    );
  });
});

describe('clampScrollOffset', () => {
  test('holds a scrolled reader between the top and the bottom of tall content', () => {
    // Content taller than the viewport: legal offsets run from minimumY (the
    // bottom) up to 0 (the top).
    expect(clampScrollOffset(-300, -900)).toBe(-300);
    expect(clampScrollOffset(-2_000, -900)).toBe(-900);
    expect(clampScrollOffset(120, -900)).toBe(0);
  });

  test('pins short content to its resting offset', () => {
    // Everything fits, so minimumY is the only legal position and the range
    // must not collapse to nothing.
    expect(clampScrollOffset(0, 140)).toBe(140);
    expect(clampScrollOffset(500, 140)).toBe(140);
    expect(clampScrollOffset(-20, 140)).toBe(140);
  });

  test('a drop compensation past the top lands at the top', () => {
    const lineHeight = 19;
    const scale = 1;
    expect(clampScrollOffset(-10 + 40 * lineHeight * scale, -900)).toBe(0);
  });

  test('a full-screen pane stops at its inset instead of at zero', () => {
    expect(clampScrollOffset(500, -900, 108)).toBe(108);
    expect(clampScrollOffset(-300, -900, 108)).toBe(-300);
    expect(clampScrollOffset(-2_000, -900, 108)).toBe(-900);
  });

  // Card #832. A screen-owning pane's screen can be SHORTER than the viewport
  // -- 24 rows in a forty-row pane, which is every session this app opens at
  // tmux's `default-size` -- and then `minimumY` is positive and was the only
  // legal offset there was. The whole editor sat against the bottom edge under
  // a screenful of empty background, and no gesture could move it because there
  // was nowhere legal to move it to.
  test('a screen shorter than the viewport can reach its inset', () => {
    // Measured on the reported pane: viewport 785, content 430, inset 116.
    const minimumY = 785 - 430;
    expect(clampScrollOffset(116, minimumY, 116)).toBe(116);
    expect(clampScrollOffset(0, minimumY, 116)).toBe(116);
    expect(clampScrollOffset(-500, minimumY, 116)).toBe(116);
    // The top stop is unchanged: the reader still cannot drag it down past the
    // bottom edge, which for content this short is above the inset.
    expect(clampScrollOffset(900, minimumY, 116)).toBe(minimumY);
  });

  test('kept history above a short screen lowers the floor with it', () => {
    // `[history] + [screen]`: the floor is where the SCREEN's first row lands
    // at the inset, so it comes down by the history's height.
    expect(clampScrollOffset(-1_000, 355, 116, 400)).toBe(116 - 400);
  });

  test('a printing pane is the expression it always was', () => {
    // No inset, so the history argument cannot reach anything: the floor is the
    // bottom edge for every pane that prints, whatever is passed alongside it.
    for (const minimumY of [-3_804, -900, 0, 140]) {
      for (const history of [0, 400, 4_000]) {
        expect(clampScrollOffset(minimumY - 1, minimumY, 0, history)).toBe(minimumY);
        expect(clampScrollOffset(minimumY, minimumY, 0, history)).toBe(minimumY);
      }
    }
  });
});

// The top inset (card #671). A pane that prints lines wants its newest output
// against the bottom and does not care what is drawn over its oldest; a pane
// running an editor paints a screen whose FIRST row is the one being read, and
// the app's chrome floats over the grid edge to edge. The two numbers below are
// the whole of that difference, and the case that matters most is the one where
// there is no inset -- every existing pane goes through here too.
describe('terminalTopStop', () => {
  test('without an inset it is the bound the file always had', () => {
    expect(terminalTopStop(-900, 0)).toBe(0);
    expect(terminalTopStop(140, 0)).toBe(140);
  });

  test('an inset raises the stop for content taller than the viewport', () => {
    expect(terminalTopStop(-900, 108)).toBe(108);
  });

  test('content that already fits is left where it rests', () => {
    // minimumY above the inset means everything is visible anyway, and the
    // resting offset is still the only legal position.
    expect(terminalTopStop(140, 108)).toBe(140);
  });
});

// The pull-for-earlier-output gesture (card #784): a reader dragging past the
// top stop should get credit for it regardless of whether the *gesture* began
// already resting there or reached the stop mid-drag. The bug this replaced
// gated on `gestureStartY >= -1` -- a snapshot taken once at gesture start --
// so a single continuous scroll that started below the stop and crossed it
// never opened the gate: the drag just held at the clamp with no pull
// registering, however far the reader kept dragging.
describe('terminalPullOvershoot', () => {
  test('a gesture that starts already at rest reduces to plain translationY', () => {
    // gestureStartY === topStop is exactly the pre-existing working case:
    // resting at the top, then dragging down. The overshoot should track the
    // drag one-for-one, matching the old `event.translationY` formula.
    expect(terminalPullOvershoot(0, 0, 0)).toBe(0);
    expect(terminalPullOvershoot(0, 30, 0)).toBe(30);
    expect(terminalPullOvershoot(108, 30, 108)).toBe(30);
  });

  test('a gesture that starts below the stop is not credited until it crosses', () => {
    // This is the bug: mid-scroll, a drag that has not yet reached the stop
    // must not register as a pull.
    expect(terminalPullOvershoot(-500, 100, 0)).toBe(-400);
    expect(terminalPullOvershoot(-500, 499, 0)).toBe(-1);
  });

  test('a single continuous drag that scrolls through the stop registers the moment it crosses', () => {
    // The fix: once cumulative translationY carries the unclamped candidate
    // position past the stop, the same gesture -- never released, never
    // restarted -- is credited with the overshoot past it.
    expect(terminalPullOvershoot(-500, 500, 0)).toBe(0);
    expect(terminalPullOvershoot(-500, 546, 0)).toBe(46);
    expect(terminalPullOvershoot(-500, 600, 0)).toBe(100);
  });

  test('an inset top stop is honoured the same way', () => {
    expect(terminalPullOvershoot(-392, 500, 108)).toBe(0);
    expect(terminalPullOvershoot(-392, 546, 108)).toBe(46);
  });
});

describe('terminalFollowsOutput', () => {
  // A pane that prints rests at the bottom, so "following" and "within a couple
  // of lines of the end" are the same sentence and this must not have changed.
  describe('a printing pane, where rest is the bottom', () => {
    const minimumY = -3804;
    const rest = terminalRestOffset(minimumY, 0);

    test('resting at the bottom follows', () => {
      expect(terminalFollowsOutput(rest, rest)).toBe(true);
    });

    test('a fling that stopped a line or two short still follows', () => {
      expect(terminalFollowsOutput(rest + TERMINAL_FOLLOW_SLACK, rest)).toBe(true);
    });

    test('a reader who scrolled into history has left', () => {
      expect(terminalFollowsOutput(rest + TERMINAL_FOLLOW_SLACK + 1, rest)).toBe(false);
      expect(terminalFollowsOutput(-3000, rest)).toBe(false);
    });
  });

  // The bounce, card #828.
  //
  // A screen-owning pane rests on the top of its live screen rather than on its
  // last line, so `rest` sits ABOVE the bottom by exactly how much the screen
  // (plus the header it clears) overflows the viewport:
  //
  //   rest - minimumY = topInset + screenHeight - visibleHeight
  //
  // Measured live on a phone (card #828): topInset 116, screen 787, visible 743
  // -- a 160pt overflow. The old predicate asked only `offset <= rest + slack`,
  // which is true across that whole overflow AND everything below it, so every
  // drag inside the first ~200pt was still classified as following, the follow
  // ease hauled it back to `rest`, and the reader watched the pane spring back
  // under their thumb. The dead band grows with anything that shrinks the
  // viewport -- the key row, the pane strip, an approval banner, the on-screen
  // keyboard -- which is why it read as a dock problem.
  describe('a screen-owning pane whose live screen overflows the viewport', () => {
    const visibleHeight = 743;
    const topInset = 116;
    const contentHeight = 4547;
    const historyHeight = 3760;
    const minimumY = visibleHeight - contentHeight; // -3804
    const rest = terminalRestOffset(minimumY, topInset, historyHeight); // -3644

    test('the overflow is what lifts rest off the bottom', () => {
      expect(rest - minimumY).toBe(topInset + (contentHeight - historyHeight) - visibleHeight);
      expect(rest).toBe(-3644);
    });

    test('resting still follows', () => {
      expect(terminalFollowsOutput(rest, rest)).toBe(true);
    });

    test('a drag that leaves the anchor by more than the slack has parked', () => {
      // Both directions: the reader who pulled the pane down into the history
      // above the screen, and the one who pushed it up into the screen's own
      // tail. Neither is watching the anchor any more, and neither may be
      // dragged back to it.
      expect(terminalFollowsOutput(rest + TERMINAL_FOLLOW_SLACK + 1, rest)).toBe(false);
      expect(terminalFollowsOutput(rest - TERMINAL_FOLLOW_SLACK - 1, rest)).toBe(false);
    });

    test('the bottom of an overflowing screen is not "following"', () => {
      // This is the regression. `minimumY` is 160pt below the anchor, well
      // outside the slack, and the old one-sided test called it following.
      expect(minimumY).toBeLessThan(rest - TERMINAL_FOLLOW_SLACK);
      expect(terminalFollowsOutput(minimumY, rest)).toBe(false);
    });

    test('no offset in the scroll range is unconditionally following', () => {
      const stop = terminalTopStop(minimumY, topInset);
      const following: number[] = [];
      for (let offset = minimumY; offset <= stop; offset += 1) {
        if (terminalFollowsOutput(offset, rest)) following.push(offset);
      }
      // A band two slacks wide around the anchor, and nothing else -- not the
      // whole 3,920pt range the old predicate accepted.
      expect(following.length).toBe(2 * TERMINAL_FOLLOW_SLACK + 1);
      expect(following[0]).toBe(rest - TERMINAL_FOLLOW_SLACK);
    });
  });

  // The one-sided test is a special case of this one wherever rest is the
  // lowest legal offset, which is every pane that prints. Stated as a property
  // so the equivalence cannot quietly rot.
  test('agrees with the old one-sided test wherever rest is the bottom', () => {
    for (const minimumY of [-3804, -900, -108, 0, 140]) {
      const rest = terminalRestOffset(minimumY, 0);
      for (let offset = minimumY; offset <= terminalTopStop(minimumY, 0); offset += 7) {
        expect(terminalFollowsOutput(offset, rest)).toBe(offset <= rest + TERMINAL_FOLLOW_SLACK);
      }
    }
  });
});

describe('terminalRestOffset', () => {
  test('a printing pane rests at the bottom, following its last line', () => {
    expect(terminalRestOffset(-900, 0)).toBe(-900);
    expect(terminalRestOffset(140, 0)).toBe(140);
  });

  test('an editor rests with its first row clear of the header', () => {
    // Not the bottom: a fixed screen has no last line to follow, and the bottom
    // is exactly where the first row ends up underneath the back button.
    expect(terminalRestOffset(-900, 108)).toBe(108);
  });

  // Card #832: this is where the report came from. A screen shorter than the
  // viewport used to be "unaffected by an inset" -- it rested at `minimumY`,
  // which is the bottom edge, which put the editor's whole screen under the key
  // row with the rest of the pane empty above it. An editor's screen rests
  // under the header whether or not it happens to fill the phone; the blank
  // that opens below a short one is the part of the pane its program is not
  // drawing into, and saying so is the point.
  test('a screen shorter than the viewport still rests under the header', () => {
    expect(terminalRestOffset(140, 108)).toBe(108);
    // Measured on the reported pane: viewport 785, content 430, inset 116.
    expect(terminalRestOffset(785 - 430, 116)).toBe(116);
  });

  test('rest is never above the stop, and never below the floor', () => {
    for (const minimumY of [-900, -108, -20, 0, 60, 140]) {
      for (const inset of [0, 54, 108]) {
        expect(terminalRestOffset(minimumY, inset)).toBeLessThanOrEqual(
          terminalTopStop(minimumY, inset)
        );
        expect(terminalRestOffset(minimumY, inset)).toBeGreaterThanOrEqual(
          terminalBottomStop(minimumY, inset)
        );
      }
    }
  });

  // The ring buffer puts kept history ABOVE the screen, so the content's first
  // row is no longer the screen's first row. Anchoring the content top rested
  // an editor on its oldest kept frame -- a stale screen at rest, card #675.
  describe('with ring-buffer history above the screen', () => {
    test('the anchor comes down by exactly the height of the history', () => {
      expect(terminalRestOffset(-900, 108, 400)).toBe(108 - 400);
    });

    test('the anchor is the screen top wherever the screen sits', () => {
      // Stated over consistent geometry rather than over free numbers: history
      // is a part of the content, so `historyHeight <= contentHeight` always,
      // and the anchor is `topInset - historyHeight` on both sides of the
      // bottom edge. Below it exactly when the screen is shorter than the
      // viewport under the header, which is the case card #832 came from.
      const topInset = 108;
      for (const visibleHeight of [420, 785, 1_100]) {
        for (const historyHeight of [0, 400, 3_760]) {
          for (const screenHeight of [190, 430, 1_600]) {
            const minimumY = visibleHeight - (historyHeight + screenHeight);
            const rest = terminalRestOffset(minimumY, topInset, historyHeight);
            expect(rest).toBe(topInset - historyHeight);
            expect(rest - minimumY).toBe(topInset + screenHeight - visibleHeight);
            // However far below the bottom edge it lands, it is never further
            // than the blank the screen genuinely leaves under itself.
            expect(minimumY - rest).toBeLessThan(visibleHeight);
          }
        }
      }
    });

    test('no history is the old expression exactly', () => {
      expect(terminalRestOffset(-900, 108, 0)).toBe(terminalRestOffset(-900, 108));
      // A negative height is a caller bug, not a licence to rest above the stop.
      expect(terminalRestOffset(-900, 108, -50)).toBe(108);
    });

    test('a printing pane has no inset and rests at the bottom regardless', () => {
      expect(terminalRestOffset(-900, 0, 400)).toBe(-900);
    });

    test('the rest still sits within the legal scroll range', () => {
      for (const minimumY of [-900, -108, 0, 140]) {
        for (const history of [0, 60, 400, 2_000]) {
          const rest = terminalRestOffset(minimumY, 108, history);
          expect(rest).toBeLessThanOrEqual(terminalTopStop(minimumY, 108));
          expect(rest).toBeGreaterThanOrEqual(terminalBottomStop(minimumY, 108, history));
          // And the range the clamp enforces is the one the rest lives in, so
          // the anchor is somewhere a gesture can actually put the pane.
          expect(clampScrollOffset(rest, minimumY, 108, history)).toBe(rest);
        }
      }
    });
  });
});

// The pull-for-earlier hint (card #627). Its opacity used to be
// `pullDistance / 22`, which is 0 whenever nobody is pulling: a pane with a
// thousand rows of history behind it looked exactly like a pane with none, and
// the only way to learn that paging existed was to perform it.
describe('historyHintOpacity', () => {
  test('the hint is visible before anyone touches the pane', () => {
    expect(historyHintOpacity(0, false)).toBe(TERMINAL_HISTORY_HINT_REST_OPACITY);
    expect(historyHintOpacity(0, false)).toBeGreaterThan(0.2);
  });

  test('it brightens with the pull and stops at solid', () => {
    const rest = historyHintOpacity(0, false);
    const part = historyHintOpacity(11, false);
    const full = historyHintOpacity(22, false);
    expect(part).toBeGreaterThan(rest);
    expect(full).toBeGreaterThan(part);
    expect(full).toBe(1);
    expect(historyHintOpacity(200, false)).toBe(1);
  });

  test('a page in flight is solid whatever the finger is doing', () => {
    expect(historyHintOpacity(0, true)).toBe(1);
    expect(historyHintOpacity(90, true)).toBe(1);
  });

  test('an overscroll the other way does not dim the hint below rest', () => {
    expect(historyHintOpacity(-40, false)).toBe(TERMINAL_HISTORY_HINT_REST_OPACITY);
  });

  // The pill used to sit at rest opacity forever, which is how it was reported:
  // the same sentence over every pane, permanently, reads as chrome rather than
  // as an offer. It now says its piece on arrival and gets out of the way.
  describe('the arrival fade', () => {
    test('it is lit on arrival at a pane', () => {
      expect(historyHintOpacity(0, false, 1)).toBe(TERMINAL_HISTORY_HINT_REST_OPACITY);
    });

    test('it fades to nothing once it has been seen', () => {
      expect(historyHintOpacity(0, false, 0)).toBe(0);
      expect(historyHintOpacity(0, false, 0.5)).toBeCloseTo(TERMINAL_HISTORY_HINT_REST_OPACITY / 2);
    });

    test('pulling brings it back whether or not the intro is over', () => {
      // The gesture goes on working after the pill leaves, so what the gesture
      // answers with must not depend on how long the pane has been open.
      expect(historyHintOpacity(11, false, 0)).toBeGreaterThan(0.4);
      expect(historyHintOpacity(22, false, 0)).toBe(1);
      expect(historyHintOpacity(22, false, 1)).toBe(1);
      expect(historyHintOpacity(200, false, 0)).toBe(1);
    });

    test('a page in flight is solid even after the intro has gone', () => {
      expect(historyHintOpacity(0, true, 0)).toBe(1);
    });

    test('the intro is what every existing caller already gets', () => {
      // The parameter defaults to 1, so the behaviour asserted above this block
      // is the behaviour of a pane that has just been opened.
      expect(historyHintOpacity(0, false)).toBe(historyHintOpacity(0, false, 1));
      expect(historyHintOpacity(11, false)).toBe(historyHintOpacity(11, false, 1));
    });
  });
});
