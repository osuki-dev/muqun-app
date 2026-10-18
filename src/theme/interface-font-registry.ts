/**
 * How one reader-supplied file is described to the kit's font registry.
 *
 * Split out of `constants/theme.ts` for the reason `user-font-file.ts` gives
 * for its own existence: the moment a module imports the kit's components it
 * imports React Native, and `bun test` cannot load React Native's Flow entry
 * point. What is here is arithmetic over a plain object, so it can be tested
 * against the kit's real `resolveFontStyle` rather than against a description
 * of it -- and that matters, because the rule below is a rule about what
 * `resolveFontStyle` is allowed to return.
 */

import type { FontDefinition, FontRegistry, FontWeight, ResolvedFontStyle } from '@osuki-dev/ui';

import type { FontAxis } from '@/theme/user-font-file';

/**
 * The highest native weight the app may ask a reader's font for, and why there
 * is a ceiling at all.
 *
 * This is an Android bug rather than a preference.
 *
 * `expo-font` registers a loaded face with exactly one call --
 * `ReactFontManager.setTypeface(family, Typeface.NORMAL, typeface)`,
 * `FontLoaderModule.kt:59` -- which writes a single entry, under the NORMAL
 * style, into that family's `AssetFontFamily`. When React Native later asks
 * for the family at a weight, `ReactFontManager.getTypeface` first rounds the
 * weight to a `nearestStyle`: NORMAL below 700, BOLD at 700 and above
 * (`ReactFontManager.kt:138-144`). At 700 it looks up BOLD, finds nothing,
 * and falls through to `createAssetTypeface`, which looks for a
 * `fonts/<family>_bold.ttf` among the app's assets, does not find one either,
 * and ends on `Typeface.create(fontFamilyName, style)`. That last call
 * resolves against the *system* font list, where the reader's family is not a
 * name -- so it hands back the platform's own bold face.
 *
 * The effect is that every bold thing in the app quietly left the reader's
 * font on Android: the OpenCode card's "Welcome to OpenCode Agent", the home
 * wordmark, the kit's own `hero` and `dataLarge`. Invisible in a screenshot of
 * any one of them, obvious the moment a title sits above its own subtitle.
 *
 * 600 is the highest weight below the threshold, so it is the ceiling -- for a
 * static face. A variable face is still registered once, but React Native 0.88
 * added `fontVariationSettings` to `Text` and `TextInput` on both platforms
 * ("Variable fonts", https://reactnative.dev/blog/2026/10/19/react-native-0.88):
 * the face is asked for at 400, which finds the registered typeface, and the
 * weight travels as its `wght` axis instead (`variableWeightStyle`). That is
 * the font's own bold rather than a synthetic one, so the ceiling is lifted.
 */
export const USER_FONT_MAX_NATIVE_WEIGHT = 600;

/**
 * One reader-supplied file, described as a family the kit may ask any weight
 * of -- and that never answers with 700.
 *
 * `resolveFontStyle` walks a fallback ladder per weight and reports the native
 * weight of whichever rung it lands on. Listing every weight up to `semibold`
 * and omitting `bold` sends a bold request down one rung to `semibold`, which
 * reports 600: under the threshold above, so the registered typeface is found.
 *
 * Nothing is lost that the reader did not already not have. One file carries
 * one weight, so there is no bold in it to reach; a synthetic bold drawn in
 * somebody else's face is not this font in bold, it is a different font.
 *
 * `family` stays as the backstop for any weight the ladder cannot satisfy.
 *
 * A variable face carries its `wght` axis as well. The kit reads only the
 * weight keys and `family`, so its own components keep the ladder; the app's
 * `Text` and fields read `weightAxis` and set the axis directly.
 */
export function userFontDefinition(
  family: string,
  weightAxis?: FontAxis | null
): UserFontDefinition {
  return {
    light: family,
    regular: family,
    medium: family,
    semibold: family,
    family,
    ...(weightAxis ? { weightAxis } : {}),
  };
}

/** A registry entry that may also carry a variable reader face's `wght` axis. */
export type UserFontDefinition = FontDefinition & { weightAxis?: FontAxis };

/** A resolved style that may set the `wght` axis. */
export type UserFontStyle = ResolvedFontStyle & { fontVariationSettings?: { wght: number } };

/** The native weight each kit weight name asks for. */
const KIT_WEIGHTS: Record<FontWeight, number> = {
  light: 300,
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
};

/** Five weights spread across a `wght` axis, ends included, for a preview line. */
export function weightPreviewStops(axis: FontAxis): number[] {
  const stops = [0, 0.25, 0.5, 0.75, 1].map((at) =>
    Math.round(axis.min + (axis.max - axis.min) * at)
  );
  return [...new Set(stops)];
}

/** React Native's named weights, as numbers. */
const NAMED_WEIGHTS: Record<string, number> = {
  thin: 100,
  ultralight: 200,
  light: 300,
  normal: 400,
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  condensedBold: 700,
  heavy: 800,
  black: 900,
};

/** A style's `fontWeight` as a number, or `null` when it sets none. */
export function numericFontWeight(value: string | number | undefined): number | null {
  if (value === undefined) return null;
  if (typeof value === 'number') return value;
  return NAMED_WEIGHTS[value] ?? (Number.isFinite(Number(value)) ? Number(value) : null);
}

/** A role's `wght` axis, when its registry entry is a variable reader face. */
export function registryWeightAxis(registry: FontRegistry, role: string): FontAxis | null {
  return (registry[role] as UserFontDefinition | undefined)?.weightAxis ?? null;
}

/**
 * The style for one weight of a variable face: the registered typeface at
 * 400 and the requested weight as its `wght` axis, clamped to the font's range.
 *
 * 400 because it is the weight `expo-font`'s single registration answers to on
 * Android, and it is below the 600 at which Android's text stack starts faking
 * a bold; the axis does the rest. `weight` is a native number or a kit name.
 */
export function variableWeightStyle(
  family: string,
  axis: FontAxis,
  weight: number | FontWeight
): Required<UserFontStyle> {
  const requested = typeof weight === 'number' ? weight : KIT_WEIGHTS[weight];
  return {
    fontFamily: family,
    fontWeight: '400',
    fontVariationSettings: { wght: Math.min(axis.max, Math.max(axis.min, requested)) },
  };
}

/**
 * Every role the kit's type scale names, and nothing else.
 *
 * `display`, `body` and `label` are the whole of `typeStyles`' `fontFamily`
 * column: `hero` and `display` read `display`; `heading`, `subheading`, `body`
 * and `bodySmall` read `body`; `caption`, `label`, `data`, `dataLarge` and
 * `button` read `label`. Covering these three covers every variant the kit can
 * draw, which is why the list is stated here rather than discovered per
 * screen -- a role the app forgot is a surface that silently stays on the
 * system face, and that is exactly how the segmented controls and the
 * instrument headings came to be in a different font from the rows they label.
 */
export const KIT_FONT_ROLES = ['display', 'body', 'label'] as const;

export type KitFontRole = (typeof KIT_FONT_ROLES)[number];

/** The whole registry for one interface face: every role, one file. */
export function userFontRegistry(
  family: string,
  weightAxis?: FontAxis | null
): Record<KitFontRole, UserFontDefinition> {
  return {
    display: userFontDefinition(family, weightAxis),
    body: userFontDefinition(family, weightAxis),
    label: userFontDefinition(family, weightAxis),
  };
}
