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

import { buildPaneChatItems } from '../pane-chat';
import {
  collapseRepeatedParts,
  panePartsFromResponse,
  panePartsRefreshKey,
  reconcilePaneParts,
  type PanePart,
} from '../pane-parts';

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

describe('a window that slid under new output', () => {
  test('an unchanged part keeps its id when every source row moved', () => {
    const first = reconcilePaneParts([], 0, read(TRANSCRIPT, 0));
    // Two new blocks printed; the gateway serves the last N rows of its buffer,
    // so the window's top moved down by the six rows they took.
    const slid = read([...TRANSCRIPT.slice(2), W3, APP_DONE], 0);
    const second = reconcilePaneParts(first.parts, first.offset, slid);

    // Without reconciling, every one of these would have been renumbered.
    expect(slid[0]?.id).not.toBe(first.parts[2]?.id);
    for (let index = 0; index < TRANSCRIPT.length - 2; index += 1) {
      expect(second.parts[index]?.id).toBe(first.parts[index + 2]?.id as string);
    }
    expect(new Set(second.parts.map((part) => part.id)).size).toBe(second.parts.length);
  });

  test('so the chat rows already on screen are the same objects after the slide', () => {
    const first = reconcilePaneParts([], 0, read(TRANSCRIPT, 0));
    const before = buildPaneChatItems(first.parts, { detail: 'detailed' });
    const second = reconcilePaneParts(
      first.parts,
      first.offset,
      read([...TRANSCRIPT.slice(2), W3, APP_DONE], 0)
    );
    const after = buildPaneChatItems(second.parts, { detail: 'detailed' }, before);

    const reused = after.filter((item) => before.includes(item));
    // Everything that was on screen and still is -- all but the two that slid
    // off the top -- is the very same row object, so the list neither remounts
    // nor re-renders it.
    expect(reused).toHaveLength(TRANSCRIPT.length - 2);
  });

  test('a part still being written keeps its id while it grows', () => {
    const first = reconcilePaneParts([], 0, read([...TRANSCRIPT, ['text', '● 正在']], 0));
    const grown = read([...TRANSCRIPT.slice(1), ['text', '● 正在构建']], 0);
    const second = reconcilePaneParts(first.parts, first.offset, grown);

    expect(second.parts.at(-1)?.id).toBe(first.parts.at(-1)?.id);
  });

  test('a first read is keyed exactly as the gateway numbered it', () => {
    const parts = read(TRANSCRIPT, 0);
    const first = reconcilePaneParts([], 0, parts);

    expect(first.offset).toBe(0);
    expect(first.parts).toBe(parts);
  });
});

