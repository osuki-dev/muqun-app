// What the chat view does with a transcript the gateway wrote down twice, and
// with a window that slid under new output.
//
// The fixtures are the owner's own Claude Code pane (herdr `w17:p1`), read off
// the screen: Claude Code prints `✻ Waiting for N background agents to finish`
// into its transcript every time the count changes, so the same banner several
// times over is genuine output -- while a whole screen of it turning up a second
// time, below newer messages, is the gateway's buffer appending a screen it
// could not place.
import { describe, expect, test } from 'bun:test';

import { collapseRepeatedParts, panePartsFromResponse, type PanePart } from '../pane-parts';

type Block = [type: 'text' | 'status' | 'prompt', text: string, rows?: number];

/** Wire parts laid out top to bottom from `firstRow`, one blank row between. */
function wire(blocks: readonly Block[], firstRow = 0) {
  let row = firstRow;
  return blocks.map(([type, text, rows = 1]) => {
    const range = { start: row, end: row + rows - 1 };
    row += rows + 1;
    const payload = type === 'text' ? { markdown: text } : { text };
    return { type, ...payload, fallback_text: text, range };
  });
}

function read(blocks: readonly Block[], firstRow = 0): PanePart[] {
  return panePartsFromResponse({
    schema_version: '1.0.0',
    capabilities: { parts: true },
    data: { parts: wire(blocks, firstRow) },
  }).parts;
}

const texts = (parts: readonly PanePart[]) => parts.map((part) => part.fallback_text);

const W2: Block = ['status', '✻ Waiting for 2 background agents to finish'];
const W3: Block = ['status', '✻ Waiting for 3 background agents to finish'];
const IOS_DONE: Block = [
  'text',
  '● Agent "iOS re-check of today\'s fixes on Mac" finished · 1h 2m 10s',
];
const SPAWN_GATEWAY: Block = [
  'text',
  '● Agent(Gateway: tmux connected means a live server) Opus 5.5\n  ⎿  Backgrounded agent (↓ to manage · ctrl+o to expand)',
  2,
];
const SPAWN_APP: Block = [
  'text',
  '● Agent(App: Continue row for a gone workspace) Sonnet 5.5\n  ⎿  Backgrounded agent (↓ to manage · ctrl+o to expand)',
  2,
];
const IOS_REPORT: Block = [
  'text',
  '● iOS 复查结果（Mac 上用撤销横屏后的头 deea408 重新 prebuild + 构建，装到 iPhone 16 Pro / iPad Pro 13 / iPhone 18 Pro(iOS 27)）：',
];
const GATEWAY_DONE: Block = [
  'text',
  '● Agent "Gateway: tmux connected means a live server" finished · 6m 37s',
];
const GATEWAY_EDIT: Block = [
  'text',
  '  Made 1 scratchpad edit +12, pushed to feat/t3-agent-adapter, ran 2 shell commands',
];
const GATEWAY_REPORT: Block = [
  'text',
  '● gateway 那个根因修好并合入 push 了（a35d06f，PR #41 已更新）',
];
const BACKGROUND: Block = [
  'text',
  '● Background command "Update the Mac gateway to the pushed head" completed (exit code 0)',
];
const READ_TWO: Block = ['text', '  Read 2 files, ran 1 shell command'];
const MAC_GATEWAY: Block = [
  'text',
  '● Mac 的 gateway 已更新到 a35d06f，没有 tmux server 时 discovery 现在正确报 tmux: false。',
];
const APP_DONE: Block = [
  'text',
  '● Agent "App: Continue row for a gone workspace" finished · 11m 13s',
];

/** The transcript as Claude Code actually printed it, oldest first. */
const TRANSCRIPT: Block[] = [
  W2,
  IOS_DONE,
  SPAWN_GATEWAY,
  SPAWN_APP,
  IOS_REPORT,
  W3,
  GATEWAY_DONE,
  GATEWAY_EDIT,
  GATEWAY_REPORT,
  W2,
  BACKGROUND,
  READ_TWO,
  MAC_GATEWAY,
];

describe('a screen the gateway wrote down twice', () => {
  test('an older screen appended below newer output is one block, not two', () => {
    // The gateway's buffer after the screen jumped back to an older position
    // (no placement found, so the older screen went on the end) and then down
    // again (the newest screen went on the end after it).
    const olderScreen: Block[] = [W2, IOS_DONE, SPAWN_GATEWAY, SPAWN_APP, IOS_REPORT];
    const newestScreen: Block[] = [
      GATEWAY_REPORT,
      W2,
      BACKGROUND,
      READ_TWO,
      MAC_GATEWAY,
      W3,
      APP_DONE,
    ];
    const parts = read([...TRANSCRIPT, ...olderScreen, ...newestScreen]);

    const collapsed = collapseRepeatedParts(parts);

    expect(texts(collapsed)).toEqual(texts(read([...TRANSCRIPT, W3, APP_DONE])));
    // Not "every banner once": the transcript printed two different counts at
    // four different moments, and all four are still there.
    expect(texts(collapsed).filter((text) => text.includes('Waiting for'))).toHaveLength(4);
  });

  test('the rows a jump re-sends at the seam are dropped with the repeat', () => {
    // Measured on a live gateway against a scripted alternate-screen agent:
    // `[...56 57 58][24..41][57 58 59...]` -- the screen after the jump re-sends
    // the two messages the buffer already ended with before the older screen.
    const message = (n: number): Block => [
      'text',
      `● Message number ${n}: distinctive ${n * 7919}`,
    ];
    const range = (from: number, to: number) =>
      Array.from({ length: to - from + 1 }, (_, i) => message(from + i));
    const parts = read([...range(1, 58), ...range(24, 41), ...range(57, 62)]);

    expect(texts(collapseRepeatedParts(parts))).toEqual(texts(read(range(1, 62))));
  });

  test('genuinely new blocks stay distinct: another agent, another time, another count', () => {
    const blocks: Block[] = [
      W2,
      ['text', '● Agent "Website update for 3.1.0" finished · 24m 35s'],
      W2,
      ['text', '● Agent "Website update for 3.1.0" finished · 35s'],
      W3,
      W2,
      ['text', '  Read 1 file'],
      W2,
      ['text', '  Read 1 file'],
    ];
    const parts = read(blocks);

    expect(collapseRepeatedParts(parts)).toBe(parts);
  });

  test('a short repeat is history, not a copy', () => {
    // The same banner and the same one-line summary twice in a row is what a
    // session waiting on agents prints. Two parts is below the block size.
    const blocks: Block[] = [W2, READ_TWO, IOS_REPORT, W2, READ_TWO];

    expect(texts(collapseRepeatedParts(read(blocks)))).toEqual(texts(read(blocks)));
  });
});
