import { Image } from 'expo-image';
import type { LucideIcon } from 'lucide-react-native';

import { useThemeLibrary } from '@/stores/theme-library';
import type { ThemeIconName } from '@/theme/schema';

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
}: {
  name: ThemeIconName;
  fallback: LucideIcon;
  size: number;
  color: string;
  strokeWidth?: number;
}) {
  const icon = useThemeLibrary((state) => state.active?.manifest.icons?.[name]);
  const assets = useThemeLibrary(
    (state) =>
      state.library.themes.find((entry) => entry.id === state.active?.installationId)?.assets
  );
  const uri = icon ? assets?.[icon.asset] : undefined;
  // App-owned files only, the same rule every other artwork consumer applies:
  // a manifest cannot point this at an arbitrary path or a remote URL.
  if (!icon || !uri?.startsWith('file:///'))
    return <Fallback size={size} color={color} strokeWidth={strokeWidth} />;
  return (
    <Image
      source={{ uri }}
      // Never crops: a glyph that loses its edges reads as a different glyph.
      contentFit="contain"
      cachePolicy="memory"
      accessible={false}
      // Decorative here on purpose. The control around it carries the label,
      // so the glyph must not announce itself and say everything twice.
      style={{ width: size, height: size }}
      tintColor={icon.render === 'template' ? color : undefined}
    />
  );
}
