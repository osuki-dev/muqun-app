import { expect, test } from 'bun:test';
import { surfaceBackgroundFill, surfaceBackgroundOpacity } from '../surface-background';

test('surface opacity preserves old appearances and rejects malformed preferences', () => {
  for (const value of [undefined, NaN, Infinity, -0.1, 1.1])
    expect(surfaceBackgroundOpacity(value)).toBe(1);
  for (const value of [0, 0.5, 1]) expect(surfaceBackgroundOpacity(value)).toBe(value);
  expect(surfaceBackgroundFill('#123456', 1)).toBe('#123456');
  expect(surfaceBackgroundFill('#123456', 0)).toBe('rgba(18, 52, 86, 0)');
  expect(surfaceBackgroundFill('#123456', 0.5)).toBe('rgba(18, 52, 86, 0.5)');
});

test('rgba and hex-alpha backgrounds combine authored alpha once without touching channels', () => {
  expect(surfaceBackgroundFill('rgba(18, 52, 86, 0.4)', 0.5)).toBe('rgba(18, 52, 86, 0.2)');
  expect(surfaceBackgroundFill('rgb(18,52,86)', 0.5)).toBe('rgba(18, 52, 86, 0.5)');
  expect(surfaceBackgroundFill('#12345680', 0.5)).toBe(`rgba(18, 52, 86, ${(128 / 255) * 0.5})`);
  for (const color of ['transparent', 'red', 'rgba(999,0,0,1)', 'rgba(0,0,0,5)', 'bogus'])
    expect(surfaceBackgroundFill(color, 0.5)).toBe(color);
});
