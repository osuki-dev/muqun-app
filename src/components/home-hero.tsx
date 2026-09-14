import { useThemeMode } from '@osuki-dev/ui';
import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';

import { useEffectiveCustomTheme } from '@/components/theme-candidate';
import { fadeIn, fadeOut, listLayout } from '@/lib/motion';
import { homeHeroMaxHeight, THEME_ARTWORK_REGULAR_MIN_WIDTH } from '@/lib/responsive-layout';
import { resolveHomeHero } from '@/theme/home-hero';
import { homeHeroPreference } from '@/theme/repository';
import { useThemeLibrary } from '@/stores/theme-library';

/**
 * The pack's own picture at the top of Home, when there is one to show.
 *
 * Deliberately not a `ThemeArtwork`. Every other slot is a decoration painted
 * *behind* something that reserves its own space, which is why
 * `ThemeArtworkLayer` is an absolute fill and why a missing image costs no
 * layout. A hero is the opposite: it is content, it takes a band of the page,
 * and the rest of the screen moves when it appears. Borrowing the decoration
 * component would have meant a slot that silently behaves like none of the
 * others behind the same name.
 *
 * It is also the only artwork on Home the reader can turn on and off, so the
 * decision about whether to draw anything is not this component's -- see
 * `resolveHomeHero`, which is where the author's default, the reader's override
 * and the empty-state fallback meet.
 *
 * Nothing here is a hit target and nothing is announced: it is a picture, and a
 * screen reader moving from the header to the server list should find the
 * server list.
 *
 * `scrollY` is Home's existing offset -- the one the brand block's own swap
 * already rides -- rather than a listener of this component's own. The fade
 * lives here rather than at the call site because its travel is the band's
 * height, and the band's height is this component's answer.
 */
export function HomeHero({ scrollY }: { scrollY: SharedValue<number> }) {
  const { resolvedMode } = useThemeMode();
  const { width } = useWindowDimensions();
  const band = homeHeroMaxHeight(width);
  const scrollStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [0, band], [1, 0], Extrapolation.CLAMP),
  }));
  const { theme, assets } = useEffectiveCustomTheme();
  const installationId = theme?.installationId;
  const preference = useThemeLibrary((state) => {
    const installed = state.library.themes.find((entry) => entry.id === installationId);
    return installed ? homeHeroPreference(installed) : 'theme';
  });
  const [failed, setFailed] = useState<string | null>(null);

  const resolved = resolveHomeHero({
    manifest: theme?.manifest,
    mode: resolvedMode,
    width: width >= THEME_ARTWORK_REGULAR_MIN_WIDTH ? 'regular' : 'compact',
    preference,
  });
  const uri = resolved ? assets?.[resolved.image.asset] : undefined;
  if (!resolved || !uri?.startsWith('file:///') || failed === uri) return null;

  return (
    <Animated.View
      testID="home-hero"
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      entering={fadeIn('medium')}
      exiting={fadeOut('medium')}
      layout={listLayout('medium')}
      style={[styles.hero, { height: band }, scrollStyle]}>
      <Image
        source={{ uri }}
        // Always `contain`, whatever the slot says. The band is a ceiling on how
        // much of the first screen a decoration may take, and `cover` would fill
        // it by cropping the author's drawing to a letterbox -- which is a
        // different picture from the one they approved.
        contentFit="contain"
        contentPosition={
          resolved.image.focalPoint
            ? {
                left: `${resolved.image.focalPoint.x * 100}%`,
                top: `${resolved.image.focalPoint.y * 100}%`,
              }
            : 'center'
        }
        cachePolicy="memory"
        autoplay={false}
        accessible={false}
        style={[StyleSheet.absoluteFill, { opacity: resolved.image.opacity ?? 1 }]}
        onError={() => setFailed(uri)}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  hero: { width: '100%', alignSelf: 'center' },
});
