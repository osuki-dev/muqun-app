/**
 * The app's `Text`: the design system's, with a variable reader face's weight
 * set on its `wght` axis.
 *
 * The Android trailing slack a reader's face needs (an oblique draws its last
 * glyph past its advance and `TextView` clips it) is the theme's now: the
 * reader's font roles set `trailingSlack` (`theme/interface-font-registry.ts`),
 * and every kit `Text` reads it, including the labels inside kit components.
 * `hugSlack={false}` still opts a glyph in a box of its own size out.
 */
import { Text as KitText, useThemeTokens, type TextProps } from '@osuki-dev/ui';
import { Platform, Text as NativeText, StyleSheet, type TextStyle } from 'react-native';

import {
  numericFontWeight,
  registryWeightAxis,
  variableWeightStyle,
} from '@/theme/interface-font-registry';

export type { TextProps };

/**
 * The caller's style with a variable reader face's weight set on its `wght`
 * axis, or `null` when the kit's own resolution stands.
 *
 * The kit resolves weight through a ladder that never reports 700 for a
 * reader's file (`interface-font-registry.ts`), which is right for a static
 * face and needlessly caps a variable one at semibold. Layered after the
 * caller's style, so it takes the weight the kit would have used -- the
 * style's `fontWeight`, else `weight`, else the variant's -- and restates it as
 * the axis. A style that names another family or sets its own axes is left
 * alone.
 */
function useVariableWeight(props: TextProps): TextStyle | null {
  const { fonts, typeStyles } = useThemeTokens();
  const typeStyle = typeStyles[props.variant ?? 'body'];
  const axis = typeStyle ? registryWeightAxis(fonts, typeStyle.fontFamily) : null;
  const family = typeStyle ? fonts[typeStyle.fontFamily]?.family : undefined;
  if (!axis || !family) return null;
  const flat = StyleSheet.flatten(props.style);
  if (flat?.fontVariationSettings !== undefined) return null;
  if (flat?.fontFamily && flat.fontFamily !== family) return null;
  const weight = numericFontWeight(flat?.fontWeight) ?? props.weight ?? typeStyle.fontWeight;
  return { ...flat, ...variableWeightStyle(family, axis, weight) };
}

/**
 * The caller's axes moved off the paragraph and onto one run inside it.
 *
 * Android measures a paragraph with a paint that already carries the
 * paragraph's `fontVariationSettings`, then lets each run's span swap the
 * typeface back to the plain face and set the same settings again. `Paint`
 * returns early when the settings string has not changed, so the run is
 * measured on the face's default instance (`wght` 400 for most families) while
 * it is drawn at the requested weight. Anything heavier than the default then
 * draws wider than its box: a bold heading loses its last letters to a wrap the
 * box is too short to show, and the font sheet's `Aa` weight row read
 * `Aa Aa A A A`. With the axes only on the inner run, the paragraph paint has
 * none, the span's settings differ from it, and the run is measured as drawn.
 */
function splitVariation(props: TextProps): {
  props: TextProps;
  axes: TextStyle['fontVariationSettings'];
} {
  if (Platform.OS !== 'android') return { props, axes: undefined };
  const flat = StyleSheet.flatten(props.style);
  if (flat?.fontVariationSettings === undefined) return { props, axes: undefined };
  const { fontVariationSettings, ...paragraph } = flat;
  return { props: { ...props, style: paragraph }, axes: fontVariationSettings };
}

export function Text({ children, ...rest }: TextProps) {
  const variableStyle = useVariableWeight(rest);
  const { props, axes } = splitVariation(variableStyle ? { ...rest, style: variableStyle } : rest);
  return (
    <KitText {...props}>
      {axes === undefined ? (
        children
      ) : (
        <NativeText style={{ fontVariationSettings: axes }}>{children}</NativeText>
      )}
    </KitText>
  );
}
