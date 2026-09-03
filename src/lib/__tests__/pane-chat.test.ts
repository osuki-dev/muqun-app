// The conversation model, and the promise the chat view's performance rests on.
//
// Two things are being pinned here. The obvious one is shape: prompts, folded
// runs of tool calls, and what a folded run says about itself. The one that
// actually matters is identity -- a transcript that grew by one line must
// return the *same objects* for every row that did not change, because that is
// what stops a streaming pane from re-rendering its whole history on every
// poll. The assertions therefore use `toBe`, not `toEqual`, on purpose.
import { describe, expect, test } from 'bun:test';

import {
  buildPaneChatItems,
  isSeparatorPart,
  MAX_ACTIVITY_RUN,
  normalizeRuleLines,
  signatureOfPart,
  summarizeActivity,
  type PaneChatItem,
  type PaneChatToolBlock,
} from '../pane-chat';
import type { PanePart } from '../pane-parts';

function text(id: string, markdown: string): PanePart {
  return { id, fallback_text: `⏺ ${markdown}`, type: 'text', markdown };
}

function prompt(id: string, value: string): PanePart {
  return { id, fallback_text: `❯ ${value}`, type: 'prompt', text: value };
}

function tool(
  id: string,
  tool: string,
  options: Partial<Omit<PaneChatToolBlock, 'id' | 'type' | 'tool'>> = {}
): PanePart {
  const input = options.input ?? `${tool} input`;
  const result = options.result ?? ['done'];
  return {
    id,
    fallback_text: `⏺ ${tool}(${input})\n  ⎿ ${result.join('\n')}`,
    type: 'tool-block',
    tool,
    input,
    result,
    status: options.status ?? 'ok',
    truncated: options.truncated ?? false,
  };
}

function status(id: string, value: string, spinner = false): PanePart {
  return { id, fallback_text: `✻ ${value}`, type: 'status', text: value, spinner };
}

const simplified = { detail: 'simplified' } as const;
const detailed = { detail: 'detailed' } as const;

describe('shape', () => {
  test('a prompt is the user speaking', () => {
    const [item] = buildPaneChatItems([prompt('r1-1', 'ship it')], simplified);
    expect(item?.kind).toBe('prompt');
    expect(item?.kind === 'prompt' ? item.text : '').toBe('ship it');
  });

  test('simplified folds an adjacent run of tool calls into one row', () => {
    const items = buildPaneChatItems(
      [
        prompt('r1-1', 'go'),
        tool('r2-2', 'Bash'),
        tool('r3-3', 'Bash'),
        tool('r4-4', 'Write'),
        text('r5-5', 'done'),
      ],
      simplified
    );
    expect(items.map((item) => item.kind)).toEqual(['prompt', 'activity', 'part']);
    const run = items[1];
    expect(run?.kind === 'activity' ? run.steps.length : 0).toBe(3);
    expect(run?.kind === 'activity' ? run.tools : []).toEqual(['Bash', 'Write']);
  });

  test('a run is only adjacent tool calls, not everything between two sentences', () => {
    const items = buildPaneChatItems(
      [tool('r1-1', 'Bash'), text('r2-2', 'thinking'), tool('r3-3', 'Bash')],
      simplified
    );
    expect(items.map((item) => item.kind)).toEqual(['activity', 'part', 'activity']);
  });

  test('detailed leaves every tool call as its own row', () => {
    const items = buildPaneChatItems([tool('r1-1', 'Bash'), tool('r2-2', 'Bash')], detailed);
    expect(items.map((item) => item.kind)).toEqual(['part', 'part']);
  });

  test('a long batch is split, so no single row can grow without bound', () => {
    const parts = Array.from({ length: MAX_ACTIVITY_RUN * 2 + 3 }, (_, index) =>
      tool(`r${index}-${index}`, 'Bash')
    );
    const items = buildPaneChatItems(parts, simplified);
    expect(items).toHaveLength(3);
    for (const item of items) {
      expect(item.kind === 'activity' ? item.steps.length : 0).toBeLessThanOrEqual(
        MAX_ACTIVITY_RUN
      );
    }
  });

  test('the worst status in a run is the one the folded row reports', () => {
    const items = buildPaneChatItems(
      [
        tool('r1-1', 'Bash'),
        tool('r2-2', 'Bash', { status: 'running' }),
        tool('r3-3', 'Bash', { status: 'error' }),
      ],
      simplified
    );
    expect(items[0]?.kind === 'activity' ? items[0].status : '').toBe('error');
  });

  test('one call reads as the call, several read as a count', () => {
    const one = [tool('r1-1', 'Bash', { input: 'git status\n--short' })] as PaneChatToolBlock[];
    expect(summarizeActivity(one, ['Bash'])).toBe('Bash · git status');
    const many = Array.from({ length: 4 }, (_, index) =>
      tool(`r${index}-${index}`, 'Bash')
    ) as PaneChatToolBlock[];
    // A bare count, not a list of tool names: the chip says "the agent did some
    // work here, move on", and naming the commands is the beginning of a
    // terminal rather than the end of one. The names are there once it is open.
    expect(summarizeActivity(many, ['Bash', 'Write'])).toBe('4 steps');
  });

  test('list keys stay unique even when two parts claim the same source rows', () => {
    const items = buildPaneChatItems([text('r0-0', 'one'), text('r0-0', 'two')], simplified);
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
  });
});

