import { expect, test } from 'bun:test';

import { blendedTerminalFill } from '@/terminal/background';

test('a fully opaque terminal keeps its own colour untouched', () => {
  expect(blendedTerminalFill('#102030', '#FFFFFF', 1)).toBe('#102030');
  // A malformed or absent opacity means opaque, the same as everywhere else.
  expect(blendedTerminalFill('#102030', '#FFFFFF', Number.NaN)).toBe('#102030');
});

test('half opacity lands halfway between the two colours', () => {
  expect(blendedTerminalFill('#000000', '#FFFFFF', 0.5)).toBe('rgb(128, 128, 128)');
});

test('zero opacity is the colour behind, exactly', () => {
  expect(blendedTerminalFill('#123456', '#ABCDEF', 0)).toBe('rgb(171, 205, 239)');
});

test("the authored colour's own alpha composites first", () => {
  // #00000080 at 50% user opacity is 25% black over white, not 50%.
  expect(blendedTerminalFill('#00000080', '#FFFFFF', 0.5)).toBe('rgb(191, 191, 191)');
});

test('rgb() and rgba() inputs work as well as hex', () => {
  expect(blendedTerminalFill('rgb(0, 0, 0)', 'rgb(255, 255, 255)', 0.5)).toBe('rgb(128, 128, 128)');
  expect(blendedTerminalFill('rgba(0, 0, 0, 0.5)', '#FFFFFF', 1)).toBe('rgba(0, 0, 0, 0.5)');
});

test('a colour it cannot read is handed to the form it replaces, never guessed at', () => {
  // `withAlpha` leaves a colour it cannot parse alone, so an unreadable value
  // comes back untouched rather than blended into something invented. The
  // caller keeps the translucent canvas; the only cost is the fast path.
  expect(blendedTerminalFill('paleturquoise', '#FFFFFF', 0.5)).toBe('paleturquoise');
  expect(blendedTerminalFill('#112233', 'paleturquoise', 0.5)).toBe('rgba(17, 34, 51, 0.5)');
});

test('the blend is the same pixels the canvas would have composited', () => {
  // The property that makes the substitution legitimate: for a flat colour
  // behind, `front over back` is what alpha compositing produces.
  for (const alpha of [0.1, 0.25, 0.85, 0.97]) {
    const blended = blendedTerminalFill('#204080', '#F0F0F0', alpha);
    const [r, g, b] = /rgb\((\d+), (\d+), (\d+)\)/.exec(blended)!.slice(1).map(Number);
    for (const [index, front] of [0x20, 0x40, 0x80].entries()) {
      const expected = Math.round(front * alpha + 0xf0 * (1 - alpha));
      expect([r, g, b][index]).toBe(expected);
    }
  }
});
