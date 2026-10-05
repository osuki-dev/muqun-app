// Rows are placed by what a reader sees of them, not by their bytes.
//
// The gateway learned this from six hours of recorded reads (muqun-gateway
// `src/terminal/scrollback.rs`, "Placing a read"): Claude Code repaints rows it
// has not changed and encodes them differently each time -- a colour run that
// moves across a space, a blank row drawn as `""`, `" "` or `"  "`. Compared as
// bytes, a repainted screen shares almost nothing with the frame before it and
// goes on the end whole. `foldPaneRead` merges the gateway's frames into the
// App's own window and had the same fault, so it could duplicate a screen even
// when the gateway did not.
//
// The fixtures are cut from the gateway's checked-in replay fixtures
// (`tests/fixtures/scrollback/*.json`, anonymised: every distinct row once, each
// read as indices into them). Each read is fed here as the SSE frame it would
// have been.
import { describe, expect, test } from 'bun:test';

import { applyTerminalFrame, foldPaneRead, mergeTerminalWindow } from '../history';
import afterGap from './fixtures/scrollback/claude-after-gap.json';
import midRedraw from './fixtures/scrollback/claude-mid-redraw.json';
import codexPinned from './fixtures/scrollback/codex-pinned-prompt.json';

const MAXIMUM = 5_000;

type Fixture = { format: string; rows: string[]; reads: number[][] };

function readsOf(fixture: Fixture): string[] {
  return fixture.reads.map((read) => read.map((id) => fixture.rows[id]).join('\n'));
}

function fold(reads: readonly string[]): string {
  return reads.reduce((window, read) => applyTerminalFrame(window, read, MAXIMUM), '');
}

/** What a reader sees of a row: CSI and OSC escapes removed. */
function stripAnsi(text: string): string {
  // oxlint-disable-next-line no-control-regex
  return text.replace(
    /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/gu,
    ''
  );
}

function normalised(row: string): string {
  return row.split(/\s+/u).filter(Boolean).join(' ');
}

function isRule(row: string): boolean {
  const trimmed = row.trim();
  return [...trimmed].length >= 10 && /^─+$/u.test(trimmed);
}

/** The gateway's `copied_blocks`: runs of four or more text rows written down
 * twice, by the first row of each copy. */
function copiedBlocks(text: string): string[] {
  const rows = text
    .split('\n')
    .map(normalised)
    .filter((row) => row !== '');
  const found: string[] = [];
  let at = 0;
  while (at < rows.length) {
    let copied = 0;
    for (let later = at + 1; later < rows.length && copied === 0; later += 1) {
      let run = 0;
      while (at + run < later && later + run < rows.length && rows[at + run] === rows[later + run])
        run += 1;
      if (run >= 4) copied = run;
    }
    if (copied > 0) {
      found.push(rows[at]);
      at += copied;
    } else {
      at += 1;
    }
  }
  return found;
}

/** The gateway's `frozen_footers`: a footer row, or a prompt box, left above
 * the live bottom twelve rows. Digits are ignored, so an older count is found. */
function frozenFooters(text: string): string[] {
  const shape = (row: string) => normalised(row).replace(/\d+/gu, '#');
  const lines = text.split('\n');
  let bottom = lines.length;
  while (bottom > 0 && lines[bottom - 1].trim() === '') bottom -= 1;
  const live = Math.max(0, bottom - 12);
  const footer = new Set(
    lines
      .slice(0, bottom)
      .reverse()
      .filter((row) => row.trim() !== '' && !isRule(row))
      .slice(0, 3)
      .map(shape)
  );
  const frozen: string[] = [];
  for (let row = 0; row < live; row += 1) {
    const line = lines[row];
    const promptBox = isRule(line) && (lines[row + 1] ?? '').trimStart().startsWith('❯');
    if (promptBox || (line.trim() !== '' && footer.has(shape(line)))) frozen.push(normalised(line));
  }
  return frozen;
}

