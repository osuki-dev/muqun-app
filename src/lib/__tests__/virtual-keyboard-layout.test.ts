// The on-screen keyboard's geometry (card #670).
//
// This is a source test rather than a render test, and deliberately so. What
// broke the old layout was not a component that misbehaved -- every key drew
// exactly as told -- but an arithmetic claim nobody had written down: that a
// keyboard has one key width and offsets its rows, rather than one row width
// and stretched keys. `flex: 1` on every key is a perfectly good style and a
// wrong keyboard, and no snapshot of it looks broken until you put Gboard
// beside it.
//
// So the claim is stated here as the sum it is. Every row is ten key widths
// across; the middle row is centred with half-unit spacers; the bottom letter
// row is flanked by the standard one-and-a-half-unit caps. Anything that
// changes one weight without changing another fails, which is the only way this
// can come apart again.
/// <reference types="node" />
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'components', 'virtual-keyboard.tsx'),
  'utf8'
);

/** The `flex` weight of a named style, in key widths. */
function weight(style: string): number {
  const match = source.match(new RegExp(`\\b${style}:\\s*\\{[^}]*?\\bflex:\\s*([A-Z_0-9.]+)`, 's'));
  if (!match) throw new Error(`No flex weight found for style "${style}"`);
  // A weight may be written as the named constant it is -- `flex: SHIFT_UNITS`
  // -- which is the point of naming it, so the name resolves here too.
  return match[1] === 'SHIFT_UNITS' ? SHIFT_UNITS : Number(match[1]);
}

/** The character rows of a named layout table. */
function rows(table: string): string[][] {
  const match = source.match(new RegExp(`const ${table} = \\[(.*?)\\n\\];`, 's'));
  if (!match) throw new Error(`No layout table found for "${table}"`);
  return (
    match[1]
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('['))
      // Both quote styles: a row holding an apostrophe writes it "'", and a row
      // holding a backslash writes it '\\'.
      .map((line) => line.match(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g) ?? [])
  );
}

const ROW_UNITS = Number(source.match(/const ROW_UNITS = (\d+)/)?.[1]);
const SHIFT_UNITS = Number(source.match(/const SHIFT_UNITS = ([0-9.]+)/)?.[1]);
const MINIMUM_KEY_HEIGHT = Number(source.match(/const MINIMUM_KEY_HEIGHT = ([0-9.]+)/)?.[1]);
const VIRTUAL_KEYBOARD_MAX_WIDTH = Number(
  source.match(/const VIRTUAL_KEYBOARD_MAX_WIDTH = ([0-9.]+)/)?.[1]
);

function styleBody(style: string): string {
  const match = source.match(new RegExp(`\\b${style}:\\s*\\{(.*?)\\n  \\}`, 's'));
  if (!match) throw new Error(`No style found for "${style}"`);
  return match[1];
}

describe('the letters are one size', () => {
  test('a letter is the unit every other key is stated in', () => {
    expect(weight('unitKey')).toBe(1);
    expect(ROW_UNITS).toBe(10);
  });

  for (const table of ['LETTER_ROWS', 'SYMBOL_ROWS', 'SHIFTED_SYMBOL_ROWS']) {
    test(`${table} is ten, then a centred row, then seven`, () => {
      const layout = rows(table);
      expect(layout).toHaveLength(3);
      // The top row is exactly the unit row: ten keys, no spacers, nothing to
      // offset. Everything else is measured against it.
      expect(layout[0]).toHaveLength(ROW_UNITS);
      // The middle row is centred, so a half-unit stagger only comes out even
      // when the count and ROW_UNITS differ by an even number.
      expect((ROW_UNITS - layout[1].length) % 1).toBe(0);
      expect(layout[1].length).toBeLessThanOrEqual(ROW_UNITS);
      // The last row has to leave room for two 1.5u caps and no more, or the
      // letters under `qwerty` stop lining up with it.
      expect(layout[2].length + SHIFT_UNITS * 2).toBe(ROW_UNITS);
    });
  }

  test('the pages agree with each other row for row', () => {
    // A key that changes width when you tap 123 is the same defect in a
    // different place, so the three pages are held to one shape.
    const shapes = ['LETTER_ROWS', 'SYMBOL_ROWS', 'SHIFTED_SYMBOL_ROWS'].map((table) =>
      rows(table).map((row) => row.length)
    );
    expect(shapes[1]).toEqual(shapes[2]);
    expect(shapes[0][0]).toBe(shapes[1][0]);
    expect(shapes[0][2]).toBe(shapes[1][2]);
  });

  test('shift and backspace keep the standard cap', () => {
    expect(weight('shiftKey')).toBe(SHIFT_UNITS);
    expect(SHIFT_UNITS).toBe(1.5);
  });
});

