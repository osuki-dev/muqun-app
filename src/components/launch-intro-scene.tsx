import type { SplashRenderContext } from '@osuki-dev/react-native-splash';
import { useSplashMirror } from '@osuki-dev/react-native-splash';
import { useThemeMode, useThemeTokens } from '@osuki-dev/ui';
import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { brandMark } from '@/components/brand-mark';
import { useAppliedCustomTheme } from '@/components/theme-candidate';
import { useLaunchBackground, useLaunchHeroArtwork } from '@/hooks/use-launch-artwork';
import { LAUNCH_HERO_MAX_WIDTH, LAUNCH_HERO_WIDTH_FRACTION } from '@/hooks/use-launch-image-sync';
import { subscribeLaunchHeroRect, type LaunchHeroRect } from '@/lib/launch-hero-rect';
import {
  canSkipLaunchIntro,
  launchIntroTimeline,
  reducedLaunchIntroTimeline,
  WIPE_COVERED_AT,
} from '@/lib/launch-intro-timeline';
import { DURATION, RISE_DISTANCE, timing } from '@/lib/motion';
import { THEME_ARTWORK_REGULAR_MIN_WIDTH } from '@/lib/responsive-layout';
import { resolveThemeImage } from '@/theme/resolve';

/**
 * The launch every run after the first: the theme's world opens, and the app
 * is already standing in it.
 *
 * ## What this is trying to be
 *
 * A Muqun theme pack is not a colour scheme with a logo. It is a *place*: a
 * full-bleed painting behind the whole shell, a hero illustration at the top of
 * Home, chrome tinted to match, and a palette drawn from all of it. The launch
 * that shipped before this one framed the pack's hero on an empty page with a
 * scan line and four corner brackets, and the note it earned was exactly right
 * -- it read as a logo being presented, which is what a launch screen looks
 * like when it has been designed for an app that has one mark. This app has
 * fifty-one worlds and the reader picked one of them.
 *
 * So nothing here decorates a picture. The opening is the pack's world
 * arriving, in three beats that overlap into one:
 *
 * 1. **The cut.** One plane in the pack's own `primary` crosses the screen on
 *    the diagonal, bright edge leading. The launch frame is behind it going in;
 *    the pack's full-bleed wallpaper is behind it coming out. An anime-register
 *    colour wipe, which is the one move that can change everything on screen at
 *    once without dissolving -- and a dissolve between two paintings is mush.
 * 2. **The hero lands.** The pack's illustration is already on screen, large
 *    and centred, because that is what the OS drew. It travels and settles into
 *    the exact rectangle Home keeps it in, so the picture the reader is looking
 *    at *becomes* the picture at the top of Home rather than being replaced by
 *    it.
 * 3. **The page rises.** The veil over the rest of the screen drops away and
 *    Home is underneath, already composed.
 *
 * By the hold, this sheet and Home are drawing the same wallpaper with the same
 * picture in the same place. The exit is a cross-fade between two identical
 * compositions, which is to say it is invisible: the cover does not transition
 * to Home, it stops existing.
 *
 * ## Where every pixel comes from
 *
 * Nothing is hard-coded and nothing is the app's own taste:
 *
 * - the wallpaper is `home.background` falling back to `shell.background`, the
 *   same pair and the same `ThemeArtworkLayer` Home draws;
 * - the picture is `useLaunchHeroArtwork()` -- `home.hero`, then the pack's
 *   empty-state illustration, then its Home logo, then the bundled mascot;
 * - the paper under both is the pack's `colors.background`;
 * - the cut is `colors.primary` with `colors.surface` on its leading edge.
 *
 * Swap the pack and every one of those changes together. A pack that ships no
 * wallpaper is not a broken launch but a different one -- see `PaletteStage`.
 *
 * All of it reads the **applied** theme, never the effective one: `ThemeArtwork`
 * itself is candidate-aware and this surface must not be, or a launch would
 * wear whichever theme was last previewed in the picker -- a decision the
 * reader never made.
 *
 * ## Landing rectangle
 *
 * Home measures its hero band and publishes it (`publishLaunchHeroRect`). The
 * overlay cannot compute that rectangle: it is a measured header, plus a brand
 * block some packs hide, plus a banner slot. When Home has not reported one --
 * no servers paired yet, the hero switched off, the lock gate up, a
 * notification deep-linking past Home -- there is nothing to land in, and the
 * hero simply holds where it is and cross-fades. That is the documented
 * fallback, not a failure.
 *
 * Timing is entirely `launch-intro-timeline.ts`'s, which is where it can be
 * tested; this file is the drawing.
 */

