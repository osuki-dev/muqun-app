// The pane window and where it ends.
//
// These assertions existed only in `scripts/test-terminal.ts`, which nothing
// runs: the gate is `bun test src/terminal`. That is how a pagination
// regression reached a device with every check green (card #627), so the rules
// live here now, where the gate can see them.
//
// Two questions are pinned. `mergeTerminalWindow` is how a poll at the initial
// limit folds into a window the reader has already paged wider -- get it wrong
// and every poll throws their history away. `hasEarlierTerminalOutput` is the
// whole of `canLoadEarlier`: answer it `false` and the pull affordance never
// appears and the gesture branch is never entered, which is what "pagination
// stopped working" looks like from the outside.
import { describe, expect, test } from 'bun:test';

import {
  applyTerminalFrame,
  foldPaneRead,
  hasEarlierAfterPage,
  hasEarlierTerminalOutput,
  mergeTerminalWindow,
  nextPageRange,
  paneReadRange,
  seedPageRange,
  terminalOutputLineCount,
  terminalScrollbackRows,
  terminalViewportRows,
} from '../history';

const MAXIMUM = 2_000;

function lines(count: number): string {
  return Array.from({ length: count }, (_, index) => String(index)).join('\n');
}

describe('merging one window into another', () => {
  test('an overlapping tail is stitched, not repeated', () => {
    expect(mergeTerminalWindow('1\n2\n3\n4', '3\n4\n5\n6', 8)).toBe('1\n2\n3\n4\n5\n6');
  });

  test('a window with nothing in common replaces what it overlaps', () => {
    expect(mergeTerminalWindow('1\n2\n3\n4', 'next\nprompt', 4)).toBe('1\n2\nnext\nprompt');
  });

  test('the merged window is bounded', () => {
    expect(mergeTerminalWindow('1\n2\n3\n4', '3\n4\n5\n6', 5)).toBe('2\n3\n4\n5\n6');
  });

  test('a poll at the initial limit does not shrink a window paged wider', () => {
    // The regression this exists for: `refreshOutput` always re-reads 240 lines
    // whatever the reader paged to, and `applyPaneOutput` merges that back into
    // the wider window. A merge that dropped to the incoming length would undo
    // every page on the next poll, one second later.
    const paged = lines(480);
    const poll = paged.split('\n').slice(-240).join('\n');
    expect(mergeTerminalWindow(paged, poll, 480)).toBe(paged);
  });

  test('a poll that grew by a line costs the top exactly that line', () => {
    const paged = lines(480);
    const poll = [...paged.split('\n').slice(-239), 'new'].join('\n');
    const merged = mergeTerminalWindow(paged, poll, 480);
    expect(merged.split('\n')).toHaveLength(480);
    expect(merged.split('\n').at(-1)).toBe('new');
    expect(merged.split('\n')[0]).toBe('1');
  });

  test('an empty side is the other side, trimmed', () => {
    expect(mergeTerminalWindow('', '1\n2\n3', 2)).toBe('2\n3');
    expect(mergeTerminalWindow('1\n2\n3', '', 2)).toBe('2\n3');
  });

  test('a trailing newline is not a line', () => {
    expect(terminalOutputLineCount('1\n2\n')).toBe(2);
    expect(terminalOutputLineCount('')).toBe(0);
  });
});

