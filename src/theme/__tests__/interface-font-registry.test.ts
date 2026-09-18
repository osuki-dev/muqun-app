import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import {
  KIT_FONT_ROLES,
  userFontDefinition,
  userFontRegistry,
  USER_FONT_MAX_NATIVE_WEIGHT,
  type KitFontRole,
} from '@/theme/interface-font-registry';

/**
 * The kit's own typography module, imported by file path.
 *
 * Not through `@osuki-dev/ui/theme`: that barrel reaches `theme-provider.tsx`
 * and therefore React Native, whose entry point is Flow and which `bun test`
 * cannot load. `typography.ts` imports nothing at all, so the path import is
 * the whole of the kit's real weight arithmetic with none of its runtime.
 *
 * Asking the kit rather than describing it is the point of this file. What is
 * under test is what `resolveFontStyle` *returns* for the registry the app
 * builds, and a hand-written copy of the fallback ladder would agree with
 * itself forever while the kit moved underneath it.
 */
import {
  resolveFontStyle,
  typeStyles,
  type FontWeight,
} from '../../../node_modules/@osuki-dev/ui/src/theme/typography';

/** Every weight the kit can be asked for, in its own vocabulary. */
const WEIGHTS: readonly FontWeight[] = ['light', 'regular', 'medium', 'semibold', 'bold'];

const FAMILY = 'MuqunUserInterface_a1b2c3';

test('the registry names every role the kit draws with, and no invented one', () => {
  const used = new Set(Object.values(typeStyles).map((style) => style.fontFamily));
  // Exhaustive in both directions. A role the kit added and the app has not
  // heard of is a surface that silently stays on the system face, which is how
  // the instrument headings and the segmented controls ended up in a different
  // font from the rows they label; a role the app carries that the kit never
  // reads is a line of registry nobody is maintaining.
  expect([...used].sort()).toEqual([...KIT_FONT_ROLES].sort());
});

test('every role, at every weight, resolves to the reader’s own family', () => {
  const fonts = userFontRegistry(FAMILY);
  for (const role of KIT_FONT_ROLES) {
    for (const weight of WEIGHTS) {
      expect(resolveFontStyle(fonts, role, weight).fontFamily).toBe(FAMILY);
    }
  }
});

test('every variant the kit can draw resolves to the reader’s own family', () => {
  const fonts = userFontRegistry(FAMILY);
  // The variants, not the roles: this is the list a caller actually writes.
  for (const [variant, style] of Object.entries(typeStyles)) {
    const resolved = resolveFontStyle(fonts, style.fontFamily, 'regular');
    expect(`${variant}:${resolved.fontFamily}`).toBe(`${variant}:${FAMILY}`);
  }
});

test('no weight ever reaches 700, because Android answers 700 with its own font', () => {
  const fonts = userFontRegistry(FAMILY);
  for (const role of KIT_FONT_ROLES) {
    for (const weight of WEIGHTS) {
      const resolved = resolveFontStyle(fonts, role, weight);
      // `ReactFontManager.getTypeface` rounds 700 and above to `Typeface.BOLD`,
      // finds no BOLD entry (expo-font registers NORMAL only), and ends on
      // `Typeface.create(familyName, style)` -- a system lookup that does not
      // know this family. The reader's font is gone at exactly that point.
      expect(Number(resolved.fontWeight)).toBeLessThanOrEqual(USER_FONT_MAX_NATIVE_WEIGHT);
    }
  }
});

test('the kit’s own 700-weight variants come back under the ceiling', () => {
  const fonts = userFontRegistry(FAMILY);
  // `hero` and `dataLarge` are declared at 700 in the kit's type scale, and
  // the kit turns that number into the `bold` request this registry catches.
  const heavy = Object.entries(typeStyles).filter(([, style]) => style.fontWeight >= 700);
  expect(heavy.length).toBeGreaterThan(0);
  for (const [variant, style] of heavy) {
    const resolved = resolveFontStyle(fonts, style.fontFamily, 'bold');
    expect(`${variant}:${resolved.fontFamily}`).toBe(`${variant}:${FAMILY}`);
    expect(Number(resolved.fontWeight)).toBeLessThanOrEqual(USER_FONT_MAX_NATIVE_WEIGHT);
  }
});

test('the definition omits bold on purpose and keeps a family backstop', () => {
  const definition = userFontDefinition(FAMILY);
  expect(definition.bold).toBeUndefined();
  expect(definition.semibold).toBe(FAMILY);
  // The rung a bold request lands on when `bold` is absent.
  expect(definition.family).toBe(FAMILY);
});

test('buildTheme installs that registry rather than rolling its own', () => {
  const theme = readFileSync('src/constants/theme.ts', 'utf8');
  expect(theme).toContain('userFontRegistry(interfaceFamily)');
  // A role assigned by hand here is a role that can drift from the list above.
  for (const role of KIT_FONT_ROLES) {
    expect(theme).not.toContain(`${role}: { family: interfaceFamily }`);
  }
});

test('a slot with no file leaves the preset alone', () => {
  const theme = readFileSync('src/constants/theme.ts', 'utf8');
  // The overwhelmingly common case: a reader who never added a font must get
  // the kit's own empty definitions, which is how `fontFamily: undefined`
  // reaches React Native and the platform UI face is used.
  expect(theme).toContain('interfaceFamily\n    ? { ...preset.fonts, ...userFontRegistry(');
  expect(theme).toContain(': preset.fonts;');
});

/** Typed so a role added to the kit fails compilation here too, not only at runtime. */
const _roleIsAString: KitFontRole = 'body';
void _roleIsAString;
