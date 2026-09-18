import type { SplashRenderContext } from '@osuki-dev/react-native-splash';
import { useSplashMirror } from '@osuki-dev/react-native-splash';
import { useThemeMode, useThemeTokens } from '@osuki-dev/ui';
import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { brandMark } from '@/components/brand-mark';
import { useLaunchBackground, useLaunchHeroArtwork } from '@/hooks/use-launch-artwork';
import { LAUNCH_HERO_MAX_WIDTH, LAUNCH_HERO_WIDTH_FRACTION } from '@/hooks/use-launch-image-sync';
import {
  canSkipLaunchIntro,
  launchIntroTimeline,
  reducedLaunchIntroTimeline,
} from '@/lib/launch-intro-timeline';
import { DURATION, NAVIGATION_MOTION, timing } from '@/lib/motion';

/**
 * The launch every run after the first: the reader's own picture coming up
 * like a console finding its signal, then getting out of the way.
 *
 * Muqun is a terminal, so the one memorable moment at launch is the moment a
 * display locks on. Three things happen at once and then stop happening:
 * two displaced copies of the picture collapse back onto it, a single band
 * sweeps down it, and four brackets close around its box. That is the whole
 * idea. There is no loop, no drifting particle, no breathing glow -- every
 * value here runs once and settles, because a startup screen that is still
 * moving is a startup screen still asking to be watched.
 *
 * ## Why the treatment is not a palette
 *
 * A theme pack can be Santorini watercolours or One Piece cover art, and the
 * reader picked it. An intro that painted the launch in hard-coded neon --
 * which is what a cyberpunk preset normally is -- would overrule that choice
 * on the one screen where the pack is the whole picture. So nothing here is
 * coloured in: the picture is the pack's own launch artwork, the paper is the
 * pack's, and the only ink the sequence adds is `colors.primary` for the band
 * and the brackets. Swap the pack and the launch is a different launch, with
 * the same choreography. The cyberpunk read lives in the motion and the
 * composition, which is the part that can survive a watercolour.
 *
 * ## What it starts from
 *
 * The first frame is not a blank. `useSplashMirror()` reproduces the native
 * launch screen exactly, and the native overlay is only removed once that
 * copy has painted, so beat one begins on the picture the OS was already
 * showing. With a launch image in effect (`useLaunchImageSync`) that picture
 * is the pack's and native drew it; without one the compiled launch screen is
 * paper only, and the pack's picture is crossed in over the handover exactly
 * as it was before this sequence existed.
 *
 * ## Skipping and Reduce Motion
 *
 * A tap after `skipArmedAt` ends the sequence early; a tap before it is
 * ignored, because a reader reaching for the app they just opened has not
 * decided to skip anything. With Reduce Motion on, none of the moving parts
 * are rendered at all and the sheet simply cross-fades -- see
 * `reducedLaunchIntroTimeline` for why a dissolve is the right answer there
 * rather than a hard cut.
 *
 * Timing is entirely `launch-intro-timeline.ts`'s, which is where it can be
 * tested; this file is the drawing.
 */

/** The mascot at rest, in points, by width class. Shared rule with the lock screen. */
const MARK_SIZE = { compact: 176, regular: 236 } as const;

/**
 * How far the displaced copies sit from the picture before they collapse onto
 * it, as a fraction of the picture's width, with a floor and a ceiling in
 * points.
 *
 * A fraction rather than a flat number because the two things this draws over
 * differ by a factor of four: a pack's hero is most of the screen wide, a
 * bundled mark is 176 points. Ten points is a visible displacement on the mark
 * and invisible on the hero, which is how the beat went missing the first time
 * it ran on a device.
 */
const LOCK_OFFSET = { fraction: 0.04, min: 10, max: 30 } as const;

/** The corner brackets: arm length, how far outside the picture they sit, and their weight. */
const BRACKET = { arm: 22, inset: 14, weight: 2 } as const;

/** The scan band, as a fraction of the picture's height. */
const SCAN_BAND = 0.18;