/** The cut's angle. Off-vertical enough to read as a slash, not so far it reads as a swipe. */
const CUT_ROTATION = '-18deg';

/** The bright leading edge of the cut, in points. */
const CUT_EDGE = 10;

/** How far the plane creeps while it waits for the painting, in wipe progress. */
const WIPE_STALL_DRIFT = 0.08;

/** How far past its final size the hero starts, when Home never reported a rect. */
const HERO_FALLBACK_SCALE = 1.08;

export function LaunchSceneIntro({
  phase,
  finish,
  onDone,
}: SplashRenderContext & { onDone: () => void }) {
  const mirror = useSplashMirror();
  const artwork = useLaunchHeroArtwork();
  const packBackground = useLaunchBackground();
  const { theme: pack, assets } = useAppliedCustomTheme();
  const theme = useThemeTokens();
  const { resolvedMode } = useThemeMode();
  const { width, height } = useWindowDimensions();
  const reduced = useReducedMotion();

  const beats = useMemo(
    () => (reduced ? reducedLaunchIntroTimeline(DURATION) : launchIntroTimeline(DURATION)),
    [reduced]
  );

  // Where Home keeps its picture. Subscribed rather than read once: Home is
  // mounting underneath this sheet at the same time, and may measure before or
  // after the opening starts.
  const [homeRect, setHomeRect] = useState<LaunchHeroRect | null>(null);
  useEffect(() => subscribeLaunchHeroRect(setHomeRect), []);

  const picture = artwork.kind === 'default' ? brandMark(resolvedMode) : { uri: artwork.uri };

  // The picture's box on the launch screen the OS drew, which is where this
  // sheet's first frame has to agree with native to the pixel.
  const launchBox = Math.min(width * LAUNCH_HERO_WIDTH_FRACTION, LAUNCH_HERO_MAX_WIDTH);
  const launchRect = {
    x: (width - launchBox) / 2,
    y: (height - launchBox) / 2,
    width: launchBox,
    height: launchBox,
  };

  // The hero is drawn once, in its landing geometry, and transformed from the
  // launch rect into it -- rather than drawn twice and cross-faded. One picture
  // that moves is a picture that *became* the other one; two that dissolve are
  // two pictures.
  //
  // With no rect from Home the picture stays exactly where the OS put it and
  // settles by a hair. The alternative -- inventing a band and flying to it --
  // would land the hero on top of whatever Home actually drew.
  const landing = homeRect ?? launchRect;
  const fromScale = homeRect
    ? Math.max(launchRect.width / landing.width, launchRect.height / landing.height)
    : HERO_FALLBACK_SCALE;
  const fromX = launchRect.x + launchRect.width / 2 - (landing.x + landing.width / 2);
  const fromY = launchRect.y + launchRect.height / 2 - (landing.y + landing.height / 2);

  // The cut has to cover a rotated screen, so it is sized on the diagonal.
  const cutSpan = Math.ceil(Math.hypot(width, height)) * 1.25;

  // Whether this pack actually painted a world, rather than merely being
  // applied. `ThemeArtworkLayer` draws nothing for a slot a pack left out, so
  // without this the palette-only packs would open onto bare paper.
  const wallpaper =
    pack && assets
      ? resolveThemeImage(
          pack.manifest,
          'home.background',
          resolvedMode,
          width >= THEME_ARTWORK_REGULAR_MIN_WIDTH ? 'regular' : 'compact',
          true,
          'shell.background'
        )
      : null;
  const wallpaperUri = wallpaper ? assets?.[wallpaper.asset] : undefined;
  const hasWallpaper = Boolean(wallpaperUri?.startsWith('file:///'));

  // Whether the painting is actually on the GPU yet. A pack with no wallpaper
  // has nothing to wait for and is ready by definition.
  const [worldReady, setWorldReady] = useState(!hasWallpaper);
  const onWorldReady = useCallback(() => setWorldReady(true), []);

  const wipe = useSharedValue(0);
  const hero = useSharedValue(0);
  const rise = useSharedValue(0);
  const hold = useSharedValue(0);
  const exit = useSharedValue(0);

  // When the handover happened, for the skip gate. A ref rather than state:
  // reading it must not re-render the sheet mid-sequence.
  const startedAt = useRef(0);

  const skip = useCallback(() => {
    if (!canSkipLaunchIntro(Date.now() - startedAt.current, beats)) return;
    onDone();
  }, [beats, onDone]);

  const coverMs = beats.wipe.ms * WIPE_COVERED_AT;
  const clearMs = beats.wipe.ms - coverMs;

  // The cut clears once the world behind it exists, or once the stall cap says
  // to stop waiting. Separate from the beat effect below because it is the one
  // thing here driven by something other than the phase.
  useEffect(() => {
    if (phase !== 'visible' || reduced || !worldReady) return;
    const elapsed = Date.now() - startedAt.current;
    const remaining = Math.max(0, coverMs - elapsed);
    // Already covering: just clear, from wherever the drift has reached.
    // Otherwise finish the crossing first, at the speed it was going, and
    // clear straight after. Never a delay -- a delay freezes the plane.
    wipe.value =
      remaining > 0
        ? withSequence(
            withTiming(WIPE_COVERED_AT, timing(remaining)),
            withTiming(1, timing(clearMs))
          )
        : withTiming(1, timing(clearMs));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, worldReady, reduced]);

  useEffect(() => {
    if (phase === 'visible') {
      startedAt.current = Date.now();
      if (!reduced) {
        // Cover, wait for the world up to the cap, then clear regardless.
        wipe.value = withSequence(
          withTiming(WIPE_COVERED_AT, timing(coverMs)),
          // Waiting, but never parked: the plane keeps creeping across while
          // the painting decodes, because a plane holding perfectly still for
          // half a second stops reading as a wipe and starts reading as a
          // colour card the launch got stuck on.
          withTiming(WIPE_COVERED_AT + WIPE_STALL_DRIFT, timing(beats.wipeStallCapMs)),
          withTiming(1, timing(clearMs))
        );
        hero.value = withDelay(beats.hero.at, withTiming(1, timing(beats.hero.ms)));
        rise.value = withDelay(beats.rise.at, withTiming(1, timing(beats.rise.ms)));
      } else {
        // Nothing travels, but the composition still has to be the finished one
        // so the cross-fade lands on Home rather than on a half-built stage.
        wipe.value = 1;
        hero.value = 1;
        rise.value = 1;
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
    opacity: interpolate(exit.value, [0, 1], [1, 0]),
  }));
  // The launch frame the OS drew. It is exchanged for the pack's world on the
  // frame the cut has the screen covered, so the swap itself is never seen.
  const mirrorStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      wipe.value,
      [0, WIPE_COVERED_AT, WIPE_COVERED_AT + 0.01, 1],
      [1, 1, 0, 0],
      Extrapolation.CLAMP
    ),
  }));
  const worldStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      wipe.value,
      [0, WIPE_COVERED_AT, WIPE_COVERED_AT + 0.01, 1],
      [0, 0, 1, 1],
      Extrapolation.CLAMP
    ),
  }));
  // One plane, one crossing: in from the lower left, out past the upper right.
  const cutStyle = useAnimatedStyle(() => ({
    opacity: interpolate(wipe.value, [0, 0.02, 0.98, 1], [0, 1, 1, 0], Extrapolation.CLAMP),
    transform: [
      { rotate: CUT_ROTATION },
      { translateX: interpolate(wipe.value, [0, WIPE_COVERED_AT, 1], [-cutSpan, 0, cutSpan]) },
    ],
  }));
  // The picture travels from where the OS had it to where Home keeps it.
  const heroStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      wipe.value,
      [0, WIPE_COVERED_AT, WIPE_COVERED_AT + 0.01, 1],
      [0, 0, 1, 1],
      Extrapolation.CLAMP
    ),
    transform: [
      { translateX: interpolate(hero.value, [0, 1], [fromX, 0]) },
      { translateY: interpolate(hero.value, [0, 1], [fromY, 0]) },
      { scale: interpolate(hero.value, [0, 1], [fromScale, 1]) },
    ],
  }));
  // The veil over everything that is not the picture: Home's own content is
  // already composed underneath it, so lifting it reads as the page arriving.
  const riseStyle = useAnimatedStyle(() => ({
    opacity: interpolate(rise.value, [0, 1], [1, 0], Extrapolation.CLAMP),
    transform: [{ translateY: interpolate(rise.value, [0, 1], [0, RISE_DISTANCE]) }],
  }));

  return (
    <Animated.View style={[mirror.container.style, sheetStyle]}>
      {/* The paper, which is the pack's own and is under everything. */}
      {packBackground ? (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: packBackground }]}
        />
      ) : null}

      {/* The world: the pack's wallpaper, exactly as Home draws it. */}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, worldStyle]}>
        {hasWallpaper && wallpaper && wallpaperUri ? (
          // Drawn here rather than through `ThemeArtworkLayer` for one reason:
          // the cut needs to know when the painting is ready, and the shared
          // component has no way to say. Same slot pair, same fit, same focal
          // point, same opacity -- so what lands is what Home draws.
          <Image
            accessible={false}
            autoplay={false}
            cachePolicy="memory"
            contentFit={wallpaper.fit === 'tile' ? 'contain' : (wallpaper.fit ?? 'cover')}
            contentPosition={
              wallpaper.focalPoint
                ? {
                    left: `${wallpaper.focalPoint.x * 100}%`,
                    top: `${wallpaper.focalPoint.y * 100}%`,
                  }
                : 'center'
            }
            onError={onWorldReady}
            onLoad={onWorldReady}
            source={{ uri: wallpaperUri }}
            style={[StyleSheet.absoluteFill, { opacity: wallpaper.opacity ?? 1 }]}
          />
        ) : null}
        <PaletteStage
          background={theme.colors.background}
          hasWallpaper={hasWallpaper}
          height={height}
          primary={theme.colors.primary}
          surface={theme.colors.surface}
          width={width}
        />
      </Animated.View>

      {/* The veil, which Home rises out from under. */}
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: packBackground ?? theme.colors.background },
          riseStyle,
        ]}
      />

      {/*
        The launch frame the OS drew, handed over pixel for pixel. Only when
        native actually drew a picture: with no launch image the compiled
        launch screen is paper alone, and painting one here would be this sheet
        adding something the frame before it did not have.
      */}
      {mirror.hasLogo ? (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, mirrorStyle]}>
          <View style={styles.centre}>
            <Animated.Image {...mirror.logo} style={mirror.logo.style} />
          </View>
        </Animated.View>
      ) : null}

      {/* The picture, drawn in Home's geometry and flown into it. */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.hero,
          { left: landing.x, top: landing.y, width: landing.width, height: landing.height },
          heroStyle,
        ]}>
        <Image
          accessible={false}
          autoplay={false}
          cachePolicy="memory"
          contentFit="contain"
          source={picture}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      {/* The cut. */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.cut,
          {
            backgroundColor: theme.colors.primary,
            borderLeftColor: theme.colors.surface,
            borderLeftWidth: CUT_EDGE,
            height: cutSpan,
            left: width / 2 - cutSpan / 2,
            top: height / 2 - cutSpan / 2,
            width: cutSpan,
          },
          cutStyle,
        ]}
      />

      {/*
        The skip. Full-bleed and unlabelled: there is nothing here to read, so
        a button would be a second thing to look at during a sequence that
        lasts less than a second and a half.

        Not announced, and deliberately not called "Skip intro". Those words
        belong to the onboarding's own control, which the e2e launch subflow
        presses whenever it finds them: the previous cover carried the same
        label, was found by the pre-check and was gone by the time of the
        press, and 20 of 22 flows died at launch. An opening this short needs
        no control read out -- it is over before a screen reader finishes
        saying so.

        It stops taking touches the moment the sheet starts leaving, so a tap
        lands on the app rather than on a dissolving cover.
      */}
      <Pressable
        accessible={false}
        importantForAccessibility="no"
        onPress={skip}
        pointerEvents={phase === 'visible' ? 'auto' : 'none'}
        style={StyleSheet.absoluteFill}
        testID="launch-scene-skip"
      />
    </Animated.View>
  );
}

