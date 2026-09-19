import { expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Everything the reader reads is set in the face the reader chose.
 *
 * Three ways a surface escapes that, and this file closes all three:
 *
 *  1. React Native's own `Text`, which has no idea the theme exists.
 *  2. A `fontFamily` in a caller's style, which the kit applies *after* its
 *     own resolved one (`text.tsx:243`) and which therefore always wins.
 *  3. A `TextInput`, which the kit has no component for and whose typed text
 *     *and* placeholder both take their family off the input's own style.
 *
 * The exception lists are the whole design of the test. A monospace payload --
 * a terminal line, a diff, a path, a command -- is genuinely not the interface
 * face, and the rule for it is `theme/interface-font-registry.ts`'s companion:
 * a literal follows the mono slot, a sentence follows the interface slot.
 * Every entry below names a file that is one of those, so adding a surface to
 * the list is a decision somebody has to write down.
 */

const ROOTS = ['src/components', 'src/app'];

function walk(directory: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      if (entry === '__tests__') continue;
      out.push(...walk(path));
      continue;
    }
    if (path.endsWith('.tsx')) out.push(path);
  }
  return out;
}

const FILES = ROOTS.flatMap(walk).sort();

/** Comments say what a rule is for; they are not the code the rule is about. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');
}

/**
 * The surfaces that draw a monospace payload and therefore do not take the
 * interface face.
 *
 * Every one of these renders something the reader is meant to copy character
 * for character -- terminal output, a diff, a shell command, a file path --
 * where the alignment is part of what it says.
 */
const MONO_SURFACES = new Set([
  'src/components/skia-terminal.tsx',
  'src/components/skia-terminal.web.tsx',
  'src/components/terminal-transcript.tsx',
  // The launch intro types a shell prompt at the reader. It is a terminal
  // being drawn rather than a sentence being said, it already takes the mono
  // slot through `fonts.mono`, and a proportional face would give away that
  // the prompt is a picture of one.
  'src/components/launch-intro-scene.tsx',
]);

test('no reader-facing copy is drawn with React Native’s Text', () => {
  const offenders = FILES.filter((file) => {
    if (MONO_SURFACES.has(file)) return false;
    const source = code(readFileSync(file, 'utf8'));
    // The import, not the word: `TextInput`, `TextStyle` and `TextProps` are
    // all fine and all contain it.
    const native = /import\s*\{[^}]*\}\s*from\s*'react-native'/gu;
    for (const match of source.matchAll(native)) {
      const names = match[0]
        .slice(match[0].indexOf('{') + 1, match[0].lastIndexOf('}'))
        .split(',')
        .map((name) =>
          name
            .trim()
            .split(/\s+as\s+/u)[0]
            ?.trim()
        );
      if (names.includes('Text')) return true;
    }
    return false;
  });
  expect(offenders).toEqual([]);
});

/**
 * The one file allowed to reach the design system's `Text` directly, because
 * it is the wrapper every other file goes through.
 */
const APP_TEXT = 'src/components/text.tsx';

test('no copy is drawn with the kit’s Text instead of the app’s', () => {
  /*
   * `components/text.tsx` is the kit's `Text` plus the trailing slack an
   * oblique face needs on Android, where a glyph that leans past its own
   * advance is shaved by `TextView`'s clip. Importing the kit's `Text`
   * directly is not a smaller version of that -- it is the bug, on whichever
   * label the import was for. There is one behaviour and one door to it.
   */
  const offenders = FILES.filter((file) => {
    if (file === APP_TEXT) return false;
    const source = code(readFileSync(file, 'utf8'));
    const kit = /import\s*\{([^}]*)\}\s*from\s*'@osuki-dev\/ui'/gu;
    for (const match of source.matchAll(kit)) {
      const names = (match[1] ?? '').split(',').map((name) => name.trim());
      if (names.includes('Text')) return true;
    }
    return false;
  });
  expect(offenders).toEqual([]);
});

