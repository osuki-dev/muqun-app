import type { SplashRenderContext } from '@osuki-dev/react-native-splash';
import { useSplashMirror } from '@osuki-dev/react-native-splash';
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

import { useLaunchBackground, useLaunchHeroArtwork } from '@/hooks/use-launch-artwork';
import { LAUNCH_HERO_MAX_WIDTH, LAUNCH_HERO_WIDTH_FRACTION } from '@/hooks/use-launch-image-sync';
import { DURATION, timing } from '@/lib/motion';

/**
 * The launch every run after the first: the picture the OS let go of settles,
 * holds for a beat, and gets out of the way.
 *
 * The first frame is the native splash, pixel for pixel: `useSplashMirror`
 * hands back the same picture on the same paper, and `@osuki-dev/react-native-splash`
 * removes its native overlay only once this has been painted. Everything
 * below starts from that frame. Two beats, each on the design system's own
 * clock:
 *
 *  1. **Handover** (`long`). Usually nothing crosses: the compiled launch
 *     asset is the mascot itself, and with a pack applied the native overlay
 *     already drew the pack's picture (`useLaunchImageSync`). The handover
 *     then only carries the pack's paper in over the app's and settles the
 *     mascot's size -- the compiled asset is one width for every device, and
 *     tablets grow it. The one time there is something to cross to is a pack
 *     picture native has not been handed yet (the first launch after the
 *     pack was applied on a binary that could not persist it): the mascot
 *     shrinks out under the picture, which lands from slightly small and
 *     slightly low so it reads as arriving rather than appearing.
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

/**
 * The mascot at rest, in points, by width class. `compact` is also the
 * compiled launch asset's `imageWidth` in `app.json`: the mirror shows that
 * asset at the OS's own scale (`logoSizeRatio`, 1 on iOS, the system icon
 * scale on Android), and the handover settles it from there to this.
 */
const MARK_SIZE = { compact: 176, regular: 236 } as const;

/** How long the picture is held once the handover has landed, before the exit may begin. */
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
  const packPicture = artwork.kind === 'default' ? null : { uri: artwork.uri };

  /*
   * Whether the mirrored frame already shows the picture that will leave:
   * the bundled mascot is the compiled asset, and a pack's picture was drawn
   * natively when a launch image is in effect. Only a pack picture without
   * one has to be crossed to.
   */
  const mirrored = packPicture === null || mirror.manifest.launchImage !== undefined;
  const mirroredMarkWidth = MARK_SIZE.compact * mirror.manifest.logoSizeRatio;
  const settleScale = packPicture === null ? markSize / mirroredMarkWidth : 1;

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
    opacity: 1 - exit.value,
  }));
  const floorStyle = useAnimatedStyle(() => ({
    opacity: handover.value,
  }));
  // The mirrored picture stays put and only settles its size, then grows
  // out with the exit.
  const mirroredStyle = useAnimatedStyle(() => ({
    transform: [
      {
        scale:
          interpolate(handover.value, [0, 1], [1, settleScale]) *
          interpolate(exit.value, [0, 1], [1, 1.12]),
      },
    ],
  }));
  // Crossing to a pack picture: the mascot is gone by the handover's midpoint
  // and grows on the way out, so the two read as one thing changing rather
  // than as two things overlaid.
  const outgoingStyle = useAnimatedStyle(() => ({
    opacity: interpolate(handover.value, [0, 0.5], [1, 0], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(handover.value, [0, 0.5], [1, 1.25], Extrapolation.CLAMP) }],
  }));
  const incomingStyle = useAnimatedStyle(() => ({
    opacity: handover.value,
    transform: [
      { translateY: interpolate(handover.value, [0, 1], [10, 0]) },
      {
        scale:
          interpolate(handover.value, [0, 1], [0.84, 1]) *
          interpolate(exit.value, [0, 1], [1, 1.12]),
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
                source={packPicture}
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