// Folding whichever shape of read arrives into the window the reader has
// (card #675). A zero-scrollback pane answers an HTTP read as the gateway's
// ring window -- history + the screen as last seen -- while an SSE inline
// frame carries the raw screen alone. `setOutput(value)` treated both as the
// whole truth, so the window collapsed to one screen on every stream frame and
// re-grew on the next one-second poll: a reader parked in the history had the
// rows deleted out from under them, once a second, which on a device reads as
// the pane scrolling itself.
describe('applying one read of a pane to the window on screen', () => {
  /** A ring window: `history` numbered rows with a screen of `screen` rows under them. */
  const windowOf = (history: number, screen: readonly string[]) =>
    [...Array.from({ length: history }, (_, index) => `history ${index}`), ...screen].join('\n');

  const screen = Array.from({ length: 23 }, (_, index) => `row ${index}`);

  test('a raw screen frame repaints the tail without shrinking the window', () => {
    const current = windowOf(100, screen);
    const repainted = [...screen.slice(0, 11), 'row 11 CHANGED', ...screen.slice(12)];
    const applied = applyTerminalFrame(current, repainted.join('\n'), 240);
    expect(applied).toBe(windowOf(100, repainted));
  });

  test('an unchanged screen adds nothing', () => {
    const current = windowOf(100, screen);
    expect(applyTerminalFrame(current, screen.join('\n'), 240)).toBe(current);
  });

  test('a screen that scrolled keeps what rolled off the top', () => {
    const current = windowOf(40, screen);
    const scrolled = [...screen.slice(2), 'row 23', 'row 24'];
    const applied = applyTerminalFrame(current, scrolled.join('\n'), 240);
    expect(applied).toBe(windowOf(40, [...screen.slice(0, 2), ...scrolled]));
  });

  test('one filler-row coincidence does not append a copy of the screen', () => {
    // The reason placement is scored from the widest overlap down: an editor
    // screen whose first row is a `~` filler, against a window whose last kept
    // row is also `~`, "matches" at overlap 1 -- and believing the smallest
    // overlap would grow the window by a whole screen per repaint.
    const fillerEdged = ['~', ...screen.slice(1, 22), '~'];
    const current = windowOf(60, fillerEdged);
    const repainted = ['~', 'row 1 CHANGED', ...screen.slice(2, 22), '~'];
    const applied = applyTerminalFrame(current, repainted.join('\n'), 240);
    expect(applied.split('\n')).toHaveLength(60 + 23);
    expect(applied).toBe(windowOf(60, repainted));
  });

  test('the first read of a pane becomes the window whole', () => {
    // All that is left of `replaceTerminalWindow`, which used to be what *every*
    // HTTP read did, on the theory that it was the gateway's authoritative ring
    // window. That theory died with card #721: the ring has been off since
    // 1.2.0, and a refresh of a `max_offset_from_bottom: 0` pane comes back as
    // one screen whether it is asked for 240 rows or 2000. A reader holding
    // nothing still takes the read whole -- there is nothing to place it
    // against -- and that is the only unconditional replace left in the file.
    const wider = windowOf(50, screen);
    expect(foldPaneRead('', wider, 'refresh', 240)).toBe(wider);
    expect(foldPaneRead('', 'x\ny\nz', 'frame', 240)).toBe('x\ny\nz');
  });

  test('a frame as long as the window is still only a frame', () => {
    // Card #712: authority used to be inferred from length, so an SSE frame of
    // a pane whose window had not yet grown past one screen replaced it every
    // time and the history never started accumulating.
    const current = screen.join('\n');
    const scrolled = [...screen.slice(3), 'row 23', 'row 24', 'row 25'];
    const applied = applyTerminalFrame(current, scrolled.join('\n'), 240);
    expect(applied.split('\n')).toHaveLength(screen.length + 3);
    expect(applied.split('\n')[0]).toBe('row 0');
    expect(applied.split('\n').at(-1)).toBe('row 25');
  });

  test('a screen with nothing in common is kept on top of the one it followed', () => {
    // Output moved further than one read can be followed: the two screens are
    // consecutive content, and dropping either would lose real rows. Same
    // answer the gateway's ring buffer gives.
    const current = windowOf(4, ['old 1', 'old 2', 'old 3', 'old 4']);
    const applied = applyTerminalFrame(current, 'new 1\nnew 2\nnew 3', 240);
    expect(applied).toBe(`${current}\nnew 1\nnew 2\nnew 3`);
  });

  test('the window stays bounded', () => {
    const current = windowOf(200, screen);
    const repainted = [...screen.slice(0, 22), 'row 22 CHANGED'];
    const applied = applyTerminalFrame(current, repainted.join('\n'), 120);
    const rows = applied.split('\n');
    expect(rows).toHaveLength(120);
    expect(rows.at(-1)).toBe('row 22 CHANGED');
  });

  test('an empty side is the other side, trimmed', () => {
    expect(applyTerminalFrame('', '1\n2\n3', 2)).toBe('2\n3');
    expect(applyTerminalFrame('1\n2\n3', '', 2)).toBe('2\n3');
  });

  test('a tiny overlap has to agree outright', () => {
    // Below the ratio floor a percentage means nothing: two of three rows
    // agreeing is not evidence, so nothing is dropped and the read stacks.
    const current = 'a\nb\nc\nd\ne\nf';
    expect(applyTerminalFrame(current, 'e\nX\ng', 240)).toBe(`${current}\ne\nX\ng`);
    expect(applyTerminalFrame(current, 'e\nf\ng', 240)).toBe('a\nb\nc\nd\ne\nf\ng');
  });

  // The P0 the anchored placement exists for. An agent pane pins a composer
  // under the transcript and scrolls only what is above it, so the aligned
  // overlap always mismatches by the height of the box: past about nineteen
  // rows of scroll per read no overlap clears the ratio at all, and every frame
  // was kept whole on top of a window that already held most of it.
  const BOX_ROWS = 8;
  const TRANSCRIPT_ROWS = 56;

  /** One frame of a Claude pane: a scrolling transcript, a timer that repaints
   * every read, and a composer pinned to the bottom that never scrolls. */
  const agentScreen = (top: number, tick: number) =>
    [
      ...Array.from(
        { length: TRANSCRIPT_ROWS - 1 },
        (_, index) => `transcript row ${top + index} of the answer`
      ),
      `Recombobulating... (${tick}s, down ${tick * 13}k tokens)`,
      '',
      '-'.repeat(100),
      '> ',
      '-'.repeat(100),
      '  auto mode on, esc to interrupt',
      '',
      '  main',
      `  general-purpose  running ${tick % 3} tools`,
    ].join('\n');

  /** Rows a duplicate would be visible in: long, and carrying a word rather
   * than a rule -- a composer draws the same rule above and below its prompt. */
  const duplicatedRows = (output: string) => {
    const counts = new Map<string, number>();
    for (const row of output.split('\n')) {
      const trimmed = row.trim();
      if (trimmed.length > 20 && /[\p{L}\p{N}]/u.test(trimmed)) {
        counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
      }
    }
    return [...counts.entries()].filter(([, count]) => count > 1);
  };

  test('a pinned composer does not make every frame a new screen', () => {
    for (const scroll of [1, 5, 19, 20, 30, 40, 50]) {
      let window = agentScreen(0, 0);
      for (let poll = 1; poll < 12; poll += 1) {
        window = applyTerminalFrame(window, agentScreen(poll * scroll, poll), MAXIMUM);
      }
      expect(duplicatedRows(window)).toEqual([]);
      // Every transcript row the pane showed, kept once, under one composer.
      expect(window.split('\n')).toHaveLength(TRANSCRIPT_ROWS + 11 * scroll + BOX_ROWS);
      expect(window.split('\n')[0]).toBe('transcript row 0 of the answer');
    }
  });

  test('a pinned composer matching itself is not a placement', () => {
    // At full overlap the composer lines up with itself -- eight agreeing rows,
    // sixty rows from the head of the read. Believing that would throw away
    // every transcript row that scrolled.
    const window = applyTerminalFrame(agentScreen(0, 0), agentScreen(50, 1), MAXIMUM);
    expect(window.split('\n')).toHaveLength(TRANSCRIPT_ROWS + 50 + BOX_ROWS);
    expect(window.split('\n')[0]).toBe('transcript row 0 of the answer');
  });

  test('rows that scroll back into view are taken down again', () => {
    // A long line re-wraps and rows the window already promoted into history
    // are on the screen again. Writing them a second time is the rest of the
    // duplication once the composer is handled.
    let window = applyTerminalFrame(agentScreen(0, 0), agentScreen(12, 1), MAXIMUM);
    expect(window.split('\n')).toHaveLength(TRANSCRIPT_ROWS + 12 + BOX_ROWS);
    window = applyTerminalFrame(window, agentScreen(0, 2), MAXIMUM);
    expect(duplicatedRows(window)).toEqual([]);
    expect(window.split('\n')).toHaveLength(TRANSCRIPT_ROWS + BOX_ROWS);
  });

  test('output that really repeats itself is kept every time', () => {
    // A test suite printing the same row per case: identical content is not
    // evidence of a re-send, and collapsing it invents a history the pane never
    // had. The old rule lined the repeat's own period up with itself at full
    // overlap, cleared the ratio, and threw the window away every read.
    const printed: string[] = [];
    let window = '';
    for (let round = 0; round < 12; round += 1) {
      printed.push(`-- case ${round} of the suite --`, '  ok', '  ok', '  ok', '  ok');
      const screen = printed.slice(Math.max(0, printed.length - 20)).join('\n');
      window = window ? applyTerminalFrame(window, screen, MAXIMUM) : screen;
    }
    expect(window.split('\n')).toEqual(printed);
  });

  test('a frame no placement believed is not appended twice', () => {
    // The floor under everything else: whatever the window verbatim ends with
    // is not written down again, whatever the placement thought.
    const window = applyTerminalFrame(
      'keep me\ntail 1\ntail 2\ntail 3',
      'tail 1\ntail 2\ntail 3\nq\nw\ne\nr\nt\ny\nu\ni\no\np\na\ns',
      MAXIMUM
    );
    const rows = window.split('\n');
    expect(rows.filter((row) => row === 'tail 1')).toHaveLength(1);
    expect(rows.filter((row) => row === 'tail 3')).toHaveLength(1);
    expect(rows[0]).toBe('keep me');
    expect(rows.at(-1)).toBe('s');
  });

  test('a watched agent pane never grows a duplicate', () => {
    // The failure as the pane actually lives it: quiet spells where only the
    // timer turns, bursts past where the ratio gives up, and a jump that
    // outran the poll entirely.
    let window = agentScreen(0, 0);
    let top = 0;
    for (let poll = 1; poll < 200; poll += 1) {
      const scroll = [0, 0, 0, 2, 2, 24, 24, 24, 47, 3][poll % 10];
      top += scroll;
      window = applyTerminalFrame(window, agentScreen(top, poll), MAXIMUM);
    }
    expect(duplicatedRows(window)).toEqual([]);
    // Every row the pane produced, kept once, up to the window's own ceiling.
    expect(window.split('\n')).toHaveLength(
      Math.min(MAXIMUM, TRANSCRIPT_ROWS + top + BOX_ROWS)
    );
  });
});