describe('recorded panes fold without copies or frozen footers', () => {
  for (const [name, fixture] of [
    // Reads taken while Claude Code was halfway through a repaint, every row
    // re-encoded with its colours moved.
    ['claude-mid-redraw', midRedraw],
    // The first read after a 57-second gap in the reads.
    ['claude-after-gap', afterGap],
    // Codex pins the current prompt to the top row while output scrolls.
    ['codex-pinned-prompt', codexPinned],
  ] as const) {
    test(name, () => {
      const held = stripAnsi(fold(readsOf(fixture as Fixture)));
      const copies = copiedBlocks(held).filter(
        // `/status` run twice, minutes apart: a real repeat the pane printed.
        (block) => !(name === 'codex-pinned-prompt' && block === '/zahabz')
      );
      expect(copies).toEqual([]);
      expect(frozenFooters(held)).toEqual([]);
    });
  }

  test('a pinned Codex prompt is held once, and the panel the pane really printed twice stays twice', () => {
    const reads = readsOf(codexPinned as Fixture);
    const pinned = normalised(stripAnsi(reads[0].split('\n')[0]));
    const rows = stripAnsi(fold(reads)).split('\n').map(normalised);
    expect(rows.filter((row) => row === pinned)).toHaveLength(1);
    expect(rows.filter((row) => row === '/zahabz')).toHaveLength(2);
  });
});