// What a page of earlier history is actually made of. The live tail carries one
// rule and one banner, so nobody noticed these were not folded; a page above the
// fold carries dozens of each, which is the noise being fixed here.
describe('the quiet reading survives a page of history', () => {
  test('a rule is a rule however it is drawn', () => {
    for (const rule of ['───────', '━━━━━━', '---', '***', '___', '════', '─── ───']) {
      expect(isSeparatorPart(text('r1-1', rule))).toBe(true);
    }
  });

  test('prose that merely contains a dash keeps its row', () => {
    for (const prose of ['well -- maybe', '-- ok', 'a', '--', '─x─', '...']) {
      expect(isSeparatorPart(text('r1-1', prose))).toBe(false);
    }
  });

  test('only text can be a rule', () => {
    expect(isSeparatorPart(tool('r1-1', 'Bash', { input: '---' }))).toBe(false);
  });

  test('simplified drops the rules and keeps everything else', () => {
    const items = buildPaneChatItems(
      [
        text('r1-1', '────────────'),
        text('r2-2', 'starting'),
        text('r3-3', '────────────'),
        text('r4-4', 'done'),
      ],
      simplified
    );
    expect(items).toHaveLength(2);
    expect(items.map((item) => (item.kind === 'part' ? item.part.id : ''))).toEqual([
      'r2-2',
      'r4-4',
    ]);
  });

  test('a rule between two batches does not split the run in two', () => {
    const items = buildPaneChatItems(
      [tool('r1-1', 'Bash'), text('r2-2', '────────'), tool('r3-3', 'Write')],
      simplified
    );
    expect(items.map((item) => item.kind)).toEqual(['activity']);
    expect(items[0]?.kind === 'activity' ? items[0].steps.length : 0).toBe(2);
  });

  test('merging across a rule still cannot grow a row without bound', () => {
    const parts: PanePart[] = [];
    for (let index = 0; index < MAX_ACTIVITY_RUN * 2; index += 1) {
      parts.push(tool(`r${index}-${index}`, 'Bash'), text(`s${index}-${index}`, '─────'));
    }
    const items = buildPaneChatItems(parts, simplified);
    for (const item of items) {
      expect(item.kind === 'activity' ? item.steps.length : 0).toBeLessThanOrEqual(
        MAX_ACTIVITY_RUN
      );
    }
    expect(items).toHaveLength(2);
  });

  test('only the newest banner survives, wherever it sits', () => {
    const items = buildPaneChatItems(
      [
        status('r1-1', 'Reading…'),
        text('r2-2', 'a thought'),
        status('r3-3', 'Compacting…'),
        text('r4-4', 'another'),
        status('r5-5', 'Working…', true),
      ],
      simplified
    );
    expect(items.map((item) => (item.kind === 'part' ? item.part.id : ''))).toEqual([
      'r2-2',
      'r4-4',
      'r5-5',
    ]);
  });

  test('a banner in the middle is the newest one when it is the only one', () => {
    const items = buildPaneChatItems(
      [status('r1-1', 'Working…'), text('r2-2', 'after')],
      simplified
    );
    expect(items).toHaveLength(2);
  });

  test('detailed still shows every rule and every banner', () => {
    const parts = [
      text('r1-1', '────────'),
      status('r2-2', 'Reading…'),
      status('r3-3', 'Working…'),
    ];
    expect(buildPaneChatItems(parts, detailed)).toHaveLength(3);
  });
});