// Card #795, defect 2: a detected nvim pane rendered two stacked copies of
// its own screen -- confirmed via `history_size = 0` panes that the second
// screenshot really did carry no scrollback to explain a second frame from.
// The placement heuristics above are built for a pane that *prints and
// scrolls* -- an agent's transcript, a shell's log -- where two reads sharing
// no rows really are two different pieces of history and belong stacked. A
// pane that owns the screen (an editor's alternate-screen redraw) is not that:
// every read is the *whole* of its current screen, not a tail of a growing
// log, so when nvim's statusline or cursor line changes enough to defeat the
// overlap search, "nothing overlapped, so it must be new" is the wrong
// conclusion -- there is no "new" for a screen to have, only "next", and the
// entire fresh screen was being appended under the stale one, byte for byte
// the two-nvim-frames screenshot in the card.
describe('a screen-owning pane replaces rather than accumulates (card #795, defect 2)', () => {
  test('a repaint with nothing in common replaces the old screen instead of stacking under it', () => {
    const before = 'COMMAND  1  AGENTS.md  84,1  84%\nline 84\nline 85\nline 86\nline 87\nline 88\nline 89';
    const after = '# AGENTS\nline 1\nline 2\n...\nline 15\nCOMMAND  1  AGENTS.md  1,1  1%';
    expect(foldPaneRead(before, after, 'refresh', 240, true)).toBe(after);
    expect(applyTerminalFrame(before, after, 240, true)).toBe(after);
  });

  test('an ordinary overlapping repaint still just replaces -- there is no history to preserve above it', () => {
    const before = 'row 0\nrow 1\nrow 2 CHANGED';
    const after = 'row 0\nrow 1\nrow 2';
    expect(foldPaneRead(before, after, 'frame', 240, true)).toBe(after);
  });

  test('an empty read changes nothing, even for a screen-owning pane', () => {
    expect(foldPaneRead('row 0\nrow 1', '', 'frame', 240, true)).toBe('row 0\nrow 1');
  });

  test('the first read of a screen-owning pane becomes the window whole', () => {
    expect(foldPaneRead('', 'row 0\nrow 1', 'frame', 240, true)).toBe('row 0\nrow 1');
  });

  test('a pane that does not own the screen is completely unaffected (default false)', () => {
    // The governing rule: nothing about a working pane may change. Omitting
    // the parameter must be indistinguishable from before it existed.
    const current = 'old 1\nold 2\nold 3\nold 4';
    expect(foldPaneRead(current, 'new 1\nnew 2\nnew 3', 'frame', 240)).toBe(
      `${current}\nnew 1\nnew 2\nnew 3`
    );
    expect(applyTerminalFrame(current, 'new 1\nnew 2\nnew 3', 240)).toBe(
      `${current}\nnew 1\nnew 2\nnew 3`
    );
  });
});

