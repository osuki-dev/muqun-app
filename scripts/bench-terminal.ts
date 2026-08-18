// Terminal core micro-benchmark (bun run scripts/bench-terminal.ts).
//
// Six scenarios; 1-3 run on a 2000-row snapshot with CJK, colour and truecolor:
//   1. full parse       -- cold parse of the whole snapshot into a frame
//   2. append one line  -- one write + frame() on a warm, pre-filled emulator
//   3. full-screen scroll -- one scrolling line feed + frame() at the bottom
//   4. real panes       -- recorded gateway output, both parse paths (see below)
//   5. block recording  -- card #561's planning half on synthetic refreshes
//   6. streaming scroll -- card #626: a full window sliding a row at a time
//
// Scenarios 2 and 3 are the ones card #560 targets: on a persistent emulator
// they must cost O(changed rows), not O(whole screen). The numbers below are the
// wall-clock baselines measured on this machine (bun 1.4, Apple Silicon) against
// the pre-#560 object-tree model, kept so the typed-array rewrite can be compared
// against them:
//
//   BASELINE (object-tree screen model, pre-#560):
//     full parse:            29.34 ms/op
//     append one line:        5.04 ms/op
//     full-screen scroll:     5.91 ms/op
//
//   AFTER (typed-array grid + ring scroll + per-slot line cache):
//     full parse:            29.42 ms/op   (unchanged: dominated by grapheme
//                                           segmentation + VT parsing, not the
//                                           cell model)
//     append one line:        0.04 ms/op   (~130x: only the changed row is
//                                           re-materialised; the rest of the
//                                           frame is reused from the line cache)
//     full-screen scroll:     0.29 ms/op   (~20x: scroll is an O(1) ring head
//                                           rotation; the residual cost is
//                                           frame()'s O(rows) trailing-blank scan
//                                           once the screen fills with blank rows)
//
//   AFTER #572 (flat snapshot fast path):
//     full parse:             7.05 ms/op   (~4.2x: the synthetic snapshot is
//                                           flat -- text, line ends and SGR --
//                                           so it now skips the VT state machine
//                                           and segments only the CJK lines)
//     append one line:        0.04 ms/op   (unchanged: a warm emulator, not a
//     full-screen scroll:     0.28 ms/op    snapshot parse; the path is not used)
//
//   WITH #561 (per-row signature in buildLine + block planning):
//     plan blocks:            0.008 ms/op  (folding 2000 row signatures into 32
//                                           block keys, once per refresh)
//     unchanged output:       0 of 32 blocks re-recorded (signatures survive the
//                                           fresh emulator a refresh parses into)
//     append one line:        1 of 32
//     scroll by one row:     32 of 32      (every row moved, so under fixed
//                                           slices every block was different
//                                           content -- which made the cache
//                                           useless for the whole of a stream)
//
//   AFTER #626 (content-cut blocks, content-keyed, drawn by translation):
//     plan blocks:            0.011 ms/op  (the boundary scan costs a mix and a
//                                           mask per row on top of the fold)
//     scroll by one row:      0 of 31      (the head re-uses its recording an
//                                           `overhang` rows higher; the tail was
//                                           already recorded a frame earlier)
//     streaming scroll:      19 of 105 blocks, 379 of 4750 rows, over 19
//                                           single-row scrolls of a 250-row
//                                           window. Against the release/2.0
//                                           planner, the same scenario measured
//                                           76 of 76 blocks and 4750 of 4750
//                                           rows: the cache never hit once.
//                                           What is left is one block per
//                                           scroll -- the tail, which holds the
//                                           row that just arrived.
//
// Scenario 4 measures the flat fast path on real panes rather than a synthetic
// snapshot: set MUQUN_TERMINAL_FIXTURES to a directory of `pane-*.json` gateway
// read responses and it parses each one both ways. The fixtures are private
// captures and are never committed, so the scenario is skipped without it.
//
//   REAL PANES (five captures, 111 B .. 113 kB):
//     full emulator:  45.0 ms summed over the five
//     flat fast path: 12.8 ms summed over the five   (3.53x, per-pane 3.3-5.0x)

