import { expect, test } from 'bun:test';

import { slashArgumentRequired } from '@/lib/slash-argument';

test('no hint at all runs straight away', () => {
  expect(slashArgumentRequired(undefined)).toBe(false);
  expect(slashArgumentRequired(null)).toBe(false);
  expect(slashArgumentRequired('')).toBe(false);
});

test('an angle-bracketed argument must be typed first', () => {
  expect(slashArgumentRequired('<path>')).toBe(true);
  expect(slashArgumentRequired('<message>')).toBe(true);
});

test('a square-bracketed argument is optional, so the command runs as it stands', () => {
  // These are the ones the catalogue is mostly made of, and every one of them
  // used to be diverted to the composer.
  for (const hint of ['[report]', '[name]', '[instructions]', '[key=value]', '[all]', '[filename]'])
    expect(slashArgumentRequired(hint)).toBe(false);
});

test('a required argument beside an optional one is still required', () => {
  expect(slashArgumentRequired('<name> [note]')).toBe(true);
  expect(slashArgumentRequired('[note] <name>')).toBe(true);
});

test('optional text that merely contains angle characters is not a requirement', () => {
  expect(slashArgumentRequired('[a > b]')).toBe(false);
  expect(slashArgumentRequired('[x <= y]')).toBe(false);
});
