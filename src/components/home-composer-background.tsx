import { useThemeMode } from '@osuki-dev/ui';
import { useWindowDimensions } from 'react-native';

import { ThemeArtworkLayer } from '@/components/theme-artwork';
import { useEffectiveCustomTheme } from '@/components/theme-candidate';
import { resolveThemeImage } from '@/theme/resolve';

/** Optional Home-only decoration; the field owns clipping and voice visibility. */
export function HomeComposerBackground() {
  const { theme, assets } = useEffectiveCustomTheme();
  const { resolvedMode } = useThemeMode();
  const { width } = useWindowDimensions();
  if (!theme || !assets) return null;
  const artwork = resolveThemeImage(
    theme.manifest,
    'home.composer.background',
    resolvedMode,
    width >= 768 ? 'regular' : 'compact'
  );
  if (!artwork) return null;
  return (
    <ThemeArtworkLayer
      manifest={theme.manifest}
      assets={assets}
      slot="home.composer.background"
      mode={resolvedMode}
      // Frames and edge characters need their authored strength. Authors reserve
      // transparent space for text/controls; generic surface contrast caps do not
      // apply to this opt-in layer. An unspecified strength remains quiet.
      opacityLimit={artwork.opacity ?? 0.18}
      effectsEnabled={false}
    />
  );
}
