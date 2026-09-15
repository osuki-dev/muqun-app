import type { SplashRenderContext } from '@osuki-dev/react-native-splash';
import { useSplashMirror } from '@osuki-dev/react-native-splash';
import { useThemeMode } from '@osuki-dev/ui';
import { Image } from 'expo-image';
import { useEffect } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { brandMark } from '@/components/brand-mark';
import { useLaunchBackground, useLaunchHeroArtwork } from '@/hooks/use-launch-artwork';
import { LAUNCH_HERO_MAX_WIDTH, LAUNCH_HERO_WIDTH_FRACTION } from '@/hooks/use-launch-image-sync';
import { DURATION, timing } from '@/lib/motion';

/**
 * The launch every run after the first: the picture lands on the paper the OS
 * let go of, holds for a beat, and gets out of the way.
 *
 * The compiled launch screen is paper only. It is drawn by the OS before the
 * app runs and cannot know which theme is applied, so a mark compiled into
 * it would flash before every themed launch; with none there, a themed
 * install goes from the OS's paper straight to the pack's picture, which the
 * native overlay draws from the first frame the app owns
 * (`useLaunchImageSync`). `useSplashMirror` paints that same frame, and the
 * overlay is removed only once it has. Two beats, each on the design
 * system's own clock:
 *
 *  1. **Handover** (`long`). One value carries the pack's paper in over the
 *     app's and the picture in. With a launch image in effect the picture is
 *     already there and only the paper moves; otherwise -- the bundled
 *     mascot, or a pack picture native has not been handed yet -- it arrives
 *     from slightly small and slightly low, so it reads as landing rather
 *     than appearing.
 *  2. **Exit** (`long`). The picture keeps growing past its resting size and
 *     the whole sheet fades, which reveals the app underneath from the
 *     picture outward. Only once the overlay's `phase` says `exiting`, which
 *     is after `ready` and the minimum hold; the sheet itself is the app's
 *     first screen already rendered.
 *
 * Which picture is `useLaunchHeroArtwork`'s call: the pack's `home.hero` when
 * it drew one, else its empty-state illustration, else its Home logo, else the
 * bundled mascot. A pack's picture is shown as composed, on the pack's paper.
 *
 * Reduce Motion is `timing`'s to answer: every value lands immediately and the
 * completion still fires, so `finish()` is always reached.
 */

/** The mascot at rest, in points, by width class. */
const MARK_SIZE = { compact: 176, regular: 236 } as const;

export const LAUNCH_BRAND_HOLD_MS = DURATION.medium;

export function LaunchBrand({ phase, finish }: SplashRenderContext) {
  const mirror = useSplashMirror();
  const artwork = useLaunchHeroArtwork();
  const packBackground = useLaunchBackground();
  const { width, height } = useWindowDimensions();

  const widthClass = width >= 768 ? 'regular' : 'compact';
  const markSize = MARK_SIZE[widthClass];
  const heroWidth = Math.min(
    width * LAUNCH_HERO_WIDTH_FRACTION,
    LAUNCH_HERO_MAX_WIDTH,
    height * 0.6
  );
  const pictureBox =
    artwork.kind === 'hero'
      ? { width: heroWidth, height: heroWidth / 2 }
      : { width: markSize, height: markSize };
  const { resolvedMode } = useThemeMode();
  const picture = artwork.kind === 'default' ? brandMark(resolvedMode) : { uri: artwork.uri };

  // Whether the mirrored frame already shows the picture that will leave: a
  // pack's picture was drawn natively when a launch image is in effect. The
  // compiled launch screen carries no mark, so everything else is crossed to.
  const mirrored = mirror.manifest.launchImage !== undefined;

  const handover = useSharedValue(0);
  const exit = useSharedValue(0);

  useEffect(() => {
    if (phase === 'visible') {
      handover.value = withDelay(DURATION.micro, withTiming(1, timing('long')));
      return;
    }
    if (phase !== 'exiting') return;
    exit.value = withTiming(1, timing('long'), (finished) => {
      if (finished) scheduleOnRN(finish);
    });
    // The shared values are stable; only the phase drives this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const sheetStyle = useAnimatedStyle(() => ({
    // Reveal the already mounted home early, then let the image finish fading.
    opacity: interpolate(exit.value, [0, 0.2, 1], [1, 0.92, 0]),
  }));
  const floorStyle = useAnimatedStyle(() => ({
    opacity: handover.value,
  }));
  // Start at the exact native size, breathe once after handoff, then recede.
  // No loop or additional hold: startup never waits for decorative motion.
  const mirroredStyle = useAnimatedStyle(() => ({
    transform: [
      {
        scale:
          interpolate(handover.value, [0, 0.65, 1], [1, 1.025, 1]) *
          interpolate(exit.value, [0, 1], [1, 1.08]),
      },
    ],
  }));
  // Whatever the mirror drew (nothing, today) is gone by the handover's
  // midpoint and grows on the way out, so the two read as one thing changing
  // rather than as two things overlaid.
  const outgoingStyle = useAnimatedStyle(() => ({
    opacity: interpolate(handover.value, [0, 0.5], [1, 0], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(handover.value, [0, 0.5], [1, 1.25], Extrapolation.CLAMP) }],
  }));
  const incomingStyle = useAnimatedStyle(() => ({
    opacity: handover.value,
    transform: [
      { translateY: interpolate(handover.value, [0, 1], [6, 0]) },
      {
        scale:
          interpolate(handover.value, [0, 0.7, 1], [0.94, 1.025, 1]) *
          interpolate(exit.value, [0, 1], [1, 1.08]),
      },
    ],
  }));

  return (
    <Animated.View style={[mirror.container.style, sheetStyle]}>
      {packBackground ? (
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: packBackground }, floorStyle]}
        />
      ) : null}
      <View pointerEvents="none" style={styles.stage}>
        {mirrored ? (
          <Animated.Image {...mirror.logo} style={[mirror.logo.style, mirroredStyle]} />
        ) : (
          <>
            {mirror.hasLogo ? (
              <Animated.Image
                {...mirror.logo}
                style={[mirror.logo.style, styles.outgoing, outgoingStyle]}
              />
            ) : null}
            <Animated.View style={[pictureBox, incomingStyle]}>
              <Image
                source={picture}
                contentFit="contain"
                cachePolicy="memory"
                autoplay={false}
                accessible={false}
                style={StyleSheet.absoluteFill}
              />
            </Animated.View>
          </>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  stage: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  outgoing: {
    position: 'absolute',
  },
});