import {
  __recordedChunkCount,
  __recordedChunkRows,
  __resetRecordedChunkCount,
  nextHeadRecording,
  planTerminalChunks,
  terminalChunkLayoutKey,
  type TerminalHeadRecording,
} from '../src/terminal/chunk-plan';
import {
  TerminalEmulator,
  parseTerminalSnapshot,
  setTerminalFullEmulation,
} from '../src/terminal/terminal-core';
import type { TerminalFrame } from '../src/terminal/types';
import { foldPaneRead } from '../src/terminal/history';

declare const Bun: {
  Glob: new (pattern: string) => { scanSync(options: { cwd: string }): Iterable<string> };
  file(path: string): { text(): Promise<string> };
};

const ROWS = 2000;
const COLUMNS = 120;

function buildSnapshotLines(count: number): string[] {
  const lines: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const colour = (index % 7) + 31;
    const truecolor = `[38;2;${index % 256};${(index * 3) % 256};${(index * 7) % 256}m`;
    const filler = 'x'.repeat(index % 24);
    lines.push(
      `[${colour}m行 ${index} 你好世界 ${truecolor}hello world 日本語 ${filler}[0m`
    );
  }
  return lines;
}

const snapshotLines = buildSnapshotLines(ROWS);
const snapshot = snapshotLines.join('\n');
const APPENDED_LINE = '[36m追加 appended line 世界[0m';

function measure(iterations: number, run: () => void): number {
  // Warm up so JIT / grapheme-segmenter caches are hot before timing.
  for (let index = 0; index < Math.min(3, iterations); index += 1) run();
  const start = performance.now();
  for (let index = 0; index < iterations; index += 1) run();
  return (performance.now() - start) / iterations;
}

function bench(label: string, iterations: number, run: () => void): void {
  const per = measure(iterations, run);
  console.log(`${label.padEnd(22)} ${per.toFixed(3)} ms/op  (${iterations} ops, ${(per * iterations).toFixed(1)} ms total)`);
}

// 1. Full parse -- cold every time.
bench('full parse', 20, () => {
  parseTerminalSnapshot(snapshot);
});

// 2. Append one line to a warm, pre-filled emulator.
{
  const terminal = new TerminalEmulator({ columns: COLUMNS, rows: ROWS, scrollback: 4000, convertEol: true });
  terminal.write(snapshot);
  let counter = 0;
  bench('append one line', 2000, () => {
    counter += 1;
    terminal.write(`\n[36m追加 ${counter} appended line 世界[0m`);
    terminal.frame();
  });
}

// 3. Full-screen scroll -- emulator sitting at the bottom, each op scrolls once.
{
  const terminal = new TerminalEmulator({ columns: COLUMNS, rows: ROWS, scrollback: 4000, convertEol: true });
  terminal.write(snapshot);
  // Park the cursor on the last row so every '\n' scrolls the whole screen.
  terminal.write(`[${ROWS};1H`);
  bench('full-screen scroll', 2000, () => {
    terminal.write('\n');
    terminal.frame();
  });
}

// 4. Real panes -- full emulator vs the flat fast path, per fixture and summed.
{
  const directory = process.env.MUQUN_TERMINAL_FIXTURES;
  const names = directory
    ? [...new Bun.Glob('pane-*.json').scanSync({ cwd: directory })].sort()
    : [];
  if (names.length === 0) {
    console.log('\nreal panes             skipped (set MUQUN_TERMINAL_FIXTURES to a pane-*.json directory)');
  } else {
    console.log('\nreal panes             emulator / fast path');
    let emulatorTotal = 0;
    let fastTotal = 0;
    for (const name of names) {
      const payload = JSON.parse(await Bun.file(`${directory}/${name}`).text()) as {
        result?: { read?: { text?: unknown } };
      };
      const text = payload.result?.read?.text;
      if (typeof text !== 'string') {
        console.log(`  ${name.padEnd(20)} skipped (no result.read.text)`);
        continue;
      }
      // Big panes are slow enough that 30 parses is already a stable sample.
      const iterations = text.length > 50_000 ? 30 : 200;
      setTerminalFullEmulation(true);
      const slow = measure(iterations, () => {
        parseTerminalSnapshot(text);
      });
      setTerminalFullEmulation(false);
      const fast = measure(iterations, () => {
        parseTerminalSnapshot(text);
      });
      emulatorTotal += slow;
      fastTotal += fast;
      console.log(
        `  ${name.padEnd(20)} ${slow.toFixed(3)} ms / ${fast.toFixed(3)} ms  ${(slow / fast).toFixed(2)}x`
      );
    }
    console.log(
      `  ${'summed'.padEnd(20)} ${emulatorTotal.toFixed(3)} ms / ${fastTotal.toFixed(3)} ms  ${(emulatorTotal / fastTotal).toFixed(2)}x`
    );
  }
}

