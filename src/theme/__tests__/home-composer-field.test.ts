import { expect, test } from 'bun:test';
import { homeComposerFieldFill } from '../home-composer-field';

test('Home default field is opaque with the previous quiet tint in light and dark themes', () => {
  expect(homeComposerFieldFill('#ffffff', '#000000', 1)).toBe('#f0f0f0');
  expect(homeComposerFieldFill('#121212', '#ffffff', 1)).toBe('#202020');
});

test('Home field applies the exact interface opacity once, including fully transparent', () => {
  expect(homeComposerFieldFill('#ffffff', '#000000', 0.9)).toBe('rgba(240, 240, 240, 0.9)');
  expect(homeComposerFieldFill('#ffffff', '#000000', 0.4)).toBe('rgba(240, 240, 240, 0.4)');
  expect(homeComposerFieldFill('#ffffff', '#000000', 0)).toBe('rgba(240, 240, 240, 0)');
  expect(homeComposerFieldFill('#ffffff', '#000000', NaN)).toBe('#f0f0f0');
});
