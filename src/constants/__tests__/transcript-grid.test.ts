// The transcript's gutter grid, and the components that have to stay on it.
//
// Read from source where a component is involved: `bun test` cannot load
// react-native, and what drifts is a literal `paddingHorizontal: 10` creeping
// back into one block while the rest say 12.
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import {
  TRANSCRIPT_GRID,
  TRANSCRIPT_HANG,
  TRANSCRIPT_RULE_X,
  transcriptRuleTrim,
} from '@/constants/transcript-grid';
import { AGENT_TYPE } from '@/constants/agent-type';

const G = TRANSCRIPT_GRID;

test('the columns add up: inset + marker + gap is the text origin', () => {
  expect(G.inset + G.markerWidth + G.markerGap).toBe(G.textOrigin);
  expect(TRANSCRIPT_HANG).toBe(G.textOrigin - G.inset);
});

test('the hanging rule is centred in the marker column', () => {
  const ruleCentre = TRANSCRIPT_RULE_X + G.ruleWidth / 2;
  const markerCentre = G.inset + G.markerWidth / 2;
  expect(ruleCentre).toBe(markerCentre);
  expect(TRANSCRIPT_RULE_X).toBeGreaterThanOrEqual(G.inset);
  expect(TRANSCRIPT_RULE_X + G.ruleWidth).toBeLessThanOrEqual(G.inset + G.markerWidth);
});

test('the rule trims to the text box with matching insets top and bottom', () => {
  const trim = transcriptRuleTrim(AGENT_TYPE.meta.size, AGENT_TYPE.mono.lineHeight);
  expect(trim).toEqual({ top: 4, bottom: 4.5 });
  // Within a point of each other at every size the transcript sets text in.
  for (const { size, lineHeight } of Object.values(AGENT_TYPE)) {
    const { top, bottom } = transcriptRuleTrim(size, lineHeight);
    expect(top).toBeGreaterThan(0);
    expect(bottom).toBeGreaterThan(0);
    expect(Math.abs(top - bottom)).toBeLessThanOrEqual(1);
  }
});

test('the rhythm: rows are a full gap apart, a block sits closer to its own marker row', () => {
  expect(G.attachGap).toBeLessThan(G.rowGap);
  expect(G.rowGap % 2).toBe(0); // split evenly above and below each row
});

function source(file: string): string {
  return readFileSync(file, 'utf8');
}

function styleBlock(file: string, name: string): string {
  const match = new RegExp(`\\n  ${name}: \\{([^}]*)\\}`).exec(source(file));
  expect(match).not.toBeNull();
  return match?.[1] ?? '';
}

/** Names the block that drifted, which a bare `toContain` would not. */
function expectStyle(file: string, name: string, needle: string) {
  const block = styleBlock(file, name);
  expect(block.includes(needle) ? '' : `${file} ${name} lacks ${needle}`).toBe('');
}

const REASONING = 'src/components/agent-reasoning-block.tsx';
const MESSAGE = 'src/components/agent-message-block.tsx';
const TOOL = 'src/components/embedded-terminal-tool-block.tsx';
const TODO = 'src/components/agent-todo-block.tsx';
const PANE = 'src/components/pane-chat-blocks.tsx';
const MARKDOWN = 'src/lib/markdown-style.ts';

test('every transcript plate, card and pill pads by the grid inset', () => {
  for (const [file, name] of [
    [REASONING, 'headerPill'],
    [REASONING, 'body'],
    [MESSAGE, 'messageBlock'],
    [MESSAGE, 'noticeBlock'],
    [MESSAGE, 'toolGroupHeader'],
    [TOOL, 'container'],
    [TODO, 'header'],
    [TODO, 'body'],
    [PANE, 'toolHeader'],
    [PANE, 'activityChip'],
    [PANE, 'todoItem'],
  ] as const) {
    expectStyle(file, name, 'paddingHorizontal: TRANSCRIPT_GRID.inset');
  }
});

