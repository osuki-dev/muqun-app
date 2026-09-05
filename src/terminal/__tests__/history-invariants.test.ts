// The four invariants of the pane read/hold contract, one describe block each.
//
// The contract itself is written at the top of `src/terminal/history.ts`. This
// file is the part of it a machine checks. Card #721: every bug of the last two
// days -- duplicated history, scrambled order, flicker on update, chrome
// written into the transcript -- was a rule nobody had written down and nothing
// enforced, so each fix moved the failure somewhere else.
//
// The numbers quoted in the comments were measured on the loopback fleet on
// 2026-07-29 against herdr 0.7.5 and the 1.2.0 gateway. The transcripts they
// were measured against are Ellen's own and are not checked in; the fixtures
// below reproduce their *shape*, which is the part the rules are about.
import { describe, expect, test } from 'bun:test';

import { foldPaneRead, mergeTerminalWindow, sanitizePaneRead } from '../history';

const MAXIMUM = 2_000;

/**
 * The budget for the one test here that does seconds of real work.
 *
 * Bun's default is 5s and that test lands a few hundred milliseconds under it,
 * so a build sharing the machine tips it over and the suite reports the
 * terminal contract as broken when nothing about it is. Well clear of the work,
 * well short of a hang.
 */
const HEAVY_INVARIANT_TIMEOUT_MS = 30_000;

function rows(output: string): string[] {
  return output ? output.split('\n') : [];
}

