import { expect, test } from 'bun:test';
import { clampOpacity } from '../../components/opacity-slider.types';

test('slider drafts and accessibility increments cannot cross the readable floor', () => {
  expect(clampOpacity(0.1, 0.85)).toBe(0.85);
  expect(clampOpacity(0.9, 0.85)).toBe(0.9);
  expect(clampOpacity(2, 0.85)).toBe(1);
  expect(clampOpacity(Number.NaN, 0.85)).toBe(0.85);
  expect(clampOpacity(0, Number.NaN)).toBe(1);
  expect(clampOpacity(0.5, 1)).toBe(1);
});