describe("the pane's own viewport rows", () => {
  test('reads the metric', () => {
    expect(terminalViewportRows({ max_offset_from_bottom: 0, viewport_rows: 23 })).toBe(23);
    expect(terminalViewportRows({ viewport_rows: 65.9 })).toBe(65);
  });

  test('is absent rather than guessed at', () => {
    for (const scroll of [
      undefined,
      null,
      'lots',
      [],
      {},
      { viewport_rows: 0 },
      { viewport_rows: -3 },
      { viewport_rows: Number.NaN },
      { viewport_rows: 'many' },
      { max_offset_from_bottom: 908 },
    ]) {
      expect(terminalViewportRows(scroll)).toBeNull();
    }
  });
});

describe("the gateway's scrollback metric", () => {
  test('is the rows above the viewport plus the viewport itself', () => {
    expect(terminalScrollbackRows({ max_offset_from_bottom: 908, viewport_rows: 65 })).toBe(973);
  });

  test('is absent rather than guessed at when the block is not a metric', () => {
    for (const scroll of [
      undefined,
      null,
      'lots',
      [],
      {},
      { max_offset_from_bottom: 908 },
      { viewport_rows: 65 },
      { max_offset_from_bottom: -1, viewport_rows: 65 },
      { max_offset_from_bottom: Number.NaN, viewport_rows: 65 },
      { max_offset_from_bottom: 908, viewport_rows: 'many' },
    ]) {
      expect(terminalScrollbackRows(scroll)).toBeNull();
    }
  });
});

