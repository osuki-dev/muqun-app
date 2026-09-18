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

test('the settings segmented control draws its labels with the kit', () => {
  const source = readFileSync('src/components/settings-segmented.tsx', 'utf8');
  // The control where the reader picks a font must not be the control that
  // ignores it. It used to copy the kit's label size and tracking by hand out
  // of `theme.typeStyles.label` -- which carries no family, because a type
  // style has none to carry -- and so stayed on the system face for good.
  expect(source).toContain("import { Tabs, Text, useThemeTokens } from '@osuki-dev/ui';");
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