/**
 * What a pack without a wallpaper opens into.
 *
 * Roughly a fifth of the collection is a palette and nothing else, and every
 * built-in pack is. Falling back to a flat fill would make those launches look
 * like the picture failed to load, so the pack's own three planes -- ground,
 * surface, primary -- are composed on the same diagonal the cut travels on.
 * It is the pack's colours arranged rather than the pack's colours absent, and
 * it costs three `View`s.
 *
 * Drawn under the wallpaper rather than instead of it, so a pack that has both
 * simply covers it.
 */
function PaletteStage({
  background,
  hasWallpaper,
  height,
  primary,
  surface,
  width,
}: {
  background: string;
  hasWallpaper: boolean;
  height: number;
  primary: string;
  surface: string;
  width: number;
}) {
  if (hasWallpaper) return null;
  const span = Math.ceil(Math.hypot(width, height)) * 1.3;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: background }]}>
      <View
        style={[
          styles.plane,
          {
            backgroundColor: surface,
            height: span,
            left: width / 2 - span / 2,
            top: height * 0.34,
            width: span,
          },
        ]}
      />
      <View
        style={[
          styles.plane,
          {
            backgroundColor: primary,
            height: span,
            left: width / 2 - span / 2,
            opacity: 0.16,
            top: height * 0.62,
            width: span,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  centre: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  launchBox: {
    alignSelf: 'center',
  },
  hero: {
    position: 'absolute',
  },
  cut: {
    position: 'absolute',
  },
  plane: {
    position: 'absolute',
    transform: [{ rotate: CUT_ROTATION }],
  },
});