// The shapes that got past the old part-level test and put a screen of
// hairlines in front of a reader. Every sample below is taken verbatim from a
// live pane on the loopback gateway, one per agent, which is also the point:
// four agents draw four dividers and the judgement names none of them.
describe('a rule is judged by its characters, not by its agent', () => {
  const clean = (markdown: string) => normalizeRuleLines(markdown);

  test('a rule line is swallowed wherever it sits in a part', () => {
    // Claude: a 242-character rule sharing one part with the status footer
    // under it. Judged whole this part is not "all one rule character", so
    // every line of it -- rule included -- used to be drawn.
    const { markdown, label } = clean(`${'─'.repeat(242)}\n  ⏵⏵ auto mode on · ↓ to manage`);
    expect(markdown).toBe('  ⏵⏵ auto mode on · ↓ to manage');
    expect(label).toBeNull();
  });

  test('indentation does not hide a rule', () => {
    expect(clean('    ────────────').markdown).toBe('');
    expect(clean('\t═══════════').markdown).toBe('');
  });

  test('a rule is dominated by rule characters, not made of one of them', () => {
    // What "every non-space character is the same character" could not see.
    for (const mixed of ['═══ ─── ═══', '──────────╌╌╌', '╭──────────╮', '┌────┬────┐']) {
      expect(clean(mixed).markdown).toBe('');
    }
  });

  test('the block underline one agent ends every prompt with is a rule', () => {
    // opencode draws no dashes at all: it closes a prompt block with `╹` and a
    // run of upper-half blocks. A detector that knew only the dash family --
    // which is every list of "separator characters" written from memory --
    // misses this agent entirely.
    expect(clean(`╹${'▀'.repeat(226)}`).markdown).toBe('');
  });

  test('a heading at the end of its rule keeps the heading', () => {
    // Claude's form: the words sit after a very long run.
    const { markdown, label } = clean(
      `${'─'.repeat(199)} 分析 react-native-runtimes 项目的适用性 ──`
    );
    expect(markdown).toBe('分析 react-native-runtimes 项目的适用性');
    expect(label).toBe('分析 react-native-runtimes 项目的适用性');
  });

  test('a heading at the start of its rule keeps the heading', () => {
    // Codex's form, and the reason the anchor test cannot require the long run
    // to be on the left: here it is on the right, behind a single character.
    expect(clean(`─ Worked for 1m 13s ${'─'.repeat(220)}`).label).toBe('Worked for 1m 13s');
  });

  test('a heading framed on both sides keeps the heading', () => {
    expect(clean('── 標題文字 ──').label).toBe('標題文字');
    expect(clean('=== Results ===').label).toBe('Results');
  });

  test('a heading is a heading only when the part is nothing else', () => {
    // The words still survive when there is prose around them -- they are just
    // part of the prose, not a section of their own.
    const { markdown, label } = clean('──── Analysis ────\nIt is fine.');
    expect(markdown).toBe('Analysis\nIt is fine.');
    expect(label).toBeNull();
  });

  test('a paragraph that opened with a dash is not a heading', () => {
    const long = 'x'.repeat(200);
    expect(clean(`──── ${long}`).label).toBeNull();
  });

  test('emphasis cannot draw the ends of a rule', () => {
    // `**bold**` is a line framed by two runs of two rule characters, which is
    // exactly the shape of `── heading ──`. It has to survive intact.
    for (const emphasised of ['**bold**', '__underlined__', '*just this*']) {
      expect(clean(emphasised).markdown).toBe(emphasised);
      expect(clean(emphasised).label).toBeNull();
    }
  });

  test('markdown that merely contains rule characters is left alone', () => {
    for (const kept of [
      '- a list item',
      '  - a nested item',
      '| --- | --- |',
      'a range of 3-5, or 6--7',
      'react-native-runtimes is a project',
      '│ boxed but not ruled │',
    ]) {
      expect(clean(kept).markdown).toBe(kept);
    }
  });

  test('a run of rules collapses instead of leaving the hole it came from', () => {
    // Qoder stacks three rules through one part as a composer frame. Dropping
    // each one and leaving its blank line behind would cost the same height it
    // was costing before.
    const rule = '─'.repeat(242);
    const { markdown } = clean(
      `${rule}\n YOLO Shift+Tab to Auto Mode\n${rule}\n${rule}\n GLM-5.2 Model · ~/.ws\n${rule}\n`
    );
    expect(markdown).toBe(' YOLO Shift+Tab to Auto Mode\n GLM-5.2 Model · ~/.ws');
  });

  test('a blank line between two things that are still there survives', () => {
    expect(clean('────\nfirst\n\nsecond\n────').markdown).toBe('first\n\nsecond');
  });

  test('prose is returned as the very same string, unsplit', () => {
    // The cheap path: a paragraph with no line starting in a rule character is
    // never split, never rebuilt, and comes back identical.
    const prose = 'A sentence — with an em dash — and nothing else.\nA second line.';
    expect(clean(prose).markdown).toBe(prose);
  });

  test('a part of nothing but rules keeps no row at all', () => {
    const items = buildPaneChatItems(
      [
        text('r1-1', `${'─'.repeat(242)}\n${'━'.repeat(80)}\n╭────────╮`),
        text('r2-2', 'still here'),
      ],
      simplified
    );
    expect(items).toHaveLength(1);
  });

  test('a part that is one drawn heading becomes a label row', () => {
    const items = buildPaneChatItems([text('r1-1', '──── Analysis ────')], simplified);
    expect(items[0]?.kind).toBe('label');
    expect(items[0]?.kind === 'label' ? items[0].text : '').toBe('Analysis');
  });

  test('a part keeps its own object when nothing needed cleaning', () => {
    const part = text('r1-1', 'nothing to clean here');
    const items = buildPaneChatItems([part], simplified);
    expect(items[0]?.kind === 'part' ? items[0].part : null).toBe(part);
  });

  test('detailed mode is still the transcript exactly as it arrived', () => {
    // The raw reading is the whole point of the other mode: nothing is
    // swallowed there, and no markdown is rewritten.
    const part = text('r1-1', `${'─'.repeat(60)}\n──── Analysis ────\nprose`);
    const items = buildPaneChatItems([part], detailed);
    expect(items).toHaveLength(1);
    expect(items[0]?.kind === 'part' ? items[0].part : null).toBe(part);
  });

  test('a rule with a heading in it still does not split a run of work', () => {
    const items = buildPaneChatItems(
      [tool('r1-1', 'Bash'), text('r2-2', `${'─'.repeat(40)} Next ──`), tool('r3-3', 'Write')],
      simplified
    );
    // The heading is a row of its own between them -- it is a subject change
    // the agent announced -- but neither batch was lost.
    expect(items.map((item) => item.kind)).toEqual(['activity', 'label', 'activity']);
  });
});