describe('whether there is anything earlier to load', () => {
  test('the metric is preferred over counting the lines that came back', () => {
    // 239 newline-delimited lines from a 240-row read: the pane wraps, so
    // counting lines would call this the end of history when 973 rows exist.
    expect(
      hasEarlierTerminalOutput(lines(239), 240, MAXIMUM, {
        max_offset_from_bottom: 908,
        viewport_rows: 65,
      })
    ).toBe(true);
  });

  test('a known scrollback end stops the pull', () => {
    expect(
      hasEarlierTerminalOutput(lines(394), 480, MAXIMUM, {
        max_offset_from_bottom: 331,
        viewport_rows: 63,
      })
    ).toBe(false);
  });

  test('paging stays open all the way up to the client maximum', () => {
    const scroll = { max_offset_from_bottom: 4_000, viewport_rows: 65 };
    for (const limit of [240, 480, 720, 960, 1_200, 1_440, 1_680, 1_920]) {
      expect(hasEarlierTerminalOutput(lines(limit - 1), limit, MAXIMUM, scroll)).toBe(true);
    }
  });

  test('the client maximum is the end, whatever the pane holds', () => {
    expect(
      hasEarlierTerminalOutput('output', MAXIMUM, MAXIMUM, {
        max_offset_from_bottom: 4_000,
        viewport_rows: 65,
      })
    ).toBe(false);
  });

  test('a gateway too old to report metrics still gets a pull', () => {
    expect(hasEarlierTerminalOutput(lines(239), 240, MAXIMUM, undefined)).toBe(true);
  });

  test('a short pane on an old gateway is the whole pane', () => {
    expect(hasEarlierTerminalOutput(lines(30), 240, MAXIMUM, undefined)).toBe(false);
  });
});

