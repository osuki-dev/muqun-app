import { useThemeTokens } from '@osuki-dev/ui';
import { StyleSheet, View } from 'react-native';

import { useHasThemeArtwork } from '@/components/theme-artwork';
import { ThemedSurfaceArtwork } from '@/components/themed-surface';
import { useSurfaceBackground } from '@/hooks/use-surface-background';

/** Optional Home-only decoration; the field owns clipping and voice visibility. */
export function HomeComposerBackground() {
  const theme = useThemeTokens();
  const background = useSurfaceBackground();
  const hasArtwork = useHasThemeArtwork('home.composer.background');
  if (!hasArtwork) return null;
  return (
    <View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, { backgroundColor: background(theme.colors.surface) }]}>
      <ThemedSurfaceArtwork slot="home.composer.background" baseColor={theme.colors.surface} />
    </View>
  );
}
