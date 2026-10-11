import { useThemeMode } from '@osuki-dev/ui';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { ThemeArtworkLayer, useHasThemeArtwork } from '@/components/theme-artwork';
import { useEffectiveCustomTheme } from '@/components/theme-candidate';
import { resolveThemeImage } from '@/theme/resolve';
import { resolveHomeComposerOutset } from '@/theme/home-composer-outset';

/** Optional Home-only decoration; the field owns clipping and voice visibility. */
export function HomeComposerBackground() {
  return <HomeComposerArtwork slot="home.composer.background" />;
}

/** Omitted, zero or unrenderable artwork keeps the original clipped field. */
export function useHomeComposerBackgroundOutset() {
  const { theme, assets } = useEffectiveCustomTheme();
  const { resolvedMode } = useThemeMode();
  const { width } = useWindowDimensions();
  const artwork = theme
    ? resolveThemeImage(
        theme.manifest,
        'home.composer.background',
        resolvedMode,
        width >= 768 ? 'regular' : 'compact'
      )
    : null;
  return resolveHomeComposerOutset(artwork, assets);
}

/** The dock may reserve this much scroll clearance without enlarging the field. */
export const HOME_COMPOSER_DECORATION_OVERHANG = 48;

export function useHomeComposerDecorationOverhang() {
  return useHasThemeArtwork('home.composer.decoration') ? HOME_COMPOSER_DECORATION_OVERHANG : 0;
}

/** A separate bounded layer: 48 dp above the rim and 16 dp inside the field. */
export function HomeComposerDecoration() {
  return <HomeComposerArtwork slot="home.composer.decoration" />;
}

function HomeComposerArtwork({
  slot,
}: {
  slot: 'home.composer.background' | 'home.composer.decoration';
}) {
  const { theme, assets } = useEffectiveCustomTheme();
  const { resolvedMode } = useThemeMode();
  const { width } = useWindowDimensions();
  if (!theme || !assets) return null;
  const artwork = resolveThemeImage(
    theme.manifest,
    slot,
    resolvedMode,
    width >= 768 ? 'regular' : 'compact'
  );
  if (!artwork) return null;
  const layer = (
    <ThemeArtworkLayer
      manifest={theme.manifest}
      assets={assets}
      slot={slot}
      mode={resolvedMode}
      // Frames and edge characters need their authored strength. Authors reserve
      // transparent space for text/controls; generic surface contrast caps do not
      // apply to this opt-in layer. An unspecified strength remains quiet.
      opacityLimit={artwork.opacity ?? 0.18}
      effectsEnabled={false}
    />
  );
  if (slot === 'home.composer.background') return layer;
  return (
    <View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={styles.decoration}>
      {layer}
    </View>
  );
}

const styles = StyleSheet.create({
  decoration: {
    position: 'absolute',
    top: -HOME_COMPOSER_DECORATION_OVERHANG,
    left: 0,
    right: 0,
    height: HOME_COMPOSER_DECORATION_OVERHANG + 16,
    overflow: 'hidden',
  },
});
