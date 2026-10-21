import { Image } from 'expo-image';
import { useState, type ComponentType } from 'react';

import { useEffectiveCustomTheme } from '@/components/theme-candidate';
import type { ThemeIconDirection, ThemeIconName } from '@/theme/schema';
import { resolveThemeIcon, type ThemeIconChoice } from '@/theme/icon-direction';
import { isRenderableThemeAsset } from '@/theme/renderable-asset';

/**
 * A chrome glyph the active pack may have replaced.
 *
 * The contract is the built-in icon's: same size, same colour, same place. A
 * pack that supplies nothing, names an asset that is not installed, or names a
 * glyph this build has never heard of gets the built-in drawing with no notice
 * and no gap -- these are controls, and a back arrow that is merely absent is
 * a screen with no way out.
 *
 * `template` is the default and the one to reach for: the drawing supplies the
 * shape through its alpha and the theme supplies the colour, so a single image
 * is correct in light and dark. `original` keeps the image's own colours, which
 * only a mark with fixed branding should ask for.
 */
export function ThemeIcon({
  name,
  fallback: Fallback,
  size,
  color,
  strokeWidth,
  direction,
  alternate,
}: {
  name: ThemeIconName;
  /** An app glyph: what is drawn when the pack supplies no usable image. */
  fallback: ComponentType<{ size: number; color: string; strokeWidth?: number }>;
  size: number;
  color: string;
  strokeWidth?: number;
  /** Desired control direction; unknown source directions use the correctly oriented fallback. */
  direction?: ThemeIconDirection;
  /** Another of the pack's glyphs to draw when it has no `name`, before the app's own. */
  alternate?: ThemeIconChoice;
}) {
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const { theme, assets } = useEffectiveCustomTheme();
  // App-owned files only, the same rule every other artwork consumer applies:
  // a manifest cannot point this at an arbitrary path or a remote URL.
  const usable = (uri: string | undefined): uri is string =>
    isRenderableThemeAsset(uri) && uri !== failedUri;
  const resolved = resolveThemeIcon(
    theme?.manifest,
    assets,
    alternate ? [{ name, direction }, alternate] : [{ name, direction }],
    usable
  );
  if (!resolved) return <Fallback size={size} color={color} strokeWidth={strokeWidth} />;
  const { uri, rotation, render } = resolved;
  return (
    <Image
      source={{ uri }}
      onError={() => setFailedUri(uri)}
      // Never crops: a glyph that loses its edges reads as a different glyph.
      contentFit="contain"
      cachePolicy="memory"
      accessible={false}
      // Decorative here on purpose. The control around it carries the label,
      // so the glyph must not announce itself and say everything twice.
      style={{
        width: size,
        height: size,
        // ExpoImage forwards this as both a native prop and a style field.
        // Reset a previous rotation explicitly; undefined becomes null in the
        // native diff and React Native's transform processor cannot read it.
        transform: [{ rotate: `${rotation}deg` }],
      }}
      tintColor={render === 'template' ? color : undefined}
    />
  );
}
