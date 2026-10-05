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
  expect(styleBlock(REASONING, 'quote')).toContain("alignItems: 'stretch'");
  expect(styleBlock(REASONING, 'rule')).toContain("alignSelf: 'stretch'");
  expect(styleBlock(REASONING, 'quoteText')).toContain('flex: 1');
});