describe('copies that stack, and a composer frozen into history', () => {
  // Owner's pane `w17:p1`, 2026-10-04 18:24 (`live3-raw-1`): the gateway served
  // the screen twice over, and a stacked replay of that read behind the screen
  // before it put three renderings of the same turn on one list, each with the
  // composer box the screen was showing when it was committed.
  const RULE = '─'.repeat(160);
  const MADE_TWO: Block = [
    'text',
    '  Made 2 scratchpad edits +28, searched for 1 pattern, ran 8 shell commands',
  ];
  const BASH: Block = [
    'text',
    "● Bash(python3 - <<'EOF'\n      p='release-notes/v0.13.0.md'…)\n  ⎿  Updated release-notes/v0.13.0.md (+4 -0)",
    3,
  ];
  const R: Block[] = [
    ['text', '  Ran 1 shell command'],
    ['text', '● 目录补全这项两端都已合并推送：'],
    [
      'text',
      '  - gateway feat/t3-agent-adapter → 052c045（941 测试通过，PR #41 描述与 release notes 已更新）',
      2,
    ],
    [
      'text',
      '  本机新 gateway 二进制已编好，等手机模拟器上这轮实况观察（已跑到第 8 轮）结束再安装重启',
    ],
    W2,
    ['text', '● Agent "Observe live Claude pane for duplicates" finished · 11m 31s'],
    [
      'text',
      '● Observation on the old gateway: the live area is clean, but history still holds one real duplicate',
    ],
    ['text', '  Made 1 scratchpad edit +12, ran 4 shell commands\n  ⎿  Resuming agent ad738ae', 2],
    ['text', '  Made 1 scratchpad edit +13, ran 1 shell command'],
    [
      'text',
      '● 本机 gateway 已换成 052c045 并重启（herdr/tmux 都正常连接，T3/OpenCode 已重新接上）。',
    ],
  ];
  const FEEDBACK: Block = [
    'text',
    '╭────────\n│ ✻ Bug report drafted: iOS verification ran on stale heads\n╰────────╯',
    3,
  ];
  /** The composer the pane draws under its transcript, with the mode line and roster. */
  const composer = (roster: string): Block[] => [
    ['text', `                                   Update available! Run: claude update\n${RULE}`, 2],
    ['prompt', '❯ 做好了没'],
    ['text', `${RULE}\n  ⏵⏵ bypass permissions on · ⧉ Muqun 助手化方向 · ← for agents`, 2],
    ['text', `  ● main\n  ◯ general-purpose  ${roster}`, 2],
  ];
  const promptsOf = (parts: readonly PanePart[]) =>
    parts.filter((part) => part.fallback_text.includes('做好了没')).length;

  test('three stacked copies of a turn come out as one, with the composer only at the tail', () => {
    const parts = read([
      ...R,
      W3,
      FEEDBACK,
      ...composer('Testing open-web-service-sheet keyboard gap'),
      MADE_TWO,
      BASH,
      ...R,
      FEEDBACK,
      ...composer('Typing port into web-service sheet'),
      BASH,
      ...R,
      FEEDBACK,
      ...composer('Reviewing live3-0.png emulator screenshot'),
    ]);

    const collapsed = collapseRepeatedParts(parts);
    const textsOut = texts(collapsed);

    // Every part of the turn once. The Bash block used to survive its second
    // copy: the copy it repeats had been folded against the first screen in its
    // middle, so what was kept no longer lined up with it.
    for (const [, text] of [...R.filter((block) => block !== W2), MADE_TWO, BASH]) {
      expect(textsOut.filter((out) => out === text)).toHaveLength(1);
    }
    // One composer, and it is the live one at the bottom.
    expect(promptsOf(collapsed)).toBe(1);
    expect(textsOut.at(-1)).toContain('Reviewing live3-0.png');
    expect(textsOut.at(-3)).toBe('❯ 做好了没');
  });

  test('a frozen composer takes the status that was spinning above it', () => {
    const swirl: Block = ['status', '· Swirling… (1m 22s · ↓ 3.5k tokens)'];
    const parts = read([
      ...R,
      swirl,
      ...composer('Building release APK'),
      MADE_TWO,
      BASH,
      ['text', '● Agent "Gateway: branch info in vcs/files" finished · 4m 2s'],
      ...composer('Reviewing live3-0.png emulator screenshot'),
    ]);

    const textsOut = texts(collapseRepeatedParts(parts));

    expect(textsOut).not.toContain(swirl[1]);
    expect(promptsOf(read(textsOut.map((text) => ['text', text] as Block)))).toBe(1);
    expect(textsOut).toContain(MADE_TWO[1]);
  });

  test('a prompt the user sent is a turn, not a composer, even with the same words', () => {
    const blocks: Block[] = [
      ['prompt', '❯ 做好了没'],
      ['text', '● 快好了。'],
      ...composer('Reviewing live3-0.png emulator screenshot'),
    ];

    expect(texts(collapseRepeatedParts(read(blocks)))).toEqual(texts(read(blocks)));
  });

  test('genuine repeats stay: a lone banner, counts that changed, two turns with a message between', () => {
    const turnEnd: Block[] = [
      ['text', '● Done. Pushed to feat/multi-harness.'],
      W2,
      ['text', '  Read 1 file'],
    ];
    const blocks: Block[] = [
      W2,
      ['text', '● Agent "Website update for 3.1.0" finished · 35s'],
      W3,
      W2,
      ...turnEnd,
      ['prompt', '❯ 再推一次'],
      ...turnEnd,
    ];
    const parts = read(blocks);

    // Two turn endings with a message between them are two turns, though they
    // repeat part for part: three parts is a turn ending, and a copy the gateway
    // wrote is a screen.
    const collapsed = collapseRepeatedParts(parts);
    expect(texts(collapsed).filter((text) => text.includes('Waiting for 2'))).toHaveLength(4);
    expect(texts(collapsed).filter((text) => text === '❯ 再推一次')).toHaveLength(1);
  });
});

describe('a gateway that restarted under the reader', () => {
  // The gateway keeps history in memory, so a restart answers with one screen
  // -- the startup screen -- which sits somewhere in the middle of what the
  // reader was holding and shares nothing with its tail.
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const block = (letter: string): Block => ['text', `● Block ${letter}: ${letter.repeat(12)}`];

  test('a window anchored mid-history replaces what was held, with no copy of it', () => {
    const held = reconcilePaneParts([], 0, read(letters.map(block), 400));
    const restarted = read(['H', 'I', 'J', 'K', 'L', 'M'].map(block), 0);

    const next = reconcilePaneParts(held.parts, held.offset, restarted);

    expect(texts(next.parts)).toEqual(texts(restarted));
    expect(new Set(next.parts.map((part) => part.id)).size).toBe(next.parts.length);
  });

  test('a window sharing nothing with what was held replaces it too', () => {
    const held = reconcilePaneParts([], 0, read(letters.slice(0, 10).map(block), 0));
    const fresh = read([W2, IOS_DONE, MAC_GATEWAY], 0);

    expect(texts(reconcilePaneParts(held.parts, held.offset, fresh).parts)).toEqual(texts(fresh));
  });
});