// Stands in for the component's block cache: plan, then record what the plan
// marked stale. The cache is keyed by content, exactly as the component's is, so
// a block whose rows merely moved is found and re-drawn rather than re-recorded.
function createChunkRecorder() {
  // Fixed layout: what varies between refreshes here is the rows, which is the
  // whole question. A real layout change (theme, font size) invalidates every
  // block by design.
  const layoutKey = terminalChunkLayoutKey({
    cellWidth: 8.13,
    fontSize: 13.5,
    lineHeight: 19,
    contentWidth: 990,
    themeId: 1,
    fontId: 1,
  });
  let recordedKeys = new Set<string>();
  let head: TerminalHeadRecording | undefined;

  return function refresh(frame: TerminalFrame): {
    blocks: number;
    recorded: number;
    rows: number;
  } {
    __resetRecordedChunkCount();
    const plans = planTerminalChunks(frame.lines, layoutKey, (key) => recordedKeys.has(key), head);
    head = nextHeadRecording(plans, frame.lines, head);
    recordedKeys = new Set(plans.map((plan) => plan.key));
    return { blocks: plans.length, recorded: __recordedChunkCount, rows: __recordedChunkRows };
  };
}

// 5. Incremental block recording.
{
  const refresh = createChunkRecorder();

  // One row short of the grid cap, so appending stays an append: at the cap the
  // emulator scrolls instead and every row moves up one.
  const belowCap = buildSnapshotLines(ROWS - 1);
  const cold = refresh(parseTerminalSnapshot(belowCap.join('\n')));
  console.log(
    `\ncontent-cut blocks     ${cold.blocks} for ${ROWS - 1} rows, ${cold.recorded} recorded cold`
  );

  // Re-parsed from scratch into a fresh emulator, as a refresh always is: this
  // is the check that row signatures identify content and not writes.
  const unchanged = refresh(parseTerminalSnapshot(belowCap.join('\n')));
  console.log(`same output again      ${unchanged.recorded}/${unchanged.blocks} blocks re-recorded`);
  if (unchanged.recorded !== 0) {
    throw new Error(`unchanged output re-recorded ${unchanged.recorded} blocks, expected 0`);
  }

  const appended = refresh(parseTerminalSnapshot([...belowCap, APPENDED_LINE].join('\n')));
  console.log(`append one line        ${appended.recorded}/${appended.blocks} blocks re-recorded`);
  if (appended.recorded !== 1) {
    throw new Error(`append one line re-recorded ${appended.recorded} blocks, expected 1`);
  }

  // The same content shifted up a row: what a snapshot hands back once output
  // reaches the row cap. Under the old fixed-slice plan this was every block.
  const scrolled = refresh(
    parseTerminalSnapshot([...belowCap.slice(1), APPENDED_LINE].join('\n'))
  );
  console.log(`scroll by one row      ${scrolled.recorded}/${scrolled.blocks} blocks re-recorded`);
  if (scrolled.recorded > 2) {
    throw new Error(`one scrolled row re-recorded ${scrolled.recorded} blocks, expected <= 2`);
  }

  const frames = [
    parseTerminalSnapshot(belowCap.join('\n')),
    parseTerminalSnapshot([...belowCap, APPENDED_LINE].join('\n')),
  ];
  const planRefresh = createChunkRecorder();
  let turn = 0;
  bench('plan blocks', 2000, () => {
    turn += 1;
    planRefresh(frames[turn % 2]);
  });
}