describe('a page that brought nothing back retires the pull (#646)', () => {
  // Measured on the loopback fleet: a pane reporting 2765 rows of scrollback
  // (max_offset_from_bottom 2700 + viewport 65) plateaued at 992 returned
  // lines. Every read past that point came back byte-identical, so the reader
  // could pull at 1200, 1440, 1680 and 1920 and be told there was more each
  // time. `max_offset_from_bottom` is a display-row count and is not a promise
  // about what `output` will hand over.
  const overstated = { max_offset_from_bottom: 2_700, viewport_rows: 65 };

  test('the metric alone goes on promising history that never arrives', () => {
    // Unchanged, and deliberately so: this is the gateway's answer, and the
    // first read has no evidence to weigh against it.
    expect(hasEarlierTerminalOutput(lines(992), 1_200, MAXIMUM, overstated)).toBe(true);
  });

  test('a page no longer than the one before it is the end', () => {
    expect(
      hasEarlierAfterPage(lines(992), 1_200, MAXIMUM, overstated, 992)
    ).toBe(false);
    // Not merely equal: a window that came back shorter is just as final.
    expect(
      hasEarlierAfterPage(lines(960), 1_200, MAXIMUM, overstated, 992)
    ).toBe(false);
  });

  test('a page that did reach further back keeps the pull', () => {
    expect(
      hasEarlierAfterPage(lines(960), 960, MAXIMUM, overstated, 720)
    ).toBe(true);
  });

  test('reaching further back does not override the metric saying stop', () => {
    // Both conditions have to hold. A pane whose scrollback genuinely ends is
    // still at its end even though this page was longer than the last.
    expect(
      hasEarlierAfterPage(lines(394), 480, MAXIMUM, {
        max_offset_from_bottom: 331,
        viewport_rows: 65,
      }, 240)
    ).toBe(false);
  });

  test('the first page has nothing to compare against and behaves as before', () => {
    expect(
      hasEarlierAfterPage(lines(239), 240, MAXIMUM, {
        max_offset_from_bottom: 908,
        viewport_rows: 65,
      }, 0)
    ).toBe(true);
  });
});

describe('the absolute range a read reports', () => {
  test('a range at the top says there is nothing above it', () => {
    const read = { range: { start: 0, end: 500, total: 500 } };
    expect(paneReadRange(read)).toEqual({ start: 0, end: 500, total: 500 });
  });

  test('a malformed range is no range at all', () => {
    expect(paneReadRange({ range: { start: 'x', end: 1, total: 2 } })).toBeNull();
    expect(paneReadRange({})).toBeNull();
    expect(paneReadRange(null)).toBeNull();
  });
});

describe('a range decides whether there is more, once there is one', () => {
  test('a range decides "more above" without consulting line counts', () => {
    // The measured path would say no here: the page came back no longer than the
    // previous one. The range says the top has not been reached, and it is right.
    const read = { range: { start: 400, end: 900, total: 900 } };
    expect(hasEarlierAfterPage('a\nb', 500, 5000, null, 2, read)).toBe(true);
  });

  test('start at zero is the top', () => {
    const read = { range: { start: 0, end: 500, total: 900 } };
    expect(hasEarlierAfterPage('a\nb', 500, 5000, null, 0, read)).toBe(false);
  });

  test('without a range it still measures', () => {
    // herdr, and gateways older than range addressing.
    expect(hasEarlierAfterPage('a\nb', 500, 5000, null, 2, null)).toBe(false);
  });
});