export function LaunchIntroCyberpunk({
  phase,
  finish,
  onDone,
}: SplashRenderContext & { onDone: () => void }) {
  const mirror = useSplashMirror();
  const artwork = useLaunchHeroArtwork();
  const packBackground = useLaunchBackground();
  const theme = useThemeTokens();
  const { resolvedMode } = useThemeMode();
  const { width, height } = useWindowDimensions();
  const reduced = useReducedMotion();

  const beats = useMemo(
    () => (reduced ? reducedLaunchIntroTimeline(DURATION) : launchIntroTimeline(DURATION)),
    [reduced]
  );

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
  const picture = artwork.kind === 'default' ? brandMark(resolvedMode) : { uri: artwork.uri };

  // Whether the mirrored frame already shows the picture that will leave: a
  // pack's picture was drawn natively when a launch image is in effect. The
  // compiled launch screen carries no mark, so everything else is crossed to.
  const launchImage = mirror.manifest.launchImage;
  const mirrored = launchImage !== undefined;

  // The brackets and the band have to frame what is actually on screen, which
  // is the native box when native drew it and the composed box otherwise.
  const mirrorWidth = typeof mirror.logo.style.width === 'number' ? mirror.logo.style.width : 0;
  const mirrorHeight = typeof mirror.logo.style.height === 'number' ? mirror.logo.style.height : 0;
  const box =
    mirrored && mirrorWidth > 0 && mirrorHeight > 0
      ? { width: mirrorWidth, height: mirrorHeight }
      : pictureBox;
  const frameBox = {
    width: box.width + BRACKET.inset * 2,
    height: box.height + BRACKET.inset * 2,
  };
  const lockOffset = Math.min(
    LOCK_OFFSET.max,
    Math.max(LOCK_OFFSET.min, box.width * LOCK_OFFSET.fraction)
  );
  // The same file native is drawing, so the displaced copies are the picture
  // rather than a tinted silhouette of it -- which is what keeps the effect
  // legible on a watercolour as well as on a logo.
  const ghostSource = mirrored && launchImage ? { uri: launchImage.uri } : picture;

  const handover = useSharedValue(0);
  const lock = useSharedValue(0);
  const scan = useSharedValue(0);
  const frame = useSharedValue(0);
  const hold = useSharedValue(0);
  const exit = useSharedValue(0);

  // When the handover happened, for the skip gate. A ref rather than state:
  // reading it must not re-render the sheet mid-sequence.
  const startedAt = useRef(0);

  const skip = useCallback(() => {
    if (!canSkipLaunchIntro(Date.now() - startedAt.current, beats)) return;
    onDone();
  }, [beats, onDone]);

  useEffect(() => {
    if (phase === 'visible') {
      startedAt.current = Date.now();
      handover.value = withDelay(DURATION.micro, withTiming(1, timing('long')));
      if (!reduced) {
        lock.value = withTiming(1, timing(beats.lock.ms));
        scan.value = withDelay(beats.scan.at, withTiming(1, timing(beats.scan.ms)));
        frame.value = withDelay(beats.frame.at, withTiming(1, timing(beats.frame.ms)));
      }
      // The hold is what hands back: `ready` in the overlay is this callback.
      // `ReduceMotion.Never` so the beat survives the setting -- it is a wait,
      // not a movement, and collapsing it would snap the app in.
      hold.value = withTiming(
        1,
        timing(beats.holdUntil, { reduceMotion: ReduceMotion.Never }),
        (finished) => {
          if (finished) scheduleOnRN(onDone);
        }
      );
      return;
    }
    if (phase !== 'exiting') return;
    // Likewise a dissolve rather than a cut, at either setting.
    exit.value = withTiming(
      1,
      timing(beats.exit.ms, { reduceMotion: ReduceMotion.Never }),
      (finished) => {
        if (finished) scheduleOnRN(finish);
      }
    );
    // The shared values are stable; only the phase drives this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const sheetStyle = useAnimatedStyle(() => ({
    // Reveal the already mounted home early, then let the picture finish fading.
    opacity: interpolate(exit.value, [0, 0.2, 1], [1, 0.92, 0]),
  }));
  const floorStyle = useAnimatedStyle(() => ({
    opacity: handover.value,
  }));
  // The picture itself never jitters. It is the thing being resolved, so it
  // holds still while its copies converge on it, and only leans forward on the
  // way out -- the same push the app's own route transitions use.
  const artStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(exit.value, [0, 1], [1, NAVIGATION_MOTION.pageScale]) }],
  }));
  // Whatever the mirror drew is gone by the handover's midpoint, so the two
  // read as one thing changing rather than as two things overlaid.
  const outgoingStyle = useAnimatedStyle(() => ({
    opacity: interpolate(handover.value, [0, 0.5], [1, 0], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(handover.value, [0, 0.5], [1, 1.25], Extrapolation.CLAMP) }],
  }));
  const incomingStyle = useAnimatedStyle(() => ({
    opacity: handover.value,
    transform: [
      { translateY: interpolate(handover.value, [0, 1], [6, 0]) },
      { scale: interpolate(handover.value, [0, 0.7, 1], [0.94, 1.025, 1]) },
    ],
  }));

  const ghostLeadStyle = useAnimatedStyle(() => ({
    opacity: interpolate(lock.value, [0, 0.6, 1], [0.5, 0.22, 0], Extrapolation.CLAMP),
    transform: [
      { translateX: interpolate(lock.value, [0, 1], [-lockOffset, 0]) },
      { translateY: interpolate(lock.value, [0, 1], [-2, 0]) },
    ],
  }));
  const ghostTrailStyle = useAnimatedStyle(() => ({
    opacity: interpolate(lock.value, [0, 0.6, 1], [0.5, 0.22, 0], Extrapolation.CLAMP),
    transform: [
      { translateX: interpolate(lock.value, [0, 1], [lockOffset, 0]) },
      { translateY: interpolate(lock.value, [0, 1], [2, 0]) },
    ],
  }));
  const scanStyle = useAnimatedStyle(() => {
    const band = box.height * SCAN_BAND;
    return {
      // Light enough to read through. At full strength the band stops being a
      // beam passing over the picture and becomes a bar hiding it, and the
      // picture is the thing the reader chose.
      opacity:
        interpolate(scan.value, [0, 0.12, 0.85, 1], [0, 0.3, 0.3, 0], Extrapolation.CLAMP) *
        (1 - exit.value),
      // Enters above the picture and leaves below it, so the pass is one
      // uninterrupted travel across the whole box rather than a wipe that
      // appears and disappears inside it.
      transform: [{ translateY: interpolate(scan.value, [0, 1], [-band, box.height]) }],
    };
  });
  // One value for all four brackets: they close together and release together,
  // so the frame reads as a single mechanism rather than four decorations.
  const frameStyle = useAnimatedStyle(() => ({
    opacity: frame.value * (1 - exit.value),
    transform: [
      {
        scale:
          interpolate(frame.value, [0, 1], [1.06, 1]) * interpolate(exit.value, [0, 1], [1, 1.12]),
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
        <Animated.View style={[styles.clip, box, artStyle]}>
          {reduced ? null : (
            <>
              <Animated.View style={[StyleSheet.absoluteFill, ghostLeadStyle]}>
                <Image
                  source={ghostSource}
                  contentFit="contain"
                  cachePolicy="memory"
                  autoplay={false}
                  accessible={false}
                  style={StyleSheet.absoluteFill}
                />
              </Animated.View>
              <Animated.View style={[StyleSheet.absoluteFill, ghostTrailStyle]}>
                <Image
                  source={ghostSource}
                  contentFit="contain"
                  cachePolicy="memory"
                  autoplay={false}
                  accessible={false}
                  style={StyleSheet.absoluteFill}
                />
              </Animated.View>
            </>
          )}

          {mirrored ? (
            <Animated.Image {...mirror.logo} style={StyleSheet.absoluteFill} />
          ) : (
            <>
              {mirror.hasLogo ? (
                <Animated.Image
                  {...mirror.logo}
                  style={[mirror.logo.style, styles.outgoing, outgoingStyle]}
                />
              ) : null}
              <Animated.View style={[StyleSheet.absoluteFill, incomingStyle]}>
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

          {reduced ? null : (
            <Animated.View
              style={[
                styles.scanBand,
                { height: box.height * SCAN_BAND, backgroundColor: theme.colors.primary },
                scanStyle,
              ]}
            />
          )}
        </Animated.View>

        {reduced ? null : (
          <Animated.View style={[styles.frame, frameBox, frameStyle]}>
            <View
              style={[styles.bracket, styles.bracketTopLeft, { borderColor: theme.colors.primary }]}
            />
            <View
              style={[
                styles.bracket,
                styles.bracketTopRight,
                { borderColor: theme.colors.primary },
              ]}
            />
            <View
              style={[
                styles.bracket,
                styles.bracketBottomLeft,
                { borderColor: theme.colors.primary },
              ]}
            />
            <View
              style={[
                styles.bracket,
                styles.bracketBottomRight,
                { borderColor: theme.colors.primary },
              ]}
            />
          </Animated.View>
        )}
      </View>

      {/*
        The skip. Full-bleed and unlabelled on screen: there is nothing here to
        read, so a button would be a second thing to look at during a sequence
        that lasts less than a second and a half. It is a real button to a
        screen reader, and it stops taking touches the moment the sheet starts
        leaving so a tap lands on the app rather than on a dissolving cover.
      */}
      <Pressable
        // Not announced, and not called "Skip intro". That label belongs to the
        // onboarding's own control, which the e2e launch subflow presses when
        // it finds it: a cover that lasts 1.4 s carried the same words, was
        // found by the pre-check and gone by the press, and 20 of 22 flows
        // died at launch. A sequence this short needs no control to be read
        // out -- it is over before a screen reader finishes saying so.
        accessible={false}
        importantForAccessibility="no"
        onPress={skip}
        pointerEvents={phase === 'visible' ? 'auto' : 'none'}
        style={StyleSheet.absoluteFill}
        testID="launch-boot-skip"
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  stage: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  clip: {
    overflow: 'hidden',
  },
  outgoing: {
    position: 'absolute',
  },
  scanBand: {
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  frame: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute',
  },
  bracket: {
    height: BRACKET.arm,
    position: 'absolute',
    width: BRACKET.arm,
  },
  bracketTopLeft: {
    borderLeftWidth: BRACKET.weight,
    borderTopWidth: BRACKET.weight,
    left: 0,
    top: 0,
  },
  bracketTopRight: {
    borderRightWidth: BRACKET.weight,
    borderTopWidth: BRACKET.weight,
    right: 0,
    top: 0,
  },
  bracketBottomLeft: {
    borderBottomWidth: BRACKET.weight,
    borderLeftWidth: BRACKET.weight,
    bottom: 0,
    left: 0,
  },
  bracketBottomRight: {
    borderBottomWidth: BRACKET.weight,
    borderRightWidth: BRACKET.weight,
    bottom: 0,
    right: 0,
  },
});