// 6. Streaming scroll -- the pane the app actually spends its time drawing.
//
// A full scrollback window under a live agent: every line printed costs one line
// off the top, so the window is a constant height and all of its content slides
// up by a row per frame. This is the case that made the block cache useless --
// every fixed slice of the window covered different rows than it had a frame
// earlier, so every block missed, every frame, for the whole stream.
{
  const WINDOW = 250;
  const SCROLLS = 19;
  const refresh = createChunkRecorder();
  const stream = buildSnapshotLines(WINDOW + SCROLLS);

  // Prime the cache on the first full window, then stream.
  const cold = refresh(parseTerminalSnapshot(stream.slice(0, WINDOW).join('\n')));
  let blocks = 0;
  let recorded = 0;
  let rows = 0;
  for (let step = 1; step <= SCROLLS; step += 1) {
    const result = refresh(parseTerminalSnapshot(stream.slice(step, step + WINDOW).join('\n')));
    blocks += result.blocks;
    recorded += result.recorded;
    rows += result.rows;
  }
  console.log(
    `\nstreaming scroll       ${WINDOW}-row window, ${cold.blocks} blocks, ${SCROLLS} single-row scrolls`
  );
  // The pre-#626 plan cut this window into four fixed 64-row slices and missed
  // on all four of them on every scroll: 76/76 blocks and 4750/4750 rows,
  // measured against the release/2.0 planner on this exact scenario.
  console.log(`  blocks re-recorded   ${recorded}/${blocks}  (fixed 64-row slices: 76/76)`);
  console.log(
    `  rows re-recorded     ${rows}/${WINDOW * SCROLLS}  (fixed 64-row slices: ${WINDOW * SCROLLS})`
  );
  // One block per scroll is the floor: the tail block holds the row that just
  // arrived, and no cache can hand back pixels that were never drawn. The head
  // is re-recorded once every time the window has eaten through it, which is
  // what the slack above one-per-scroll is.
  if (recorded > SCROLLS * 1.5) {
    throw new Error(
      `${SCROLLS} single-row scrolls re-recorded ${recorded} blocks, expected about ${SCROLLS}`
    );
  }
}

// 7. Update flicker, and the cost of holding depth (card #721).
//
// "Flicker" is not a feeling, it is a number: how much of the drawn window a
// single update invalidates. A refresh that replaces the window invalidates all
// of it -- every picture-cache block misses, the whole grid is re-recorded, and
// the reader sees the pane blink and jump once a second. A refresh that places
// the read against the window it already has invalidates only the rows that
// actually moved.
//
// The two policies are measured here against the same frames, so the difference
// is the change and nothing else:
//
//   before  release/2.0: an HTTP refresh replaced the window
//             (`replaceTerminalWindow(value, lineLimit)`)
//   after   this branch: every source folds through `foldPaneRead`
//
// The frames are the pane shape every bug on this card was measured against: a
// transcript scrolling under an eight-row composer with a timer that repaints
// on every frame, and an HTTP refresh that returns one screen however deep it
// asks -- which is what a `max_offset_from_bottom: 0` pane really does, measured
// on the loopback fleet at 63 rows for lines=240, lines=720 and lines=2000
// alike.
{
  const VIEWPORT = 65;
  const COMPOSER = 8;
  const HELD = 2_000;
  const UPDATES = 40;

  const composer = (tick: number): string[] => [
    '─'.repeat(78), '❯ ', '─'.repeat(78), '  ⏵⏵ accept edits on',
    '  ✻ agent: sonnet', '', `  ${tick}m ${tick % 60}s · ↓ ${tick * 37} tokens`, '',
  ];
  const transcript = (index: number): string =>
    `⏺ transcript row ${index} 你好世界 of the agent's answer`;

  // A window the reader has paged to its full depth.
  const paged = Array.from({ length: HELD }, (_, index) => transcript(index)).join('\n');
  // What each refresh actually returns: one screen, and nothing deeper.
  const screens: string[] = [];
  for (let update = 0; update < UPDATES; update += 1) {
    const top = HELD - VIEWPORT + COMPOSER + update * 3;
    screens.push([
      ...Array.from({ length: VIEWPORT - COMPOSER }, (_, row) => transcript(top + row)),
      ...composer(update),
    ].join('\n'));
  }

  const drawn = (policy: 'before' | 'after'): { blocks: number; recorded: number; rows: number } => {
    const refresh = createChunkRecorder();
    let window = paged;
    refresh(parseTerminalSnapshot(window));
    let blocks = 0;
    let recorded = 0;
    let rows = 0;
    for (const screen of screens) {
      window = policy === 'before'
        // release/2.0: the answer *is* the window. This is the whole bug.
        ? screen
        : foldPaneRead(window, screen, 'refresh', HELD);
      const result = refresh(parseTerminalSnapshot(window));
      blocks += result.blocks;
      recorded += result.recorded;
      rows += result.rows;
    }
    return { blocks, recorded, rows };
  };

  const before = drawn('before');
  const after = drawn('after');
  // The share is the honest comparison and the raw counts are not: the two
  // policies do not leave the reader holding the same amount of pane. `before`
  // redraws almost all of a 65-row window; `after` redraws a twentieth of a
  // 2000-row one.
  const beforeShare = (before.rows / (UPDATES * VIEWPORT)) * 100;
  const afterShare = (after.rows / (UPDATES * HELD)) * 100;
  console.log(`\nupdate flicker         ${HELD}-row window, ${UPDATES} refreshes of a 65-row screen`);
  console.log(
    `  before  ${(before.rows / UPDATES).toFixed(0)} rows re-recorded per update `
    + `= ${beforeShare.toFixed(1)}% of the window, blocks ${before.recorded}/${before.blocks}`
  );
  console.log(
    `  after   ${(after.rows / UPDATES).toFixed(0)} rows re-recorded per update `
    + `= ${afterShare.toFixed(1)}% of the window, blocks ${after.recorded}/${after.blocks}`
  );
  console.log(`  share of the drawn window redrawn per update: ${beforeShare.toFixed(1)}% -> ${afterShare.toFixed(1)}%`);

  // And the depth each policy leaves the reader holding, which is the same
  // number seen from the other side: the flicker *is* the history going away.
  // A reader parked 900 rows up does not see a redraw, they see the pane sail
  // out from under them and come back somewhere else.
  let held = paged;
  for (const screen of screens) held = foldPaneRead(held, screen, 'refresh', HELD);
  console.log(`  before  window depth ${screens.at(-1)!.split('\n').length} rows (a screen)`);
  console.log(`  after   window depth ${held.split('\n').length} rows`);
  console.log(`  after   window bytes ${held.length} (cap ${HELD} rows)`);

  if (held.split('\n').length < HELD) {
    throw new Error(`a refresh shrank a paged window to ${held.split('\n').length} rows`);
  }

  // The fold itself has to be cheap enough to run once a second on a phone
  // while the reader is scrolling.
  bench('fold refresh @2000', 200, () => {
    foldPaneRead(paged, screens[0], 'refresh', HELD);
  });
  bench('fold frame @2000', 200, () => {
    foldPaneRead(paged, screens[0], 'frame', HELD);
  });
  bench('fold frame @240', 500, () => {
    foldPaneRead(paged.split('\n').slice(-240).join('\n'), screens[0], 'frame', 240);
  });
}

