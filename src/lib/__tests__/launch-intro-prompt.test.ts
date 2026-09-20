import { describe, expect, test } from 'bun:test';

import {
  cursorOpacity,
  launchPromptLine,
  PROMPT_NAME_LIMIT,
  PROMPT_SIGIL,
  scrimWidth,
  typedCount,
} from '../launch-intro-prompt';

describe('launchPromptLine', () => {
  test('the line is the sigil and the world being loaded', () => {
    expect(launchPromptLine('One Piece — Grand Voyage')).toBe(
      `${PROMPT_SIGIL} One Piece — Grand Voyage`
    );
  });

  test('a name out of an author JSON is collapsed and trimmed', () => {
    expect(launchPromptLine('  Ink   over\nJiangnan ')).toBe(`${PROMPT_SIGIL} Ink over Jiangnan`);
  });

  test('a name too long for one line on a phone is cut, and says it was', () => {
    const line = launchPromptLine('A'.repeat(PROMPT_NAME_LIMIT + 20));
    expect(line.length).toBe(PROMPT_SIGIL.length + 1 + PROMPT_NAME_LIMIT);
    expect(line.endsWith('…')).toBe(true);
  });

  test('a name of exactly the limit is left alone', () => {
    const name = 'B'.repeat(PROMPT_NAME_LIMIT);
    expect(launchPromptLine(name)).toBe(`${PROMPT_SIGIL} ${name}`);
  });

  test('no name at all is still a prompt waiting', () => {
    // Which is what a built-in pack looks like before the settings store has
    // hydrated: the launch draws a prompt rather than nothing.
    for (const empty of [null, undefined, '', '   ']) {
      expect(launchPromptLine(empty)).toBe(`${PROMPT_SIGIL} `);
    }
  });
});

describe('typedCount', () => {
  test('the cursor steps one whole cell at a time', () => {
    expect(typedCount(0, 10)).toBe(0);
    expect(typedCount(0.09, 10)).toBe(0);
    expect(typedCount(0.1, 10)).toBe(1);
    expect(typedCount(0.55, 10)).toBe(5);
    expect(typedCount(1, 10)).toBe(10);
  });

  test('the reveal is whole characters, never a half-drawn glyph', () => {
    // The clip is moved to `typedCount * characterWidth`, so anything other
    // than an integer here would cut a letter down the middle.
    for (const progress of [0.03, 0.31, 0.77, 0.99]) {
      expect(Number.isInteger(typedCount(progress, 27))).toBe(true);
    }
  });

  test('it never runs off either end of the line', () => {
    expect(typedCount(-3, 10)).toBe(0);
    expect(typedCount(4, 10)).toBe(10);
    expect(typedCount(0.5, 0)).toBe(0);
    expect(typedCount(Number.NaN, 10)).toBe(10);
  });
});

describe('cursorOpacity', () => {
  test('it blinks once: on, off, on', () => {
    expect(cursorOpacity(0)).toBe(1);
    expect(cursorOpacity(0.29)).toBe(1);
    expect(cursorOpacity(0.5)).toBe(0);
    expect(cursorOpacity(0.71)).toBe(0);
    expect(cursorOpacity(0.8)).toBe(1);
    expect(cursorOpacity(1)).toBe(1);
  });

  test('a cursor is a block, so it steps rather than dissolves', () => {
    const samples = Array.from({ length: 21 }, (_, index) => cursorOpacity(index / 20));
    expect(new Set(samples)).toEqual(new Set([0, 1]));
  });
});

describe('scrimWidth', () => {
  test('the plate is as wide as what has been typed, and grows with it', () => {
    expect(scrimWidth(0, 9, 10, 9)).toBe(20);
    expect(scrimWidth(5, 9, 10, 9)).toBe(65);
    expect(scrimWidth(10, 9, 10, 9)).toBe(110);
  });

  test('an unmeasured line falls back rather than collapsing', () => {
    expect(scrimWidth(5, 0, 10, 42)).toBe(42);
    expect(scrimWidth(5, Number.NaN, 10, 42)).toBe(42);
  });
});