/** A deterministic generator, so a failure is a bug rather than a bad morning. */
function randomizer(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

/**
 * A pane that behaves the way the ones in these bug reports behave.
 *
 * A transcript that only ever grows, rendered into a viewport with an agent's
 * composer pinned to the bottom of it -- a rule, the prompt, a mode line with a
 * timer that changes every frame whether or not anything scrolled. That last
 * row is why the placement cannot demand exact agreement, and the pinned box is
 * why a scored ratio alone was not enough (see `scrollback.rs`).
 */
class Pane {
  readonly transcript: string[] = [];
  private tick = 0;
  constructor(
    readonly viewportRows = 65,
    readonly composerRows = 8
  ) {}

  /** Advance the session by `count` rows of new transcript. */
  emit(count: number): void {
    for (let step = 0; step < count; step += 1) {
      this.transcript.push(`row ${this.transcript.length} of the session`);
    }
  }

  private composer(): string[] {
    this.tick += 1;
    return [
      '─'.repeat(20),
      '❯ ',
      '─'.repeat(20),
      '  ⏵⏵ accept edits on',
      '  ✻ agent: sonnet',
      '',
      `  ${this.tick}m ${this.tick % 60}s · ↓ ${this.tick} tokens`,
      '',
    ].slice(0, this.composerRows);
  }

  /** What a read of this pane returns: the tail of the transcript that fits
   * above the pinned box, then the box. */
  screen(): string {
    const box = this.composer();
    const body = this.transcript.slice(-(this.viewportRows - box.length));
    return [...body, ...box].join('\n');
  }
}

/**
 * The same pane, with the pinned box the real Claude Code TUI actually draws.
 *
 * Two differences from {@link Pane}, and both of them are the defect: the box
 * carries a status row that changes on every frame, and it **changes height**
 * as background agents come and go. `Pane` pins a box of a fixed height whose
 * every row but the timer is constant, which is a composer standing still --
 * and standing still is exactly the case a page read could already handle.
 *
 * A read of this pane is the tail of the transcript that fits above the box,
 * then the box, which is what both a tail read and a deeper page return.
 */
class AgentPane {
  readonly transcript: string[] = [];
  private tick = 0;
  agents = 2;

  emit(count: number): void {
    for (let step = 0; step < count; step += 1) {
      this.transcript.push(`row ${this.transcript.length} of the session`);
    }
  }

  private box(): string[] {
    this.tick += 1;
    const agents = Array.from({ length: this.agents }, (_, index) => `  L Agent ${index} running`);
    return [
      '-'.repeat(20),
      '> ',
      ...agents,
      `  bypass permissions on - ${this.agents} shell - ${this.tick}m ${this.tick % 60}s`,
    ];
  }

  /** A read of `lines` rows: the transcript tail that fits, then the box. */
  read(lines: number): string {
    const box = this.box();
    return [...this.transcript.slice(-Math.max(0, lines - box.length)), ...box].join('\n');
  }
}

/**
 * Whether `part` appears inside `whole` in order, allowing gaps.
 *
 * The machine form of invariant (a): a window that is a subsequence of the true
 * transcript has invented nothing, reordered nothing and repeated nothing that
 * the session did not repeat itself.
 */
function isSubsequenceOf(part: readonly string[], whole: readonly string[]): number {
  let cursor = 0;
  for (let index = 0; index < part.length; index += 1) {
    let found = -1;
    for (let scan = cursor; scan < whole.length; scan += 1) {
      if (whole[scan] === part[index]) {
        found = scan;
        break;
      }
    }
    if (found < 0) return index;
    cursor = found + 1;
  }
  return -1;
}

/** The widest block that is immediately followed by a verbatim copy of itself. */
function adjacentRepeat(window: readonly string[]): { at: number; size: number } | null {
  for (let size = Math.floor(window.length / 2); size >= 4; size -= 1) {
    for (let at = 0; at + 2 * size <= window.length; at += 1) {
      let same = true;
      let carried = 0;
      for (let step = 0; step < size; step += 1) {
        if (window[at + step] !== window[at + size + step]) {
          same = false;
          break;
        }
        if (window[at + step].trim() !== '') carried += 1;
      }
      if (same && carried >= 4) return { at, size };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// (a) the held window is a supersequence of what arrived, in arrival order
// ---------------------------------------------------------------------------

describe('(a) the window is a supersequence of what arrived, in arrival order', () => {
  test('a session driven through frames stays a subsequence of its own transcript', () => {
    // The shape of the original bug report: a burst scrolls the pane further
    // between two polls than the placement can follow, over and over. The rule
    // is not "the window is right", which no placement can promise -- it is
    // that the window never claims the session said something it did not, or
    // said it in an order it did not.
    for (const seed of [1, 7, 11, 1_984, 20_260_729]) {
      const random = randomizer(seed);
      const pane = new Pane();
      let window = '';
      for (let poll = 0; poll < 200; poll += 1) {
        // 0..40 rows between polls: below ~19 the aligned overlap places, above
        // it nothing scores and the old code appended a whole screen.
        pane.emit(Math.floor(random() * 41));
        window = foldPaneRead(window, pane.screen(), 'frame', MAXIMUM);
        const held = rows(window).filter((row) => row.startsWith('row '));
        const failedAt = isSubsequenceOf(held, pane.transcript);
        expect({ seed, poll, failedAt, row: held[failedAt] ?? '' }).toEqual({
          seed,
          poll,
          failedAt: -1,
          row: '',
        });
      }
    }
  });

  test('a slow refresh landing behind the stream does not walk the pane backwards', () => {
    // The race the soak found, twice in one run, wearing two different masks:
    // a backwards jump in the row stamps and an agent's composer stranded in
    // the middle of the transcript. An HTTP refresh takes a second to come
    // back; in that second the event stream has painted three frames past it.
    // The read that lands is a photograph of a screen the window has already
    // scrolled beyond, and every rule here assumed a read was news.
    const pane = new Pane();
    pane.emit(600);
    // The refresh is issued now...
    const inFlight = pane.screen();
    let window = foldPaneRead('', inFlight, 'refresh', MAXIMUM);
    // ...and the stream runs on while it is in the air.
    for (let frame = 0; frame < 4; frame += 1) {
      pane.emit(120);
      window = foldPaneRead(window, pane.screen(), 'frame', MAXIMUM);
    }
    const ahead = rows(window);
    // ...and only now does it land.
    const after = rows(foldPaneRead(window, inFlight, 'refresh', MAXIMUM));
    expect(after).toEqual(ahead);
  });

  test('a re-wrap that really does put earlier rows back on screen is still taken down', () => {
    // The case the staleness rule must not eat, and the reason it is only asked
    // once every placement has declined. A long line resolving or a tool block
    // collapsing genuinely moves the screen backwards -- by a little, within a
    // placement's reach -- and those rows have to come back down rather than be
    // ignored as old news.
    const pane = new Pane();
    pane.emit(100);
    let window = foldPaneRead('', pane.screen(), 'frame', MAXIMUM);
    pane.emit(12);
    window = foldPaneRead(window, pane.screen(), 'frame', MAXIMUM);
    const deep = rows(window).length;
    // The screen jumps back by twelve rows: the same body as two frames ago.
    pane.transcript.length -= 12;
    const rewrapped = rows(foldPaneRead(window, pane.screen(), 'frame', MAXIMUM));
    expect(rewrapped.length).toBeLessThan(deep);
    expect(adjacentRepeat(rewrapped)).toBeNull();
  });

  test('paging a pane with a pinned box that changes height keeps the order', () => {
    // The defect from the maintainer's phone: the live bottom of the screen --
    // the prompt, the status row, the agents list -- sat in the MIDDLE of the
    // window, with older transcript below it. An earlier page had been appended
    // under the live screen instead of being recognised as the deeper read it
    // was.
    //
    // Why it survived every test here until now: the paging tests above use a
    // fixture with no pinned box at all, and the composer tests never page. The
    // deepening check demands the window agree with the deeper read EXACTLY,
    // row for row -- so one ticking status row, or one agent appearing, is
    // enough to refuse it, and the read then falls through to the
    // newest-thing-on-top fallback and lands under the transcript it contains.
    //
    // The sequence is the one a reader actually performs: read, page, let the
    // poll land, leave the pane and come back to the cached window, page again.
    const pane = new AgentPane();
    pane.emit(900);

    let window = foldPaneRead('', pane.read(240), 'refresh', MAXIMUM);
    pane.agents = 3;
    window = foldPaneRead(window, pane.read(480), 'page', MAXIMUM);
    window = foldPaneRead(window, pane.read(480), 'refresh', MAXIMUM);
    // Leaving the pane and coming back: the cache hands the window straight
    // back (#33) and the reconcile read folds against it at the paged depth.
    const restored = window;
    window = foldPaneRead(restored, pane.read(480), 'refresh', MAXIMUM);
    pane.agents = 1;
    window = foldPaneRead(window, pane.read(720), 'page', MAXIMUM);

    const held = rows(window);
    // (a) itself: every transcript row the window holds, in the session's order.
    const body = held.filter((row) => row.startsWith('row '));
    expect(isSubsequenceOf(body, pane.transcript)).toBe(-1);
    // And the reading of it the screenshot showed: the live box is the bottom
    // of the pane, so nothing may sit under it.
    const status = held.findIndex((row) => row.includes('bypass permissions on'));
    expect(status).toBeGreaterThanOrEqual(0);
    expect(held.slice(status + 1).filter((row) => row.startsWith('row '))).toEqual([]);
    // One live box, not one per read folded in.
    expect(held.filter((row) => row.includes('bypass permissions on'))).toHaveLength(1);
    expect(adjacentRepeat(held)).toBeNull();
  });

  test('one ticking row in the pinned box does not cost a page its depth', () => {
    // The minimal form of the same fault, isolated: the box stands still except
    // for its status row. Every other comparison in `history.ts` scores its
    // agreement for exactly this reason -- "a composer is not a still image" --
    // and the deepening check was the one that still demanded a photograph.
    const older = Array.from({ length: 477 }, (_, index) => `row ${index + 423}`);
    const newer = older.slice(-237);
    const held = [...newer, '-'.repeat(20), '> ', 'status 1m 1s'].join('\n');
    const page = [...older, '-'.repeat(20), '> ', 'status 2m 2s'].join('\n');
    const folded = rows(foldPaneRead(held, page, 'page', MAXIMUM));
    expect(folded[0]).toBe('row 423');
    expect(folded.at(-1)).toBe('status 2m 2s');
    expect(folded.filter((row) => row === '> ')).toHaveLength(1);
  });

  test('a pinned box taller than the deepening slack costs depth, never order', () => {
    // The structural half of the same rule, and the reason it is not left to a
    // constant being big enough. A box deeper than the slack defeats the
    // deepening check whatever its value -- so the question is what the fold
    // does *then*. Appending was a scrambled transcript; declining is a pull
    // that brought nothing back, which the next pull retries.
    const older = Array.from({ length: 400 }, (_, index) => `row ${index}`);
    const box = (n: number) => Array.from({ length: n }, (_, index) => `box row ${index} at ${n}`);
    const held = [...older.slice(-120), ...box(40)].join('\n');
    const page = [...older, ...box(64)].join('\n');
    const folded = rows(foldPaneRead(held, page, 'page', MAXIMUM));
    // Nothing older was written underneath the box the window already ends on.
    const body = folded.filter((row) => row.startsWith('row '));
    expect(isSubsequenceOf(body, older)).toBe(-1);
    const lastBody = folded
      .map((row, at) => (row.startsWith('row ') ? at : -1))
      .filter((at) => at >= 0)
      .pop();
    const firstBox = folded.findIndex((row) => row.startsWith('box row '));
    expect(lastBody).toBeLessThan(firstBox);
    expect(adjacentRepeat(folded)).toBeNull();
  });

  test('a fold only ever drops from the tail and appends', () => {
    // Structural restatement of the same thing: whatever the placement decides,
    // the rows the window keeps are a prefix of the rows it had.
    const random = randomizer(4_242);
    const pane = new Pane();
    let window = '';
    for (let poll = 0; poll < 120; poll += 1) {
      pane.emit(Math.floor(random() * 30));
      const before = rows(window);
      const after = rows(foldPaneRead(window, pane.screen(), 'frame', MAXIMUM));
      // Everything the window kept from before sits at its head, in order.
      const kept = before.filter(
        (_, index) => index < after.length && before[index] === after[index]
      );
      expect(kept.length).toBe(Math.min(before.length, kept.length));
      window = after.join('\n');
    }
  });
});

// ---------------------------------------------------------------------------
// (b) a refresh never shrinks what the reader paged to
// ---------------------------------------------------------------------------

describe('(b) a refresh never shrinks what the reader paged to', () => {
  const paged = Array.from({ length: 2_000 }, (_, index) => `history row ${index}`);

  test('a screen-sized refresh of a deep window keeps the depth', () => {
    // The measurement this exists for. Pane wM:p1, max_offset_from_bottom 0:
    //   lines=240 -> 63 rows   lines=720 -> 63 rows   lines=2000 -> 63 rows
    // A refresh of that pane is one viewport however deep it asks, so the old
    // `replaceTerminalWindow(value, lineLimit)` handed the reader 63 rows back
    // for the 2000 they had paged to -- once a second. That is the flicker.
    const refresh = paged.slice(-63).join('\n');
    const held = rows(foldPaneRead(paged.join('\n'), refresh, 'refresh', MAXIMUM));
    expect(held).toHaveLength(2_000);
    expect(held[0]).toBe('history row 0');
    expect(held.at(-1)).toBe('history row 1999');
  });

  test('a refresh that carries new rows costs the top exactly those rows', () => {
    const refresh = [...paged.slice(-60), 'fresh a', 'fresh b', 'fresh c'].join('\n');
    const held = rows(foldPaneRead(paged.join('\n'), refresh, 'refresh', 2_000));
    expect(held).toHaveLength(2_000);
    expect(held[0]).toBe('history row 3');
    expect(held.at(-1)).toBe('fresh c');
  });

  test('no source shrinks the window across a long run of screen-sized refreshes', () => {
    // The loop the reader actually lives in: they page down, then sit there
    // while the poll runs once a second. Depth must be monotonic.
    const pane = new Pane();
    pane.emit(1_500);
    let window = pane.transcript.join('\n');
    let floor = rows(window).length;
    for (let poll = 0; poll < 60; poll += 1) {
      pane.emit(poll % 7);
      window = foldPaneRead(window, pane.screen(), 'refresh', MAXIMUM);
      const depth = rows(window).length;
      expect({ poll, shrank: depth < floor }).toEqual({ poll, shrank: false });
      floor = Math.min(MAXIMUM, depth);
    }
  });

  test('a page that plateaus below its own promise does not undo the page before it', () => {
    // Card #646: a pane claiming 2765 rows that stops returning more at 932.
    // Asking for 1200, 1440, 1680 and 1920 returns the same 932 rows every
    // time; a bare `setOutput(value)` would then replace a 2000-row window with
    // a 932-row one as the reward for pulling down.
    const deep = paged.join('\n');
    const plateau = paged.slice(-932).join('\n');
    const held = rows(foldPaneRead(deep, plateau, 'page', MAXIMUM));
    expect(held).toHaveLength(2_000);
    expect(held[0]).toBe('history row 0');
  });

  test('a page that genuinely reaches deeper is allowed to, and only it is', () => {
    const shallow = paged.slice(-240).join('\n');
    const deeper = paged.join('\n');
    expect(rows(foldPaneRead(shallow, deeper, 'page', MAXIMUM))).toHaveLength(2_000);
    // The same read arriving as an SSE frame may not: a screen is never deeper
    // than the window that contains it, and believing one that claimed to be is
    // card #712. The frame places against the tail instead, which for a read
    // that contains the whole window is a no-op on its depth.
    const asFrame = rows(foldPaneRead(shallow, deeper, 'frame', MAXIMUM));
    expect(asFrame.at(-1)).toBe('history row 1999');
    expect(asFrame.length).toBeGreaterThanOrEqual(240);
  });
});

// ---------------------------------------------------------------------------
// (c) pinned furniture is never written into history
// ---------------------------------------------------------------------------

describe('(c) pinned furniture is never written into history', () => {
  test('a composer the screen jumped past does not land in the transcript', () => {
    // A burst scrolls further than one read can be followed, so the read goes
    // on top whole -- and the composer it ends with lands in the middle of the
    // transcript, where the reader scrolls back past prompt boxes that were
    // never there.
    const pane = new Pane();
    let window = '';
    for (let poll = 0; poll < 40; poll += 1) {
      pane.emit(400); // far beyond anything a placement can follow
      window = foldPaneRead(window, pane.screen(), 'frame', MAXIMUM);
    }
    const held = rows(window);
    const rules = held.filter((row) => row === '─'.repeat(20)).length;
    const prompts = held.filter((row) => row === '❯ ').length;
    const modes = held.filter((row) => row === '  ⏵⏵ accept edits on').length;
    // One composer, at the bottom, where the pane pins it.
    expect({ rules, prompts, modes }).toEqual({ rules: 2, prompts: 1, modes: 1 });
    expect(held.at(-1)).toContain('tokens');
  });

  test('a blank tail is room at the bottom of two screens, not furniture', () => {
    // The rule must not eat the transcript above a screen that simply has empty
    // rows at its foot: thirty aligned blank rows say only that both screens
    // have room.
    const held = ['keep me a', 'keep me b', '', '', '', ''];
    const incoming = ['brand new c', 'brand new d', '', '', '', ''];
    const folded = rows(foldPaneRead(held.join('\n'), incoming.join('\n'), 'frame', MAXIMUM));
    expect(folded).toContain('keep me a');
    expect(folded).toContain('keep me b');
    expect(folded).toContain('brand new d');
  });

  test('a pane that legitimately repaints a long identical tail keeps its history', () => {
    // Capped at a third of the read, the gateway's own cap: furniture is a
    // composer, not most of a screen. Built so no placement is believed -- the
    // read shares nothing with the window but its thirty-row tail -- which is
    // the only path the cap is on.
    const tail = Array.from({ length: 30 }, (_, index) => `tail ${index}`);
    const held = [...Array.from({ length: 100 }, (_, index) => `old ${index}`), ...tail];
    const incoming = [...Array.from({ length: 30 }, (_, index) => `new ${index}`), ...tail];
    const folded = rows(foldPaneRead(held.join('\n'), incoming.join('\n'), 'frame', MAXIMUM));
    expect(folded).toContain('old 0');
    expect(folded).toContain('old 99');
    // A third of the read is twenty rows, so ten of the tail survive above the
    // seam rather than the whole thirty being called chrome.
    expect(folded).toContain('tail 9');
  });

  test('the rule fires through the timer an agent repaints every frame', () => {
    // The gateway computes this with an exact `common_suffix`, which stops dead
    // at the mode-line timer and so never recognises the box at all. Scored
    // agreement steps over it.
    const composer = (tick: number) => [
      '─'.repeat(20),
      '❯ ',
      '  ⏵⏵ accept edits on',
      `  ${tick}m ${tick}s · ↓ ${tick}k tokens`,
      '',
    ];
    const held = [...Array.from({ length: 80 }, (_, index) => `old ${index}`), ...composer(1)];
    const incoming = [...Array.from({ length: 40 }, (_, index) => `new ${index}`), ...composer(2)];
    const folded = rows(foldPaneRead(held.join('\n'), incoming.join('\n'), 'frame', MAXIMUM));
    expect(folded.filter((row) => row === '❯ ')).toHaveLength(1);
    expect(folded).toContain('old 79');
  });
});

// ---------------------------------------------------------------------------
// (d) identical adjacent blocks never accumulate
// ---------------------------------------------------------------------------

describe('(d) identical adjacent blocks never accumulate', () => {
  test('a block folded on top of itself is written down once', () => {
    const block = [
      '⏺ Bash(git status)',
      '  ⎿ === branch ===',
      '     ## main',
      '     ?? worktrees/',
    ];
    const held = ['before', ...block].join('\n');
    const folded = rows(foldPaneRead(held, block.join('\n'), 'frame', MAXIMUM));
    expect(adjacentRepeat(folded)).toBeNull();
    expect(folded.filter((row) => row === '⏺ Bash(git status)')).toHaveLength(1);
  });

  // Four seeds, 150 polls each, and an O(window^2) repeat scan after every one:
  // the only test in this file that is seconds of real work rather than
  // milliseconds. It blew bun's 5s default once, on a machine sharing the box
  // with a release build, which reads as the terminal contract failing when it
  // is only the laptop being busy -- hence the cheap assertion below.
  //
  // The cheap assertion was not enough: it still lands within a few hundred
  // milliseconds of the 5s default, so any machine running a build alongside
  // the suite fails it. A budget of its own is the honest fix. Thirty seconds
  // is far above what the work costs even on a loaded laptop and far below a
  // hang, so a failure here still means the fold is stuck rather than slow.
  test(
    'no run of the simulated session ever accumulates one',
    () => {
      for (const seed of [3, 13, 97, 2_026]) {
        const random = randomizer(seed);
        const pane = new Pane();
        let window = '';
        for (let poll = 0; poll < 150; poll += 1) {
          pane.emit(Math.floor(random() * 90));
          window = foldPaneRead(window, pane.screen(), 'frame', MAXIMUM);
          // Asserted only when there is something to say. Six hundred passing
          // deep-equality checks were most of this test's runtime, and the run
          // that mattered -- the one where a repeat appears -- still reports the
          // seed and the poll it appeared on.
          const repeat = adjacentRepeat(rows(window));
          if (repeat) expect({ seed, poll, repeat }).toEqual({ seed, poll, repeat: null as never });
        }
      }
    },
    HEAVY_INVARIANT_TIMEOUT_MS
  );

  test('a seam hidden under the composer is found, not appended over', () => {
    // Caught by `scripts/terminal-soak.ts` against a live pane, eleven folds
    // into the first run. The window ended with one transcript row and then the
    // pinned box; the read began with that same transcript row. The seam is one
    // row wide and sits under seven rows of chrome, so nothing could align to
    // it and the read went on top whole -- writing that row down twice. The
    // furniture has to come off before the placement is given up on.
    const composer = ['─'.repeat(20), '❯ ', '  ⏵⏵ accept edits on', '  1m 2s · ↓ 3k tokens'];
    const held = [
      ...Array.from({ length: 90 }, (_, index) => `«${String(index).padStart(6, '0')}» row`),
      ...composer,
    ];
    const incoming = [
      ...Array.from({ length: 60 }, (_, index) => `«${String(89 + index).padStart(6, '0')}» row`),
      ...composer,
    ];
    const folded = rows(foldPaneRead(held.join('\n'), incoming.join('\n'), 'frame', MAXIMUM));
    const stamped = folded.filter((row) => row.startsWith('«000089»'));
    expect(stamped).toHaveLength(1);
    // And the stamps still only go up.
    const order = folded
      .map((row) => /^«(\d{6})»/u.exec(row))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => Number(match[1]));
    expect(order.every((value, index) => index === 0 || value > order[index - 1])).toBe(true);
  });

  test('a session that ran the same command twice may still say so', () => {
    // The rule is about a buffer writing itself down again, not about a
    // transcript that repeats. Three rows is a prompt printed twice.
    const twice = ['❯ ls', 'a.txt', 'b.txt', '❯ ls', 'a.txt', 'b.txt'].join('\n');
    expect(rows(foldPaneRead('', twice, 'refresh', MAXIMUM))).toHaveLength(6);
  });

  test('the parts stream is held to the same rule', () => {
    const block = ['tool a', 'tool b', 'tool c', 'tool d'];
    const merged = rows(mergeTerminalWindow(['x', ...block].join('\n'), block.join('\n'), MAXIMUM));
    expect(adjacentRepeat(merged)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Herdr duplicates its own reads. This is the only place we can stand.
// ---------------------------------------------------------------------------

describe("herdr's own duplication, which is not ours to fix", () => {
  /** A read shaped the way `recent_unwrapped` shapes one: stitched from two
   * buffer segments, so its head is a verbatim copy of a block `distance` rows
   * down it. Measured on herdr 0.7.5, pane wM:pT:
   *   lines=240  219 rows, rows 0..21 are verbatim rows 43..64
   *   lines=480  430 rows, rows 0..25 are verbatim rows 104..129
   *   lines=960  892 rows, rows 0..4  are verbatim rows 100..104
   *   lines=2000 932 rows, clean
   */
  function stitched(block: number, distance: number, total: number): string[] {
    const truth = Array.from({ length: total }, (_, index) => `transcript row ${index}`);
    return [...truth.slice(distance, distance + block), ...truth];
  }

  test('a head that repeats verbatim further down the same read is dropped', () => {
    for (const [block, distance] of [
      [22, 43],
      [26, 104],
      [5, 100],
    ] as const) {
      const read = stitched(block, distance, 200);
      const clean = rows(sanitizePaneRead(read.join('\n')));
      expect({ block, distance, rows: clean.length }).toEqual({ block, distance, rows: 200 });
      expect(clean[0]).toBe('transcript row 0');
    }
  });

  test('a clean read is returned exactly as it arrived', () => {
    const read = Array.from({ length: 932 }, (_, index) => `transcript row ${index}`).join('\n');
    expect(sanitizePaneRead(read)).toBe(read);
  });

  test('a log printing one line over and over is not duplication', () => {
    // The clause that separates a stitching bug from a pane doing its job: a
    // repeat has to carry rows that differ from each other.
    const log = Array.from({ length: 60 }, () => 'waiting for lock...').join('\n');
    expect(sanitizePaneRead(log)).toBe(log);
    const box = Array.from({ length: 40 }, () => '│                    │').join('\n');
    expect(sanitizePaneRead(box)).toBe(box);
  });

  test('a stitched read cannot get its duplicate into the window through any door', () => {
    const read = stitched(22, 43, 200).join('\n');
    for (const origin of ['refresh', 'page', 'frame'] as const) {
      const held = rows(foldPaneRead('transcript row 0', read, origin, MAXIMUM));
      expect({ origin, duplicated: held.filter((r) => r === 'transcript row 43').length }).toEqual({
        origin,
        duplicated: 1,
      });
    }
  });
});
