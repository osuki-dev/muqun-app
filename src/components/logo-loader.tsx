import { useEffect, useState } from 'react';
import { useAppActive } from '@/hooks/use-app-active';
import { useThemeMode } from '@osuki-dev/ui';
import { useEffectiveCustomTheme } from '@/components/theme-candidate';
import { resolveLaunchArtwork } from '@/theme/launch-artwork';
import { Image } from 'expo-image';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { useBrandMark } from '@/components/brand-mark';
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

/**
 * Half a breath.
 *
 * Deliberately not one of `@/lib/motion`'s tokens: those size a transition
 * between two states, and this is the period of a loop that never arrives. Its
 * easing is a matched out/in pair for the same reason -- the shared `EASE_OUT`
 * would make the mark rise and then stall before falling.
 */
const BREATH_MS = 620;

export function LogoLoader({
  size = 56,
  accessibilityLabel = 'Loading',
  compact = false,
}: {
  size?: number;
  accessibilityLabel?: string;
  compact?: boolean;
}) {
  const logo = useBrandMark();
  const { theme, assets } = useEffectiveCustomTheme();
  const { resolvedMode } = useThemeMode();
  const { width } = useWindowDimensions();
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const artwork = resolveLaunchArtwork(
    theme,
    assets,
    resolvedMode,
    width >= 768 ? 'regular' : 'compact'
  );
  const artworkUri =
    !compact && artwork.kind === 'artwork' && artwork.uri !== failedUri ? artwork.uri : null;
  const reduceMotion = useReducedMotion();
  const appActive = useAppActive();
  const progress = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion || !appActive) {
      progress.value = 0;
      return;
    }
    progress.value = withRepeat(
      withSequence(
        withTiming(1, { duration: BREATH_MS, easing: Easing.out(Easing.cubic) }),
        withTiming(0, { duration: BREATH_MS, easing: Easing.in(Easing.cubic) })
      ),
      3,
      false
    );
    return () => cancelAnimation(progress);
  }, [progress, reduceMotion, appActive]);

  const logoStyle = useAnimatedStyle(() => ({
    opacity: reduceMotion ? 1 : interpolate(progress.value, [0, 1], [0.78, 1]),
    transform: [
      { translateY: reduceMotion ? 0 : interpolate(progress.value, [0, 1], [1.5, -2.5]) },
      { scale: reduceMotion ? 1 : interpolate(progress.value, [0, 1], [0.96, 1.04]) },
    ],
  }));
  const haloStyle = useAnimatedStyle(() => ({
    opacity: reduceMotion ? 0.14 : interpolate(progress.value, [0, 1], [0.08, 0.24]),
    transform: [{ scale: reduceMotion ? 1 : interpolate(progress.value, [0, 1], [0.82, 1.12]) }],
  }));
  const logoSize = size * (compact ? 1.18 : 1.45);
  // Reserve the image's actual footprint so the caption below cannot overlap it.
  const imageWidth = artworkUri ? Math.min(size * 3, width - 64) : logoSize;
  const imageHeight = artworkUri ? imageWidth / 2 : logoSize;

  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="progressbar"
      style={[styles.root, { width: imageWidth, height: imageHeight }]}>
      {!compact && !artworkUri ? (
        <Animated.View
          style={[styles.halo, { borderRadius: size / 2, backgroundColor: '#FF705E' }, haloStyle]}
        />
      ) : null}
      <Animated.View
        style={[
          styles.logo,
          {
            width: imageWidth,
            height: imageHeight,
          },
          logoStyle,
        ]}>
        <Image
          contentFit="contain"
          source={artworkUri ? { uri: artworkUri } : logo}
          onError={() => {
            if (artworkUri) setFailedUri(artworkUri);
          }}
          autoplay={false}
          accessible={false}
          style={[styles.logoImage, { width: imageWidth, height: imageHeight }]}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  logo: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoImage: {
    flexShrink: 0,
  },
});