describe('when the transcript is read again', () => {
  test('new output re-reads even when the pane revision never moves', () => {
    // Herdr's pane revision counts metadata: 4 for hours on a busy Claude pane.
    const before = panePartsRefreshKey(4, '● one\n✻ Swirling… (1m 22s)');
    const after = panePartsRefreshKey(4, '● one\n✻ Swirling… (1m 23s)');

    expect(after).not.toBe(before);
  });

  test('nothing new is the same key, and a revision change alone still re-reads', () => {
    const output = '● one\n● two';

    expect(panePartsRefreshKey(4, output)).toBe(panePartsRefreshKey(4, output));
    expect(panePartsRefreshKey(5, output)).not.toBe(panePartsRefreshKey(4, output));
  });
});

describe('stale composer boxes, whatever was typed in them', () => {
  // `live4-walk-05` (owner's pane w17:p1, 19:19): a frozen screen mid-history
  // with an empty `❯`, the spinner above it, the mode line and the roster under
  // it -- and the next screen's first rows glued onto the roster with no blank
  // row between.
  const RULE = '─'.repeat(160);
  const box = (prompt: string, roster: string[]): Block[] => [
    ['text', RULE],
    ['prompt', prompt],
    ['text', `${RULE}\n  ⏵⏵ bypass permissions on · 1 shell · ⧉ Muqun 助手化方向`, 2],
    ['text', ['  ● main', ...roster].join('\n'), 1 + roster.length],
  ];
  const BEFORE: Block[] = [
    ['text', '  Made 2 scratchpad edits +23, pushed to feat/multi-harness'],
    ['text', '● Finishing the gateway release note, pushing it, and installing the binary.'],
    ['text', '● Running 1 shell command…'],
  ];
  const CHANNELING: Block = ['status', '✻ Channeling… (7m 6s · ↓ 10.4k tokens)'];
  const GLUED = [
    '  ⎿  1 file changed, 329 insertions(+), 2 deletions(-)',
    '  ⎿  Updated src/terminal/scrollback.rs (+329 -2)',
  ];
  const promptRows = (parts: readonly PanePart[]) =>
    parts.filter((part) => part.type === 'prompt').map((part) => part.fallback_text);

  test('an empty frozen box goes with its spinner, mode line and roster; the rows glued under it stay', () => {
    const frozenRoster = [
      '  ◯ general-purpose  Checking iPad landscape hero art',
      '  ◯ general-purpose  Checking format tooling in package.json',
      ...GLUED,
    ];
    const parts = read([
      ...BEFORE,
      CHANNELING,
      ...box('❯', frozenRoster),
      ['text', '● Gateway release note pushed; installing the binary now.'],
      W2,
      ...box('❯ 做好了没', ['  ◯ general-purpose  Reviewing live4 walk frames']),
    ]);

    const out = collapseRepeatedParts(parts);
    const textsOut = texts(out);

    expect(promptRows(out)).toEqual(['❯ 做好了没']);
    expect(textsOut).not.toContain(CHANNELING[1]);
    expect(textsOut.some((text) => text.includes('Checking iPad landscape'))).toBe(false);
    // The tool block's tail was transcript, not roster.
    expect(textsOut).toContain(GLUED.join('\n'));
    // The live box is whole, and the banner above it is transcript.
    expect(textsOut.at(-1)).toContain('Reviewing live4 walk frames');
    expect(textsOut).toContain(W2[1]);
  });

  test('a box with a sent prompt in it is still a frozen box when it is not the last', () => {
    // `live4-hist-6`: two screens, each ending in `❯ 做好了没` between rules.
    const parts = read([
      ...BEFORE,
      W2,
      ...box('❯ 做好了没', ['  ◯ general-purpose  Opening the Primes OpenCode session']),
      ['text', '● Agent "Observe live Claude pane for duplicates" finished · 11m 31s'],
      ...box('❯ 再看一次', ['  ◯ general-purpose  Creating cycle4.sh and loop4.sh']),
    ]);

    const out = collapseRepeatedParts(parts);

    expect(promptRows(out)).toEqual(['❯ 再看一次']);
    expect(texts(out).filter((text) => text.includes('Waiting for 2'))).toHaveLength(1);
  });

  test('a prompt the user sent, unframed, stays; so does the only box', () => {
    const blocks: Block[] = [
      ['prompt', '❯ terminal是否可以优化一下'],
      ['text', '● 可以，先看渲染路径。'],
      CHANNELING,
      ...box('❯', ['  ◯ general-purpose  Reading terminal surface']),
    ];

    expect(texts(collapseRepeatedParts(read(blocks)))).toEqual(texts(read(blocks)));
  });
});
