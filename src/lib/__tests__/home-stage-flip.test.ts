import { describe, expect, test } from 'bun:test';
import { stageFlipDelay, stageFlipDirection, stageFlipVisibleSlots } from '../home-stage-flip';

describe('stageFlipDirection', () => {
  test('follows the shorter way round the wrapping cover-flow', () => {
    expect(stageFlipDirection(0, 1, 5)).toBe(1);
    expect(stageFlipDirection(1, 0, 5)).toBe(-1);
    expect(stageFlipDirection(4, 0, 5)).toBe(1);
    expect(stageFlipDirection(0, 4, 5)).toBe(-1);
    expect(stageFlipDirection(0, 2, 4)).toBe(1);
  });

  test('two computers follow index order; an unknown side counts as next', () => {
    expect(stageFlipDirection(0, 1, 2)).toBe(1);
    expect(stageFlipDirection(1, 0, 2)).toBe(-1);
    expect(stageFlipDirection(-1, 0, 3)).toBe(1);
  });
});

describe('stageFlipDelay', () => {
  test('staggers left to right on the beat', () => {
    expect([0, 1, 2].map((i) => stageFlipDelay(i, 3, 48, 440, 720))).toEqual([0, 48, 96]);
  });

  test('cards past the screen edge turn with the last visible one', () => {
    expect(stageFlipDelay(5, 3, 48, 440, 720)).toBe(96);
  });

  test('the whole stagger stays inside the budget', () => {
    const visible = 12;
    const last = stageFlipDelay(visible - 1, visible, 48, 440, 720);
    expect(last + 440).toBeLessThanOrEqual(720);
  });
});

describe('stageFlipVisibleSlots', () => {
  test('counts partly shown cards and never returns zero', () => {
    expect(stageFlipVisibleSlots(390, 176, 8, 14)).toBe(3);
    expect(stageFlipVisibleSlots(0, 176, 8, 14)).toBe(1);
  });
});
