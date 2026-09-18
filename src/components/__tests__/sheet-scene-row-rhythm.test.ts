import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

/**
 * What one row of the sheet system is worth, in dp.
 *
 * Every sheet in the app draws its list through `SheetSceneRow`, so the row's
 * padding and floor are the app's list rhythm and not one screen's taste. They
 * drifted once already: a 52 floor and `snug` (14) above and below are both
 * numbers sized for a *one-line* row, and applied to the two-line rows the
 * workspace and model sheets are made of they produced 68 dp of pitch -- which
 * the owner read, correctly, as a stack of cards with air between them.
 *
 * The arithmetic below is the whole argument, so it is checked rather than
 * described: the type scale comes out of the kit, the padding and floor come
 * out of `sheet-scene.tsx`, and the heights they produce are asserted. A change
 * to either end fails here with the number it would have made.
 */

const SCENE = readFileSync('src/components/sheet-scene.tsx', 'utf8');

/**
 * The kit's own scale, read rather than copied.
 *
 * `@osuki-dev/ui` is a React Native package and importing it into a node test
 * drags the whole runtime in, so the two rungs a row is built from are read out
 * of its compiled type scale. If the kit retunes `bodySm` or `caption`, the row
 * heights below change with it and this test says so -- which is the point: the
 * row hugs its text, so its height is a fact about the text.
 */
function kitLineHeight(rung: 'bodySm' | 'caption'): number {
  const source = readFileSync('node_modules/@osuki-dev/ui/lib/theme/typography.js', 'utf8');
  const match = new RegExp(
    `${rung}:\\s*\\{\\s*size:\\s*(\\d+(?:\\.\\d+)?),\\s*lineHeight:\\s*(\\d+(?:\\.\\d+)?)`
  ).exec(source);
  if (!match) throw new Error(`no ${rung} in the kit's type scale`);
  return Number(match[1]) * Number(match[2]);
}

/** The one number declared in the scene file, pulled back out of it. */
function sceneNumber(name: string): number {
  const match = new RegExp(`const ${name} = (\\d+);`).exec(SCENE);
  if (!match) throw new Error(`${name} is no longer a literal in sheet-scene.tsx`);
  return Number(match[1]);
}

/**
 * A rung of the sheet ladder.
 *
 * Read out of the source rather than imported: `sheet-scene.tsx` is a component
 * module and importing it pulls React Native, Reanimated and the icon set into
 * a node test. Every other assertion in this file reads the same source, so
 * reading this one keeps the whole test looking at one thing.
 */
function ladder(rung: 'tight' | 'gap' | 'snug' | 'gutter' | 'section'): number {
  const table = /export const SHEET_LADDER = \{([\s\S]*?)\} as const;/.exec(SCENE);
  if (!table) throw new Error('SHEET_LADDER is no longer an object literal');
  const match = new RegExp(`\\b${rung}: (\\d+),`).exec(table[1]!);
  if (!match) throw new Error(`no ${rung} rung on the sheet ladder`);
  return Number(match[1]);
}

test('a row is padded by the ladder, not by the row gap', () => {
  // `snug` is the gap *across* a row -- leading glyph to copy to meta -- and
  // using it down the row as well is what made a two-line row 28 dp of padding.
  expect(SCENE).toContain('const ROW_PADDING_VERTICAL = SHEET_LADDER.gap;');
  expect(SCENE).toContain('paddingVertical: ROW_PADDING_VERTICAL,');
  expect(SCENE).not.toContain('paddingVertical: SHEET_LADDER.snug,');
  expect(ladder('gap')).toBe(8);
});

test('the title and its caption stay one thought apart', () => {
  // Below the ladder's smallest rung on purpose; see the note on ROW_COPY_GAP.
  expect(sceneNumber('ROW_COPY_GAP')).toBe(2);
  expect(SCENE).toContain('gap: ROW_COPY_GAP },');
});

test('a one-line row is a touch target and a two-line row hugs its text', () => {
  const floor = sceneNumber('ROW_MIN_HEIGHT');
  const padding = ladder('gap') * 2;
  const title = kitLineHeight('bodySm');
  const caption = kitLineHeight('caption');

  const oneLine = Math.max(floor, title + padding);
  const twoLine = Math.max(floor, title + sceneNumber('ROW_COPY_GAP') + caption + padding);

  // The floor is what a one-line row is: 21 dp of text cannot be tapped, so the
  // row is the platform's 44 and the padding is not asked to make up the
  // difference.
  expect(floor).toBe(44);
  expect(oneLine).toBe(44);
  expect(oneLine).toBeGreaterThanOrEqual(44);
  expect(oneLine).toBeLessThanOrEqual(48);

  // And a two-line row is its text plus 8 above and 8 below -- 56, down from
  // the 68 the owner photographed. The ceiling is the real assertion: anything
  // at 60 or more is the card pitch coming back.
  expect(Math.round(twoLine)).toBe(56);
  expect(twoLine).toBeLessThan(60);
  expect(twoLine - (title + sceneNumber('ROW_COPY_GAP') + caption)).toBe(padding);
});

test('group headings keep their own two numbers, measured from the row edge', () => {
  // 24 above, 8 below. Unchanged by the tighter row on purpose: the margins are
  // measured from the row's edge, so a row that gave back 6 dp at each end
  // leaves 32 above a heading and 16 below it -- still nearer the group it
  // names than the one it follows.
  expect(SCENE).toContain('marginTop: SHEET_LADDER.section,');
  expect(SCENE).toContain('marginBottom: SHEET_LADDER.gap,');
  expect(SCENE).toContain('groupHeadingFirst: { marginTop: SHEET_LADDER.gap },');
  expect(ladder('section')).toBe(24);
});