// 8. Depth -- 2000 rows held, and what it costs to hold them.
//
// The card asks for scroll to stay smooth with 2000 rows held. The app plans
// chunks over the *whole* window (`skia-terminal.tsx` passes `frame.lines`, not
// a viewport slice) and scrolls the Skia canvas over the recordings, so a drag
// costs nothing at all -- there is no re-plan while a finger is down. What
// depth actually costs is three things, and these are they: the parse, the
// blocks the window is cut into, and the re-plan when an update lands while the
// reader is somewhere up in the history.
{
  const HELD = 2_000;
  const lines = buildSnapshotLines(HELD);
  const held = parseTerminalSnapshot(lines.join('\n'));
  const refresh = createChunkRecorder();
  const cold = refresh(held);

  console.log(`\ndepth                  ${HELD} rows held`);
  console.log(`  blocks               ${cold.blocks} for ${HELD} rows, ${cold.recorded} recorded cold`);

  // An update landing while the reader is scrolled up: the window grows by a
  // few rows at the bottom and loses the same few off the top. Only the blocks
  // that actually changed may be re-recorded -- everything the reader is
  // looking at is untouched, which is what "no flicker" means when they are not
  // at the bottom.
  let churned = 0;
  let planned = 0;
  const UPDATES = 30;
  for (let update = 1; update <= UPDATES; update += 1) {
    const grown = [...lines.slice(update * 3), ...buildSnapshotLines(update * 3)];
    const result = refresh(parseTerminalSnapshot(grown.join('\n')));
    churned += result.recorded;
    planned += result.blocks;
  }
  console.log(`  blocks re-recorded   ${churned}/${planned} over ${UPDATES} updates at depth`);

  // Memory: the window is a bounded string and the cache is a bounded number of
  // recordings. Neither may grow with how long the pane has been watched.
  console.log(`  window bytes         ${lines.join('\n').length} at ${HELD} rows`);

  bench('parse @2000', 20, () => {
    parseTerminalSnapshot(lines.join('\n'));
  });
  bench('plan @2000 warm', 2000, () => {
    refresh(held);
  });
}
