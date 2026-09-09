import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { clampOpacity } from '../../components/opacity-slider.types';

test('slider drafts and accessibility increments cannot cross the readable floor', () => {
  expect(clampOpacity(0.1, 0.85)).toBe(0.85);
  expect(clampOpacity(0.9, 0.85)).toBe(0.9);
  expect(clampOpacity(2, 0.85)).toBe(1);
  expect(clampOpacity(Number.NaN, 0.85)).toBe(0.85);
  expect(clampOpacity(0, Number.NaN)).toBe(1);
  expect(clampOpacity(0.5, 1)).toBe(1);
});

test('Android slider keeps native gestures with restrained slots and a 48-point target', () => {
  const source = readFileSync(
    new URL('../../components/opacity-slider.android.tsx', import.meta.url),
    'utf8'
  );
  expect(source).toContain('steps={0}');
  expect(source).toContain('<Slider.Thumb>');
  expect(source).toContain('size(20, 20)');
  expect(source).toContain('height(4)');
  expect(source).toContain('height: 48');
  expect(source).toContain('onValueChangeFinished');
});
