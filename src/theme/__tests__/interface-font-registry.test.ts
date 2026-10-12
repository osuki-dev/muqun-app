import { expect, test } from 'bun:test';

import {
  KIT_FONT_ROLES,
  userFontRegistry,
  USER_FONT_MAX_NATIVE_WEIGHT,
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