test('the settings segmented control draws its labels with the kit', () => {
  const source = readFileSync('src/components/settings-segmented.tsx', 'utf8');
  // The control where the reader picks a font must not be the control that
  // ignores it. It used to copy the kit's label size and tracking by hand out
  // of `theme.typeStyles.label` -- which carries no family, because a type
  // style has none to carry -- and so stayed on the system face for good.
  expect(source).toContain("from '@/components/text'");
  expect(source).toContain("import { Tabs, useThemeTokens } from '@osuki-dev/ui';");
  expect(code(source)).not.toContain('NativeText');
  expect(source).toContain('variant="label"');
  // `transform` is how the kit says no to the label role's uppercasing; a
  // hand-rolled `Text` was the old way of saying it and cost the family.
  expect(source).toContain('transform="none"');
  // Nothing in this file may name a family or a weight of its own: the
  // registry decides both, because only the registry knows what one file can
  // serve. See `theme/interface-font-registry.ts`.
  const styles = code(source).slice(code(source).indexOf('StyleSheet.create('));
  expect(styles).not.toContain('fontFamily');
  expect(styles).not.toContain('fontWeight');
});

/**
 * The files allowed to name a font family literally, and what each one is.
 *
 * Every other family in the app comes out of the reader's slots. These four
 * name a string because there is no slot that could answer:
 */
const LITERAL_FAMILY_ALLOWED: Record<string, string> = {
  // The web terminal's fallback. There is no React Native font registry on
  // web and no reader slot reaches this file; CSS's own generic family is the
  // only name available.
  'src/components/skia-terminal.web.tsx': "the web fallback terminal's CSS generic family",
  // Key caps that are pictures of keys rather than characters being typed --
  // the arrow cluster and Return. On Android a Typeface built from one
  // reader-supplied file has no fallback chain, so U+2190-2193 and U+21B5
  // would draw as tofu. A key in the wrong font is still a key; a boxed arrow
  // is not.
  'src/components/virtual-keyboard.tsx': 'arrow and Return key caps, for glyph coverage',
};

test('no style outside a mono surface pins a font family', () => {
  const offenders: string[] = [];
  for (const file of FILES) {
    if (MONO_SURFACES.has(file)) continue;
    const source = code(readFileSync(file, 'utf8'));
    for (const match of source.matchAll(/fontFamily:\s*([^,\n]+)/gu)) {
      const value = (match[1] ?? '').trim();
      // A family read back out of the app's own font plumbing is the point of
      // the plumbing, not an escape from it.
      if (
        /useMonoFontFamily|useInterfaceFontFamily|resolveFontStyle|SYSTEM_MONO_FAMILY/u.test(value)
      ) {
        continue;
      }
      if (/^mono\b|^fonts\.|slotFontFamily|FontFamily\b|^chromeFontFamily/u.test(value)) continue;
      // A type annotation in an interface or a props type is not a style.
      if (value.includes('string')) continue;
      if (LITERAL_FAMILY_ALLOWED[file]) continue;
      offenders.push(`${file}: fontFamily: ${value}`);
    }
  }
  expect(offenders).toEqual([]);
});

test('nothing asks the reader\u2019s font for a weight Android cannot serve', () => {
  /*
   * 700 is where the reader's font disappears on Android.
   *
   * `expo-font` registers a loaded face under `Typeface.NORMAL` and nothing
   * else (FontLoaderModule.kt:59). `ReactFontManager.getTypeface` rounds any
   * weight of 700 or more to `Typeface.BOLD`, finds no entry under it, looks
   * for a `<family>_bold.ttf` among the app's assets, and ends on
   * `Typeface.create(familyName, style)` -- a *system* lookup that has never
   * heard of the family and answers with the platform's own bold face.
   *
   * The registry already caps the kit's `weight` prop at 600
   * (theme/interface-font-registry.ts). This closes the other door: the kit
   * applies a caller's `style` after its own resolved font style
   * (text.tsx:239-243), so a 700 in a StyleSheet overrides the cap and
   * re-opens the bug. Use `weight="semibold"` on the element instead.
   *
   * A terminal payload is exempt for the same reason it is exempt above: it
   * is drawn in the mono slot, or by Skia, which does not go through
   * `ReactFontManager` at all.
   */
  const offenders: string[] = [];
  for (const file of FILES) {
    if (MONO_SURFACES.has(file)) continue;
    const source = code(readFileSync(file, 'utf8'));
    for (const match of source.matchAll(/fontWeight:\s*'(\d{3}|bold)'/gu)) {
      const value = match[1] ?? '';
      if (value === 'bold' || Number(value) >= 700) offenders.push(`${file}: ${match[0]}`);
    }
  }
  expect(offenders).toEqual([]);
});