describe('the next page above the one held', () => {
  test('the next page is the one above the page held, and they do not overlap', () => {
    expect(nextPageRange({ start: 900 }, 500)).toEqual({ start: 400, end: 900 });
  });

  test('the next page stops at the top instead of going negative', () => {
    expect(nextPageRange({ start: 300 }, 500)).toEqual({ start: 0, end: 300 });
  });

  test('there is no page above the top', () => {
    expect(nextPageRange({ start: 0 }, 500)).toBeNull();
  });

  test('a page above the window is folded in ahead of it, losing no row', () => {
    // foldPaneRead takes (currentOutput, latestOutput, origin, maximumLines).
    // 'rangePage' -- not 'page' -- is the one origin allowed to claim depth on
    // zero overlap: a disjoint range-addressed page shares no text with the
    // window by construction, so an older page folded in lands above it.
    const window = 'l4\nl5';
    const olderPage = 'l1\nl2\nl3';
    expect(foldPaneRead(window, olderPage, 'rangePage', 100)).toBe('l1\nl2\nl3\nl4\nl5');
  });
});

describe('only a genuine range page may be believed with zero overlap', () => {
  // The bug a review caught: 'page' -- the widening tail -- and 'rangePage' --
  // a disjoint absolute span -- were once the same origin. A widening-tail
  // read that legitimately found no overlap (a burst of output outran what
  // one read can follow) is the newest thing there is and belongs on top; a
  // range-addressed page belongs above the window instead. Collapsing the two
  // silently reversed chronological order for every 'page' read that lost its
  // overlap, which is exactly the read herdr panes and older gateways still
  // make. This pins the boundary so it cannot move again without a test
  // noticing.
  const window = 'l4\nl5';
  const unrelated = 'x1\nx2\nx3';

  test('a widening-tail read that found no overlap is still newest and goes on top', () => {
    expect(foldPaneRead(window, unrelated, 'page', 100)).toBe('l4\nl5\nx1\nx2\nx3');
  });

  test('a refresh that found no overlap is still newest and goes on top', () => {
    expect(foldPaneRead(window, unrelated, 'refresh', 100)).toBe('l4\nl5\nx1\nx2\nx3');
  });

  test('a frame that found no overlap is still newest and goes on top', () => {
    expect(foldPaneRead(window, unrelated, 'frame', 100)).toBe('l4\nl5\nx1\nx2\nx3');
  });

  test('only a range page with no overlap is believed to reach further back', () => {
    expect(foldPaneRead(window, unrelated, 'rangePage', 100)).toBe('x1\nx2\nx3\nl4\nl5');
  });
});

describe('seeding the first page from the pane record when there is no range yet', () => {
  test('the seed is where the held tail began: total minus what it asked for', () => {
    expect(
      seedPageRange({ max_offset_from_bottom: 900, viewport_rows: 100 }, 240)
    ).toEqual({ start: 760 });
  });

  test('the seed does not go negative when the tail already covers everything', () => {
    expect(
      seedPageRange({ max_offset_from_bottom: 50, viewport_rows: 10 }, 240)
    ).toEqual({ start: 0 });
  });

  test('missing either metric seeds nothing', () => {
    expect(seedPageRange(null, 240)).toBeNull();
    expect(seedPageRange({ max_offset_from_bottom: 900 }, 240)).toBeNull();
    expect(seedPageRange({ viewport_rows: 100 }, 240)).toBeNull();
  });
});