describe('rows are compared by their visible text', () => {
  const transcript = (from: number, count: number) =>
    Array.from({ length: count }, (_, index) => `answer line ${from + index}`);

  test('the same text with its colour bytes moved is the same row', () => {
    // Claude Code draws `● ` with the space inside the colour run on one frame
    // and outside it on the next.
    const before = [
      ...transcript(0, 20),
      '\u001b[38;2;78;186;101m● \u001b[0mRead(src/history.ts)',
      ...transcript(20, 10),
    ];
    const after = [
      ...transcript(4, 16),
      '\u001b[38;2;78;186;101m●\u001b[0m Read(src/history.ts)',
      ...transcript(20, 10),
      ...transcript(30, 4),
    ].map((row) => (row.startsWith('answer') ? `\u001b[1m${row}\u001b[0m` : row));
    const window = applyTerminalFrame(before.join('\n'), after.join('\n'), MAXIMUM);
    const rows = window.split('\n');
    expect(rows).toHaveLength(35);
    expect(stripAnsi(window).split('\n')).toEqual([
      ...transcript(0, 20),
      '● Read(src/history.ts)',
      ...transcript(20, 14),
    ]);
    // The newest rendering is the one kept, colours and all.
    expect(rows.at(-1)).toBe('\u001b[1manswer line 33\u001b[0m');
  });

  test('a blank row drawn as "", " " or "  " is one blank row', () => {
    const screen = (blank: string, from: number) =>
      [
        ...transcript(from, 6),
        blank,
        ...transcript(from + 6, 6),
        blank,
        ...transcript(from + 12, 6),
      ].join('\n');
    let window = screen('', 0);
    window = applyTerminalFrame(window, screen(' ', 0), MAXIMUM);
    window = applyTerminalFrame(window, screen('  ', 0), MAXIMUM);
    window = applyTerminalFrame(window, screen('\u001b[0m ', 2), MAXIMUM);
    expect(copiedBlocks(window)).toEqual([]);
    expect(
      stripAnsi(window)
        .split('\n')
        .filter((row) => row.trim() !== '')
    ).toEqual(transcript(0, 20));
  });

  test('blank rows are not an anchor', () => {
    // Two screens sharing only room at the bottom have nothing in common.
    const blank = Array.from({ length: 6 }, () => ' ');
    const before = [...transcript(0, 5), ...blank].join('\n');
    const after = ['fresh output 1', 'fresh output 2', 'fresh output 3', ...blank].join('\n');
    const window = applyTerminalFrame(before, after, MAXIMUM);
    expect(window.split('\n').filter((row) => row.startsWith('answer'))).toEqual(transcript(0, 5));
    expect(window.split('\n').filter((row) => row.startsWith('fresh'))).toHaveLength(3);
  });

  test('a prompt pinned to the top row is held once while output scrolls under it (Codex)', () => {
    const pinned = '\u001b[1m› fix the history merge\u001b[0m';
    const screen = (from: number) => [pinned, '', ...transcript(from, 30)].join('\n');
    let window = screen(0);
    for (let from = 3; from <= 30; from += 3) {
      window = applyTerminalFrame(window, screen(from), MAXIMUM);
    }
    const rows = stripAnsi(window).split('\n');
    expect(rows.filter((row) => row === '› fix the history merge')).toHaveLength(1);
    expect(rows.filter((row) => row.startsWith('answer'))).toEqual(transcript(0, 60));
  });

  test('the first frame after a 57-second gap is placed by its longest run, not stacked', () => {
    // The pane went quiet, then a frame arrived whose head had been repainted
    // (a collapsed tool block now reads differently) and whose transcript
    // scrolled far. Only a run in the middle of it is still held.
    const before = [...transcript(0, 40), '─'.repeat(40), '❯ ', '─'.repeat(40)];
    const after = [
      'Ran 3 tools (ctrl+o to expand)',
      ...transcript(30, 10),
      ...transcript(40, 25),
      '─'.repeat(40),
      '❯ ',
      '─'.repeat(40),
    ];
    const window = applyTerminalFrame(before.join('\n'), after.join('\n'), MAXIMUM);
    expect(copiedBlocks(window)).toEqual([]);
    expect(window.split('\n').filter((row) => row.startsWith('answer'))).toEqual(transcript(0, 65));
    expect(window.split('\n').filter((row) => row.trim() === '❯')).toHaveLength(1);
  });

  test('a resize starts the window again rather than keeping both wrappings', () => {
    // Every row re-wraps at the new width, so nothing lines up with what is
    // held, and appending would put the transcript in twice. The box rule an
    // agent draws edge to edge says the width changed.
    const wide = [...transcript(0, 20), '─'.repeat(120), '❯ ', '─'.repeat(120)].join('\n');
    const narrow = [
      ...transcript(10, 10).flatMap((row) => [row.slice(0, 8), row.slice(8)]),
      '─'.repeat(60),
      '❯ ',
      '─'.repeat(60),
    ].join('\n');
    expect(applyTerminalFrame(wide, narrow, MAXIMUM)).toBe(narrow);
    // A page is history at whatever width it was printed, and is never reset.
    expect(foldPaneRead(wide, narrow, 'page', MAXIMUM)).not.toBe(narrow);
  });

  test('the reads that finish a resize replace the window too, then placement resumes', () => {
    // The read that first shows the new width can still carry rows wrapped for
    // the old one; the gateway lets three reads settle, and so does this.
    const box = (width: number) => ['─'.repeat(width), '❯ ', '─'.repeat(width)];
    const wide = [...transcript(0, 20), ...box(120)].join('\n');
    const screen = (rows: string[]) => [...rows, ...box(60)].join('\n');
    const halfWrapped = screen([...transcript(5, 10), 'answer line 15 old wrapping']);
    const rewrapped = screen([...transcript(5, 10), 'answer line 15', 'new wrapping']);
    let window = applyTerminalFrame(wide, halfWrapped, MAXIMUM);
    expect(window).toBe(halfWrapped);
    window = applyTerminalFrame(window, rewrapped, MAXIMUM);
    expect(window).toBe(rewrapped);
    window = applyTerminalFrame(window, rewrapped, MAXIMUM);
    expect(window).toBe(rewrapped);
    // Settled: the next read is placed against the window, not taken whole.
    const scrolled = screen([...transcript(8, 7), 'answer line 15', 'new wrapping', 'more']);
    window = applyTerminalFrame(window, scrolled, MAXIMUM);
    expect(stripAnsi(window).split('\n').slice(0, 3)).toEqual(transcript(5, 3));
    expect(window.split('\n').at(-4)).toBe('more');
  });

  test('the parts stream splices on visible text too', () => {
    expect(
      mergeTerminalWindow('a\n\u001b[1mb\u001b[0m\nc', 'b\n\u001b[2mc\u001b[0m\nd', MAXIMUM)
    ).toBe('a\n\u001b[1mb\u001b[0m\nc\nd');
  });
});
