import { expect, test } from 'bun:test';
import { themeIconRotation } from '../icon-direction';
import { parseThemeManifest } from '../schema';
import { createThemeStarter } from '../starter';

test('different source artwork directions resolve to the same control direction', () => {
  expect(themeIconRotation('up-right', 'down')).toBe(135);
  expect(themeIconRotation('right', 'down')).toBe(90);
  expect(themeIconRotation('left', 'down')).toBe(270);
  expect(themeIconRotation('down', 'down')).toBe(0);
  expect(themeIconRotation('right', 'up-right')).toBe(315);
});

test('old artwork is not guessed or rotated without a direction declaration', () => {
  expect(themeIconRotation(undefined, 'down')).toBeNull();
  expect(themeIconRotation(undefined, undefined)).toBe(0);
});

test('direction metadata round-trips and rejects misspelled directions', () => {
  const base = createThemeStarter();
  expect(
    parseThemeManifest(
      JSON.stringify({
        ...base,
        iconDirections: { 'home.arrow': 'up-right' },
      })
    ).iconDirections
  ).toEqual({ 'home.arrow': 'up-right' });
  expect(() =>
    parseThemeManifest(
      JSON.stringify({
        ...base,
        iconDirections: { 'home.arrow': 'diagonal' },
      })
    )
  ).toThrow();
});