describe('identity across a streaming update', () => {
  const history: PanePart[] = [
    prompt('r1-1', 'go'),
    text('r2-2', 'starting'),
    tool('r3-3', 'Bash'),
    tool('r4-4', 'Bash'),
    text('r5-5', 'half way'),
  ];

  test('appending a part leaves every earlier row untouched', () => {
    const before = buildPaneChatItems(history, simplified);
    const after = buildPaneChatItems([...history, text('r6-6', 'done')], simplified, before);
    expect(after).toHaveLength(before.length + 1);
    for (let index = 0; index < before.length; index += 1) {
      expect(after[index]).toBe(before[index] as PaneChatItem);
    }
  });

  test('growing the last part rebuilds that row and nothing before it', () => {
    const before = buildPaneChatItems(history, simplified);
    const grown = [...history.slice(0, -1), text('r5-5', 'half way and then some')];
    const after = buildPaneChatItems(grown, simplified, before);
    for (let index = 0; index < before.length - 1; index += 1) {
      expect(after[index]).toBe(before[index] as PaneChatItem);
    }
    expect(after[after.length - 1]).not.toBe(before[before.length - 1] as PaneChatItem);
  });

  test('a running tool block rewriting its last line in place is noticed', () => {
    // The case a length check alone would miss: same type, same length, and a
    // live block that would otherwise freeze on screen.
    const before = buildPaneChatItems([tool('r1-1', 'Bash', { result: ['Encoded 115/300'] })], {
      detail: 'detailed',
    });
    const after = buildPaneChatItems(
      [tool('r1-1', 'Bash', { result: ['Encoded 300/300'] })],
      { detail: 'detailed' },
      before
    );
    expect(after[0]).not.toBe(before[0] as PaneChatItem);
  });

  test('a step appended to a running batch keeps the batch in place', () => {
    const batch = [text('r1-1', 'start'), tool('r2-2', 'Bash', { status: 'running' })];
    const before = buildPaneChatItems(batch, simplified);
    const after = buildPaneChatItems([...batch, tool('r3-3', 'Bash')], simplified, before);
    expect(after).toHaveLength(2);
    expect(after[0]).toBe(before[0] as PaneChatItem);
    expect(after[1]).not.toBe(before[1] as PaneChatItem);
    expect(after[1]?.id).toBe(before[1]?.id ?? '');
  });

  test('loading earlier output keeps the rows already on screen', () => {
    const before = buildPaneChatItems(history, simplified);
    const earlier = [prompt('r0-0', 'before all this'), ...history];
    const after = buildPaneChatItems(earlier, simplified, before);
    expect(after).toHaveLength(before.length + 1);
    for (let index = 0; index < before.length; index += 1) {
      expect(after[index + 1]).toBe(before[index] as PaneChatItem);
    }
  });

  test('a page of earlier history folds without disturbing the rows on screen', () => {
    // The load-earlier case as it actually arrives: rules, spent banners and a
    // batch of tool calls, prepended in one go. Every row already on screen has
    // to come back as the same object, or the whole list re-renders under a
    // reader who is trying to keep their place.
    const live = [...history, status('r9-9', 'Working…', true)];
    const before = buildPaneChatItems(live, simplified);
    const earlier: PanePart[] = [
      prompt('r-9-9', 'the question before'),
      text('r-8-8', '────────────'),
      status('r-7-7', 'Reading…'),
      tool('r-6-6', 'Bash'),
      text('r-5-5', '────────────'),
      tool('r-4-4', 'Read'),
      status('r-3-3', 'Compacting…'),
      ...live,
    ];
    const after = buildPaneChatItems(earlier, simplified, before);
    // Seven older parts arrive as two rows: the rules and the spent banners are
    // gone, and the two batches either side of a rule are one run.
    expect(after).toHaveLength(before.length + 2);
    expect(after.slice(0, 2).map((item) => item.kind)).toEqual(['prompt', 'activity']);
    expect(after[1]?.kind === 'activity' ? after[1].steps.length : 0).toBe(2);
    for (let index = 0; index < before.length; index += 1) {
      expect(after[index + 2]).toBe(before[index] as PaneChatItem);
    }
  });

  test('changing the fold rebuilds, because the rows are different rows', () => {
    const before = buildPaneChatItems(history, simplified);
    const after = buildPaneChatItems(history, detailed, before);
    expect(after.map((item) => item.kind)).toEqual(['prompt', 'part', 'part', 'part', 'part']);
  });

  test('cleaning a part does not cost it its identity', () => {
    // The cleaned markdown is a pure function of the part, so a row whose part
    // has not moved has to come back as the same object -- otherwise every
    // poll would re-render every rule-bearing row, which is most of them.
    const noisy: PanePart[] = [
      text('r1-1', `${'─'.repeat(60)}\nstarting`),
      text('r2-2', '──── Analysis ────'),
      text('r3-3', 'plain prose'),
    ];
    const before = buildPaneChatItems(noisy, simplified);
    expect(before.map((item) => item.kind)).toEqual(['part', 'label', 'part']);
    const after = buildPaneChatItems([...noisy, text('r4-4', 'done')], simplified, before);
    for (let index = 0; index < before.length; index += 1) {
      expect(after[index]).toBe(before[index] as PaneChatItem);
    }
  });

  test('rebuilding from the same parts twice is idempotent', () => {
    const first = buildPaneChatItems(history, simplified);
    const second = buildPaneChatItems(history, simplified, first);
    for (let index = 0; index < first.length; index += 1) {
      expect(second[index]).toBe(first[index] as PaneChatItem);
    }
  });
});