describe('the bottom row is a row like the others', () => {
  test('switch, type, move and send add up to one row', () => {
    const arrows = 4;
    const total =
      weight('pageKey') + weight('spaceKey') + weight('arrowCluster') + weight('returnKey');
    expect(total).toBeCloseTo(ROW_UNITS, 5);
    // The cluster is four keys wide and they are all the same, so an arrow is
    // within a hair of a letter rather than a sliver between two big keys.
    expect(weight('arrowCluster') / arrows).toBeGreaterThan(0.9);
  });

  test('the space bar is still the widest key on it', () => {
    for (const style of ['pageKey', 'returnKey']) {
      expect(weight('spaceKey')).toBeGreaterThan(weight(style));
    }
  });

  test('the function row carries esc, tab and the way out -- and sums to one row', () => {
    // Revised on device (card #674): the hide toggle crowded the bottom row's
    // five controls, so it moved to the corner dismissal lives in. The arrows
    // stay down beside the space bar.
    const functionRow = source.match(/<View style={styles\.functionRow}>(.*?)<\/View>/s)?.[1] ?? '';
    expect(functionRow).toContain('esc');
    expect(functionRow).toContain('tab');
    expect(functionRow).toContain('KeyboardIcon');
    expect(functionRow).not.toContain('ARROWS');
    expect(weight('functionWide') * 2 + weight('closeKey')).toBeCloseTo(ROW_UNITS, 5);
  });

  test('the arrows read left, down, up, right', () => {
    // Apple's compact strip, and the order `NAVIGATION` in `terminal-keys`
    // already uses. Two different orders for the same four keys in one app is
    // worse than either order.
    const cluster = source.match(/const ARROWS[^=]*= \[(.*?)\n\];/s)?.[1] ?? '';
    expect((cluster.match(/key: '(\w+)'/g) ?? []).map((entry) => entry.slice(6, -1))).toEqual([
      'left',
      'down',
      'up',
      'right',
    ]);
  });
});

describe('the keyboard adapts without stretching its keys', () => {
  test('fills a phone but is capped and centred in a wide workspace', () => {
    const keyboard = styleBody('keyboard');

    expect(keyboard).toContain("width: '100%'");
    expect(keyboard).toContain('maxWidth: VIRTUAL_KEYBOARD_MAX_WIDTH');
    expect(keyboard).toContain("alignSelf: 'center'");
    expect(VIRTUAL_KEYBOARD_MAX_WIDTH).toBeGreaterThanOrEqual(ROW_UNITS * 44);
    expect(VIRTUAL_KEYBOARD_MAX_WIDTH).toBeLessThanOrEqual(640);
  });

  test('every key keeps a 44pt minimum touch target', () => {
    expect(MINIMUM_KEY_HEIGHT).toBeGreaterThanOrEqual(44);
    expect(styleBody('key')).toContain('height: MINIMUM_KEY_HEIGHT');
    expect(source.match(/\bfunctionKey:\s*\{[^}]*\bheight:/s)).toBeNull();
  });
});
