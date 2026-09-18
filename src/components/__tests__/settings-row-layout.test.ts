import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

/**
 * The settings page's rows, held to the shape a reader's own font cannot break.
 *
 * A source-level contract, in the style of the other contract tests in this
 * tree, because what is being pinned is a *layout rule* rather than a rendered
 * pixel: the rule is three props and two style keys, and a render test of a
 * flex row proves nothing about a face nobody has installed on the test
 * machine.
 *
 * What it is protecting. The owner set the interface font to a wide italic
 * face and the Appearance rows came apart: "Lanterns in the Overworld" took
 * the whole row, the label column beside it was driven to zero, and "Terminal
 * colours follow the theme" came down the left edge one word per line. The
 * cause is arithmetic rather than taste -- `flex: 1` is a flex basis of zero,
 * Yoga hands shrink out in proportion to basis, so a column with basis zero
 * shrinks by nothing and whatever sits beside it takes the row. Every
 * assertion below is one half of the answer: a floor on the column that must
 * survive, and a value that spends what is left and then ellipsises.
 */
const CHROME = 'src/components/settings-chrome.tsx';

function chrome(): string {
  return readFileSync(CHROME, 'utf8');
}

/** The body of one exported component, from its signature to the next one. */
function component(source: string, name: string): string {
  const start = source.indexOf(`export function ${name}(`);
  expect(start).toBeGreaterThan(-1);
  const next = source.indexOf('\nexport function ', start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

test('the choice row gives its label column a floor of more than half the row', () => {
  const source = chrome();
  const floor = /const CHOICE_LABEL_FLOOR = '(\d+)%';/u.exec(source);
  expect(floor).not.toBeNull();
  // More than half: the label is the question and the value is the answer, and
  // the answer is one tap from being shown in full.
  expect(Number(floor?.[1])).toBeGreaterThanOrEqual(50);
  // A percentage, and a minimum rather than a basis. A basis would be weighted
  // into the shrink distribution and collapse exactly as `flex: 1` does.
  expect(source).toContain('rowCopyFloor: { minWidth: CHOICE_LABEL_FLOOR }');
  expect(component(source, 'SettingsChoiceRow')).toContain(
    'style={[styles.rowCopy, styles.rowCopyFloor]}'
  );
});

test('the choice row value wraps to two right-aligned lines, then ellipsises', () => {
  const body = component(chrome(), 'SettingsChoiceRow');
  // Two, not one. What should wrap may wrap: the value is an answer the reader
  // came to the row to read, and cutting a theme name to keep the row 60
  // points tall is the app preferring its own rhythm to their content. One
  // line is the rule for a chip or a tab label, which must stay on one line by
  // nature; a row is free to grow.
  expect(body).toContain('numberOfLines={2}');
  expect(body).toContain('ellipsizeMode="tail"');
  expect(body).toContain('style={styles.choiceValue}');

  const style = /choiceValue: \{([^}]*)\}/u.exec(chrome())?.[1] ?? '';
  expect(style).toContain('flexShrink: 1');
  // Without `minWidth: 0` a text node refuses to shrink below its longest
  // unbreakable run, which on a single-line value is the whole string.
  expect(style).toContain('minWidth: 0');
  expect(style).toContain("textAlign: 'right'");
});

test('every settings row caption stops at three lines', () => {
  const source = chrome();
  // Each of the four rows that carries a caption renders it through
  // `styles.rowDetail`; every one of those must be capped, or a hostile face
  // turns one sentence into a paragraph and the row into a page. Three lines
  // rather than two, because a caption is a sentence and a sentence may wrap;
  // the cap is there to stop a page, not to stop a second line.
  const captions = source.match(/style=\{styles\.rowDetail\}/gu) ?? [];
  expect(captions.length).toBeGreaterThanOrEqual(4);
  for (const row of [
    'SettingsToggleRow',
    'SettingsNavRow',
    'SettingsChoiceRow',
    'SettingsInfoRow',
  ]) {
    const body = component(source, row);
    if (!body.includes('styles.rowDetail')) continue;
    expect(body).toContain('numberOfLines={3}');
  }
});

test('row text takes its line height from the type scale, not from a measured number', () => {
  const source = chrome();
  // 20 and 17 were 14x1.5 and 12x1.4 measured off the system face and then
  // frozen. A face with taller ascenders is clipped by them, and
  // `includeFontPadding: false` removes the padding Android would have used to
  // absorb the difference.
  const label = /rowLabel: \{([^}]*)\}/u.exec(source)?.[1] ?? '';
  const detail = /rowDetail: \{([^}]*)\}/u.exec(source)?.[1] ?? '';
  expect(label).not.toContain('lineHeight');
  expect(detail).not.toContain('lineHeight');
  expect(label).toContain('includeFontPadding: false');
  expect(detail).toContain('includeFontPadding: false');
});

test('a hugging section label keeps trailing room for a leaning glyph', () => {
  const source = chrome();
  // Shrink-wrapped text is exactly as wide as the sum of its advances, and an
  // italic face draws its last letter past that sum: APPEARANCE read APPEARANC.
  // Scaled off the label's own size so it grows with the type rather than
  // being a second measured number of the kind the test above forbids.
  expect(/const HUG_TRAILING_SLACK = 0\.\d+;/u.test(source)).toBe(true);
  const body = component(source, 'SectionLabel');
  expect(body).toContain('theme.typeStyles.label.fontSize * HUG_TRAILING_SLACK');
  expect(body).toContain('paddingRight: platePadding + slack');
  // Trailing only. The glyphs still begin on the same x as the rows the label
  // names, which is the alignment the whole file exists to hold.
  expect(body).not.toContain('paddingLeft: platePadding + slack');
});
