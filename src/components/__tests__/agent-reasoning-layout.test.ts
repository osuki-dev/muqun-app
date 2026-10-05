import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

/**
 * The expanded thought spans the message; the collapsed pill hugs its label.
 *
 * Read from the source rather than rendered: `bun test` cannot load
 * react-native. On iOS the markdown inside the plate sits under `flex: 1` and
 * brings no intrinsic width, so any ancestor between the message and the
 * plate that shrink-wraps collapses the plate to the pill's width and the
 * reasoning wraps one word per line. Android's native measure hides that.
 */
function styleBlock(file: string, name: string): string {
  const source = readFileSync(file, 'utf8');
  const match = new RegExp(`\\n  ${name}: \\{([^}]*)\\}`).exec(source);
  expect(match).not.toBeNull();
  return match?.[1] ?? '';
}

const MESSAGE = 'src/components/agent-message-block.tsx';
const REASONING = 'src/components/agent-reasoning-block.tsx';

test('the thought row and the block both stretch to the message width', () => {
  expect(styleBlock(MESSAGE, 'thoughtRow')).toContain("alignSelf: 'stretch'");
  expect(styleBlock(MESSAGE, 'thoughtRow')).not.toContain("'flex-start'");
  expect(styleBlock(REASONING, 'container')).toContain("alignSelf: 'stretch'");
});

test('the pill keeps hugging its label', () => {
  expect(styleBlock(REASONING, 'headerPill')).toContain("alignSelf: 'flex-start'");
});

test('the rule still runs the full height of the text', () => {
  // Pinned to the plate's top and bottom, not sized by a row: it is the text's
  // height however many lines stream in.
  const rule = styleBlock(REASONING, 'rule');
  expect(rule).toContain("position: 'absolute'");
  expect(rule).toContain('top: TRANSCRIPT_GRID.plateInsetY + RULE_TRIM.top');
  expect(rule).toContain('bottom: TRANSCRIPT_GRID.plateInsetY + RULE_TRIM.bottom');
  expect(styleBlock(REASONING, 'quoteText')).toContain("alignSelf: 'stretch'");
  // A `flex: 1` child of an auto-height column measures to nothing.
  expect(styleBlock(REASONING, 'quoteText')).not.toContain('flex: 1');
});
