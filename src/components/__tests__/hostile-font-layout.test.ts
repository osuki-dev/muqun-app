import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

/**
 * The layouts that have to survive a font the app has never seen.
 *
 * This began as the settings page's rows and grew to the seven other
 * surfaces that came apart the same way. What they share is not a component
 * but an assumption: each had a number in it that was the system face,
 * measured once and written down -- a width, a height, a line box -- or a
 * line cap with no width bound to act on.
 *
 * The rules, in the owner's words: what should wrap may wrap. A sentence, a
 * caption, a description and a settings row's value are free to take a second
 * line and grow the row. Ellipsis is for the things that must stay on one
 * line by nature -- a chip, a pill, a tab label, a header title, a list-row
 * title next to a trailing control, a key cap -- and those need a width bound
 * for the cap to mean anything at all.
 *
 * The settings rows, first:
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

/* ------------------------------------------------------------------ *
 * The seven other surfaces that failed the same way.
 * ------------------------------------------------------------------ */

function read(file: string): string {
  return readFileSync(file, 'utf8');
}

/** Comments explain a rule; they are not the code the rule is about. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');
}

/** One named entry out of a `StyleSheet.create` block, braces balanced. */
function style(source: string, name: string): string {
  const at = source.indexOf(`\n  ${name}: {`);
  expect(at).toBeGreaterThan(-1);
  let depth = 0;
  for (let index = source.indexOf('{', at); index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(at, index + 1);
    }
  }
  throw new Error(`unbalanced style ${name}`);
}

test('a session chip is bounded, so its one-line title can actually ellipsise', () => {
  const source = read('src/components/agent-composer.tsx');
  const chip = style(source, 'sessionChip');
  // A horizontal ScrollView offers its children unbounded width. Without a
  // cap the title is never handed a constraint, so `numberOfLines={1}` never
  // fires and the chip simply grows past the phone -- and because the strip
  // scrolls the active chip into view, the reader sees one session and no
  // sign of the rest.
  expect(chip).toContain('maxWidth:');
  // A fixed height around vertically centred text clips a taller face.
  expect(chip).toContain('minHeight:');
  // `minHeight` does not match: its `h` is preceded by `min`, not by space.
  expect(/\n\s+height:/u.test(chip)).toBe(false);
  expect(style(source, 'actionBtnWithLabel')).toContain('minHeight:');

  // The shrink path has to be unbroken from the chip down to the text: a
  // wrapper left at the default `flexShrink: 0` holds its content's full
  // width and the cap above stops meaning anything one level down.
  expect(source).toContain('style={styles.sessionChipTitleSlot}');
  for (const name of ['sessionChipTitleSlot', 'sessionChipTitle', 'sessionChipAgentBadge']) {
    expect(`${name}:${style(source, name)}`).toContain('flexShrink: 1');
  }
  // The badge is host-supplied and gives way before the title does.
  expect(source).toContain('weight="semibold"\n          numberOfLines={1}');
});

test('the approval tool tag is capped, so it cannot take the prompt', () => {
  const source = read('src/components/approval-banner.tsx');
  // The kit's `Tag` hugs but sets no `maxWidth`, no `flexShrink` and no
  // `numberOfLines`; a caller's `style` is applied last, so the width is ours
  // to bound even though the line count is not.
  expect(source).toContain('<Tag variant="technical" style={styles.toolTag}>');
  const tag = style(source, 'toolTag');
  expect(tag).toContain('maxWidth:');
  expect(tag).toContain('flexShrink: 1');
  // The prompt is the sentence the reader has to read to answer, and it must
  // keep its own column.
  expect(source).toContain('{ flex: 1, minWidth: 0, gap: 2 }');
});

test('no reader-facing line box is a number measured off the system face', () => {
  // Each of these carried the kit's own ratio, rounded down, frozen into a
  // style. An explicit `lineHeight` clamps the line box on Android whether or
  // not font padding is off, so a taller face has its ascenders cut.
  const frozen: [string, string][] = [
    ['src/components/attachment-strip.tsx', 'fileName'],
    ['src/app/index.tsx', 'emptyDetail'],
    ['src/components/sheet-scene.tsx', 'fieldNote'],
  ];
  for (const [file, name] of frozen) {
    const source = read(file);
    // Stripped of comments first: several of these carry a note explaining
    // why the line box is gone, and that note names it.
    const block = code(
      name === 'emptyDetail'
        ? (/emptyDetail: \{[^}]*\}/u.exec(source)?.[0] ?? '')
        : style(source, name)
    );
    expect(`${file}:${name}:${block.includes('lineHeight')}`).toBe(`${file}:${name}:false`);
  }
});

test('a pill around centred text has vertical tolerance', () => {
  const indicator = style(read('src/components/transient-pill.tsx'), 'indicator');
  // 26 was a 12pt caption's 16.8 line box plus about 4.6 each side: the system
  // face measured once and frozen into the pill, which then shaves the tops of
  // the digits off a taller one.
  expect(indicator).toContain('minHeight:');
  expect(indicator).toContain('paddingVertical:');
  expect(/\n\s+height:/u.test(indicator)).toBe(false);
});

test('a sheet row\u2019s host-supplied status shrinks instead of the title', () => {
  const source = read('src/components/sheet-scene.tsx');
  // `meta` stays rigid, and should: a time, a token count, a diff stat --
  // short, bounded, written by this app.
  expect(style(source, 'rowMeta')).toContain('flexShrink: 0');
  // `disabledCaption` is whatever the gateway says, so it gets the opposite
  // rule. Held rigid it took the row and `rowCopy` -- the only other thing
  // that can shrink -- gave up the row's title.
  const disabled = style(source, 'rowDisabledMeta');
  expect(disabled).toContain('flexShrink: 1');
  expect(disabled).toContain('minWidth: 0');
  expect(source).toContain('style={styles.rowDisabledMeta}');
  expect(source).toContain('rowCopy: { flexShrink: 1, minWidth: 0');
});