test('every marker sits in the marker column, followed by the marker gap', () => {
  expect(source(TOOL)).toContain('const ICON_COLUMN = TRANSCRIPT_GRID.markerWidth;');
  expect(source(TOOL)).toContain('const HEADER_GAP = TRANSCRIPT_GRID.markerGap;');
  for (const [file, name] of [
    [REASONING, 'marker'],
    [MESSAGE, 'marker'],
    [MESSAGE, 'noticeIcon'],
    [TODO, 'marker'],
    [TODO, 'itemIcon'],
    [PANE, 'marker'],
  ] as const) {
    expectStyle(file, name, 'width: TRANSCRIPT_GRID.markerWidth');
  }
  for (const [file, name] of [
    [REASONING, 'headerPill'],
    [MESSAGE, 'toolGroupHeader'],
    [MESSAGE, 'noticeRow'],
    [TODO, 'headerLeft'],
    [TODO, 'itemRow'],
    [PANE, 'toolHeader'],
    [PANE, 'activityChip'],
    [PANE, 'todoItem'],
  ] as const) {
    expectStyle(file, name, 'gap: TRANSCRIPT_GRID.markerGap');
  }
});

test('the thought: rule in the marker column, text on the text column, no stray margins', () => {
  expect(styleBlock(REASONING, 'rule')).toContain('left: TRANSCRIPT_RULE_X');
  expect(styleBlock(REASONING, 'rule')).toContain('width: TRANSCRIPT_GRID.ruleWidth');
  expect(styleBlock(REASONING, 'quoteText')).toContain('marginLeft: TRANSCRIPT_HANG');
  expect(styleBlock(REASONING, 'body')).toContain('marginTop: TRANSCRIPT_GRID.attachGap');
  expect(styleBlock(REASONING, 'body')).toContain('paddingVertical: TRANSCRIPT_GRID.plateInsetY');
  // The row's own margin is the only space around a thought.
  expect(styleBlock(REASONING, 'container')).not.toContain('margin');
  expect(styleBlock(REASONING, 'body')).not.toContain('marginBottom');
  expect(source(MESSAGE)).toContain('export const TRANSCRIPT_ROW_GAP = TRANSCRIPT_GRID.rowGap;');
});

test('a markdown quote draws the same rule and puts its text on the text column', () => {
  const md = source(MARKDOWN);
  expect(md).toContain('borderWidth: TRANSCRIPT_GRID.ruleWidth');
  expect(md).toContain('borderColor: withAlpha(colors.primary, TRANSCRIPT_GRID.ruleAlpha)');
  expect(md).toContain(
    'gapWidth: TRANSCRIPT_GRID.textOrigin - TRANSCRIPT_GRID.inset - TRANSCRIPT_GRID.ruleWidth'
  );
  expect(source(REASONING)).toContain(
    'backgroundColor: withAlpha(theme.colors.primary, TRANSCRIPT_GRID.ruleAlpha)'
  );
});

test('a diff inside a tool card: chevron in the marker column, name, hunk and numbers on the text column', () => {
  const DIFF = 'src/components/diff-rows.tsx';
  expectStyle(DIFF, 'fileMarker', 'width: TRANSCRIPT_GRID.markerWidth');
  expectStyle(DIFF, 'fileBodyOnGrid', 'gap: TRANSCRIPT_GRID.markerGap');
  expectStyle(DIFF, 'fileBodyOnGrid', 'paddingLeft: 0');
  expectStyle(DIFF, 'hunkTextOnGrid', 'paddingLeft: TRANSCRIPT_HANG');
  const diff = source(DIFF);
  expect(diff).toContain('const gutterInset = onGrid ? TRANSCRIPT_HANG : GUTTER_INSET;');
  expect(diff).toContain('inset: gutterInset,');
  expect(/useDiffMetrics\(\s*rows,\s*onGrid\s*\)/.test(diff)).toBe(true);
  // Both tool-card diffs (a patch, an edit) opt in; the Changes sheet does not.
  const card = source('src/components/agent-tool-card.tsx');
  expect(card.match(/<InlineDiffRows[^>]*\n\s*onGrid\n/g)?.length ?? 0).toBe(2);
  expect(diff.slice(diff.indexOf('export function DiffRowList('))).toContain(
    'useDiffMetrics(rows);'
  );
});