describe('signatures', () => {
  test('a status part that starts spinning is a different row', () => {
    const still: PanePart = {
      id: 'r1-1',
      fallback_text: '✻ Working',
      type: 'status',
      text: 'Working',
      spinner: false,
    };
    expect(signatureOfPart(still)).not.toBe(signatureOfPart({ ...still, spinner: true }));
  });

  test('ticking a todo item is a different row', () => {
    const list: PanePart = {
      id: 'r1-1',
      fallback_text: 'todo',
      type: 'todo',
      items: [{ text: 'ship', done: false }],
    };
    expect(signatureOfPart(list)).not.toBe(
      signatureOfPart({ ...list, items: [{ text: 'ship', done: true }] })
    );
  });

  test('an unknown part is still comparable by its fallback', () => {
    const unknown: PanePart = {
      id: 'r1-1',
      fallback_text: 'something new',
      type: 'unknown',
      declaredType: 'sparkline',
    };
    expect(signatureOfPart(unknown)).toBe(signatureOfPart({ ...unknown }));
    expect(signatureOfPart(unknown)).not.toBe(
      signatureOfPart({ ...unknown, fallback_text: 'something else' })
    );
  });
});

// The reading the simplified view promises: a conversation, meaning what the
// user said and what the agent said back. Everything else is machinery, and the
// rules below are what keep it out of the flow.
describe('a conversation, not a terminal with bubbles', () => {
  function diff(id: string, file: string): PanePart {
    return {
      id,
      fallback_text: `Update(${file})`,
      type: 'diff',
      file,
      hunks: ['@@ -1 +1 @@', '-old', '+new'],
    };
  }

  function todo(id: string, done: number, total: number): PanePart {
    return {
      id,
      fallback_text: 'todo',
      type: 'todo',
      items: Array.from({ length: total }, (_, index) => ({
        text: `step ${index}`,
        done: index < done,
      })),
    };
  }

  test('only the user and the agent speak', () => {
    const items = buildPaneChatItems(
      [
        prompt('r1-1', 'add a toggle'),
        text('r2-2', '────────'),
        text('r3-3', 'Looking at the theme now.'),
        tool('r4-4', 'Read'),
        diff('r5-5', 'src/theme.ts'),
        todo('r6-6', 2, 3),
        tool('r7-7', 'Bash'),
        status('r8-8', 'Reading…'),
        text('r9-9', 'Done — the toggle is wired up.'),
        status('r10-10', 'Working…', true),
      ],
      simplified
    );
    // Prompt, prose, one chip for all four pieces of work, prose, one banner.
    expect(items.map((item) => item.kind)).toEqual(['prompt', 'part', 'activity', 'part', 'part']);
    expect(items[2]?.kind === 'activity' ? items[2].steps.length : 0).toBe(4);
    expect(items[4]?.kind === 'part' ? items[4].part.type : '').toBe('status');
  });

  test('a diff belongs to the call that produced it, not to the conversation', () => {
    const items = buildPaneChatItems([tool('r1-1', 'Edit'), diff('r2-2', 'src/a.ts')], simplified);
    expect(items).toHaveLength(1);
    expect(items[0]?.kind === 'activity' ? items[0].tools : []).toEqual(['Edit', 'Diff']);
  });

  test('a checklist the agent wrote is work, not speech', () => {
    const items = buildPaneChatItems([todo('r1-1', 1, 4)], simplified);
    expect(items[0]?.kind).toBe('activity');
    expect(items[0]?.kind === 'activity' ? items[0].summary : '').toBe('Todo · 1/4');
  });

  test('a lone diff names the file it patched', () => {
    const items = buildPaneChatItems([diff('r1-1', 'src/theme.ts')], simplified);
    expect(items[0]?.kind === 'activity' ? items[0].summary : '').toBe('Diff · src/theme.ts');
  });

  test('a run of work is a count and nothing else', () => {
    const items = buildPaneChatItems(
      [tool('r1-1', 'Read'), tool('r2-2', 'Grep'), diff('r3-3', 'src/a.ts')],
      simplified
    );
    expect(items[0]?.kind === 'activity' ? items[0].summary : '').toBe('3 steps');
  });

  test('a status carries no news about a run that failed', () => {
    // A diff and a checklist have no status of their own -- they are the result
    // of the call above them, so the chip must not read them as "ok" and bury
    // an error beside them.
    const items = buildPaneChatItems(
      [tool('r1-1', 'Bash', { status: 'error' }), diff('r2-2', 'src/a.ts')],
      simplified
    );
    expect(items[0]?.kind === 'activity' ? items[0].status : '').toBe('error');
  });

  test('a prompt the pane echoed back is drawn once', () => {
    const items = buildPaneChatItems(
      [prompt('r1-1', 'ship it'), prompt('r2-2', 'ship it'), text('r3-3', 'on it')],
      simplified
    );
    expect(items.map((item) => item.kind)).toEqual(['prompt', 'part']);
  });

  test('asking the same thing twice is two questions, not an echo', () => {
    // The echo is adjacent and identical; a repeat after an answer is the user
    // saying it again, and swallowing that would lose a turn.
    const items = buildPaneChatItems(
      [prompt('r1-1', 'again'), text('r2-2', 'ok'), prompt('r3-3', 'again')],
      simplified
    );
    expect(items.map((item) => item.kind)).toEqual(['prompt', 'part', 'prompt']);
  });

  test('detailed is still every part as its own row', () => {
    const parts = [
      prompt('r1-1', 'go'),
      prompt('r2-2', 'go'),
      text('r3-3', '────────'),
      tool('r4-4', 'Read'),
      diff('r5-5', 'src/a.ts'),
      todo('r6-6', 0, 2),
      status('r7-7', 'a'),
      status('r8-8', 'b'),
    ];
    expect(buildPaneChatItems(parts, detailed)).toHaveLength(parts.length);
  });
});