describe('a range page does not open a gap when eviction runs between pages', () => {
  // The hole a review caught: the reader pages once, landing correctly. The
  // pane keeps printing, and every `'refresh'` fold after that evicts one
  // paged-in line off the top to hold the window at its cap -- `foldPaneRead`
  // trims from the top, by construction. A served range remembered from page
  // one is a fact about the instant it landed, and never hears about that
  // eviction: asking above it a second time targets the span above the line
  // eviction just took, not above where the window now begins. A
  // `'rangePage'` shares no text with the window by construction, so the
  // zero-overlap branch prepends the stale span anyway -- the gap in between
  // is never fetched, and nothing about the fold looks wrong from either
  // side. Seeding every page from the pane's *live* scroll metrics, not only
  // the first, closes it: `total - currentLimit` is the true top whether or
  // not anything was evicted since the page before landed.
  const PAGE = 240;
  const label = (line: number): string => `line ${line}`;
  const transcript = (total: number): string[] =>
    Array.from({ length: total }, (_, line) => label(line));
  const scrollFor = (total: number, viewportRows = 63): unknown => ({
    max_offset_from_bottom: total - viewportRows,
    viewport_rows: viewportRows,
  });

  test('a seed recomputed from the live total lands exactly where the window begins; the remembered served start does not', () => {
    let total = 1_000;
    let currentLimit = 240;
    let window = transcript(total).slice(-currentLimit).join('\n');

    // Page 1: the ordinary first page, seeded from the pane record because
    // there is no served range yet.
    const nextLimit1 = currentLimit + PAGE;
    const seed1 = seedPageRange(scrollFor(total), currentLimit);
    if (!seed1) throw new Error('seed1 should not be null');
    const page1 = nextPageRange(seed1, PAGE);
    if (!page1) throw new Error('page1 should not be null');
    window = foldPaneRead(
      window,
      transcript(total).slice(page1.start, page1.end).join('\n'),
      'rangePage',
      nextLimit1
    );
    currentLimit = nextLimit1;
    // What a served-range memory (`lastReadRef`) would hold after page 1 --
    // correct at the instant it lands.
    const servedRange1 = { start: page1.start, end: page1.end, total };

    // The pane keeps printing while the reader pages back: fifty new lines,
    // folded the ordinary way a poll folds a refresh in. The window already
    // sits at its cap, so this evicts fifty lines off the top.
    total += 50;
    window = foldPaneRead(
      window,
      transcript(total).slice(-currentLimit).join('\n'),
      'refresh',
      currentLimit
    );
    expect(window.split('\n')).toEqual(transcript(total).slice(-currentLimit));
    const trueTop = total - currentLimit;

    // The remembered served start still says page 1's start -- it has no way
    // to know eviction ran. Asking above it lands short of the window's
    // actual top by exactly the fifty evicted lines: a gap, not a seam.
    const staleNextPage = nextPageRange(servedRange1, PAGE);
    if (!staleNextPage) throw new Error('staleNextPage should not be null');
    expect(staleNextPage.end).toBe(page1.start);
    expect(staleNextPage.end).toBeLessThan(trueTop);

    // Recomputed fresh off the pane's live scroll metrics, the seed is the
    // window's true current top, eviction included -- it is not a memory of
    // a past answer, it is the same question asked again.
    const seed2 = seedPageRange(scrollFor(total), currentLimit);
    if (!seed2) throw new Error('seed2 should not be null');
    expect(seed2.start).toBe(trueTop);
    const page2 = nextPageRange(seed2, PAGE);
    if (!page2) throw new Error('page2 should not be null');
    expect(page2.end).toBe(trueTop);

    const merged = foldPaneRead(
      window,
      transcript(total).slice(page2.start, page2.end).join('\n'),
      'rangePage',
      currentLimit + PAGE
    );

    // No gap: every absolute line from the fetched page's start through the
    // live tail is present, in order, with nothing skipped in between.
    const mergedIndices = merged.split('\n').map((row) => Number(row.slice('line '.length)));
    for (let index = 1; index < mergedIndices.length; index += 1) {
      expect(mergedIndices[index]).toBe(mergedIndices[index - 1] + 1);
    }
    expect(mergedIndices[0]).toBe(page2.start);
    expect(mergedIndices.at(-1)).toBe(total - 1);
  });
});
