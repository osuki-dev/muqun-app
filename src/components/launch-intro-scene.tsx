import type { SplashRenderContext } from '@osuki-dev/react-native-splash';
import { useSplashMirror } from '@osuki-dev/react-native-splash';
import { useThemeMode, useThemeTokens } from '@osuki-dev/ui';
import {
  Canvas,
  ColorShader,
  Fill,
  ImageShader,
  Shader,
  Skia,
  useClock,
  useImage,
} from '@shopify/react-native-skia';
import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  ReduceMotion,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { useAppliedCustomTheme } from '@/components/theme-candidate';
import { useLaunchBackground } from '@/hooks/use-launch-artwork';
import { LAUNCH_HERO_MAX_WIDTH, LAUNCH_HERO_WIDTH_FRACTION } from '@/hooks/use-launch-image-sync';
import { useThemePack } from '@/hooks/use-theme-pack';
import { useMarkdownFonts } from '@/hooks/use-user-fonts';
import {
  BLOOM_CHROMA,
  BLOOM_GLOW_IN,
  BLOOM_GLOW_OUT,
  BLOOM_MODE,
  BLOOM_RIM_WIDTH,
  BLOOM_WOBBLE,
  LAUNCH_BLOOM_EFFECT,
} from '@/lib/launch-bloom-shader';
import { subscribeLaunchHeroRect, type LaunchHeroRect } from '@/lib/launch-hero-rect';
import {
  characterOpacity,
  cursorOpacity,
  launchPromptLine,
  scrimWidth,
  typedCount,
} from '@/lib/launch-intro-prompt';
import {
  BLOOM_OVERSHOOT,
  canSkipLaunchIntro,
  launchIntroTimeline,
  reducedLaunchIntroTimeline,
  WORLD_ARRIVAL_ZOOM,
} from '@/lib/launch-intro-timeline';
import { bloomRadius, chooseLaunchWorld, worldFit } from '@/lib/launch-intro-world';
import { DURATION, RISE_DISTANCE, timing } from '@/lib/motion';
import { THEME_ARTWORK_REGULAR_MIN_WIDTH } from '@/lib/responsive-layout';
import { resolveThemeImage } from '@/theme/resolve';

/**
 * The launch every run after the first: the theme's world opens out of its own
 * picture, and the app is already standing in it.
 *
 * ## What this is trying to be
 *
 * A Muqun theme pack is not a colour scheme with a logo. It is a *place*: a
 * full-bleed painting behind the whole shell, a hero illustration at the top of
 * Home, chrome tinted to match, and a palette drawn from all of it. Two earlier
 * launches missed that in opposite directions -- one framed the pack's hero on
 * an empty page with a scan line, which read as a logo being presented; the
 * other swept a plane in the pack's `primary` across the screen and held it,
 * which covered the artwork it existed to open with a third of a second of flat
 * colour. Both were a launch screen designed for an app with one mark. This app
 * has fifty-one worlds and the reader picked one of them.
 *
 * So the rule this one is built on is that **nothing ever covers the artwork**.
 * The hero is on screen in the first frame -- it is literally the frame the OS
 * drew, handed over by `useSplashMirror` -- and it is on screen in the last.
 * Everything that happens, happens *around* it:
 *
 * 1. **The rim wakes.** A thin line in the pack's `primary` closes around the
 *    picture. It is the only thing that moves for a sixth of a second, and it
 *    is attached to the picture, so what comes next has somewhere to come from.
 * 2. **The world blooms.** A front spreads from the hero's centre to past the
 *    far corner, and behind it is the pack's wallpaper. The front is not a
 *    circle: its radius is displaced by noise, so it reads as ink soaking
 *    outward. The edge carries a bank of `primary`, a thin bright rim in the
 *    pack's lightest tone, and a two-pixel chromatic split. The wallpaper
 *    arrives a touch zoomed and settles, so the world has depth as it comes.
 * 3. **The hero travels.** It lifts out of the middle of the launch frame into
 *    the exact band Home keeps it in, with two ghost copies trailing a beat
 *    behind it at falling opacity -- an anime-register smear, not a particle.
 * 4. **The prompt types.** In the lower third, a monospace line spells out the
 *    pack's name behind a block cursor. It is the one element that could only
 *    belong to a terminal app, and it is deliberately small.
 *
 * By the hold, this sheet and Home are drawing the same wallpaper with the same
 * picture in the same place, so the exit is a cross-fade between two identical
 * compositions -- which is to say it is invisible. The cover does not transition
 * to Home; it stops existing, and the first thing the reader notices is Home's
 * cards rising through where the prompt was.
 *
 * ## Where every pixel comes from
 *
 * Nothing is hard-coded and nothing is the app's own taste:
 *
 * - the wallpaper is `home.background` falling back to `shell.background`, the
 *   same pair and the same fit `ThemeArtworkLayer` gives Home;
 * - the picture is whatever the native launch screen drew, which
 *   `use-launch-image-sync` already set to the pack's `home.hero`;
 * - the paper under both is the pack's `colors.background`;
 * - the front's bank is `colors.primary` and its rim is `colors.surface`;
 * - the prompt is the pack's `text` and `primary`, in the reader's own
 *   monospace face when they have set one.
 *
 * Swap the pack and every one of those changes together. A pack that ships no
 * wallpaper is not a broken launch but a different one -- the same front
 * reveals a field built from the pack's own three tones.
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
 * notification deep-linking past Home -- there is nothing to land in, so the
 * hero holds where it is and the opening ends on a cross-fade. That is the
 * documented fallback, not a failure; the world still blooms, because the world
 * arriving is true of every first screen.
 *
 * Timing is entirely `launch-intro-timeline.ts`'s, the reveal's fallbacks are
 * `launch-intro-world.ts`'s and the prompt's schedule is
 * `launch-intro-prompt.ts`'s -- which is where all three can be tested. This
 * file is the drawing.
 */

/** The two trailing copies of the hero, as a fraction of the travel they lag by. */
const GHOST_LAG = [0.1, 0.19] as const;

/** And how solid each is at its most visible. Falling, so the trail has a direction. */
const GHOST_OPACITY = [0.26, 0.12] as const;

/** Where the front rests before it takes off, as a fraction of the picture's box. */
const REST_RADIUS_FRACTION = 0.54;

/** How far the resting ring swells and shrinks while it waits for the painting. */
const BREATH = { low: 0.0, high: 0.055 } as const;

/** The prompt's baseline, as a fraction of the screen's height up from the bottom. */
const PROMPT_BOTTOM_FRACTION = 0.17;

/** The prompt's type size, and the floor it will shrink to for a long pack name. */
const PROMPT_SIZE = { max: 15, min: 10 } as const;

/** A monospace advance as a fraction of the type size, until the line is measured. */
const MONO_ADVANCE = 0.6;

/** The scrim's padding around the line, in points. */
const PROMPT_SCRIM_PADDING = 10;

/** How opaque the scrim under the line is. Enough to read on a painting, not a plate. */
const PROMPT_SCRIM_OPACITY = 0.44;

/** The block cursor's height, as a fraction of the type size. */
const CURSOR_HEIGHT = 1.18;

/** The iris fallback's lit edge, in points. Wider than the shader's, having no glow. */
const IRIS_RIM = 2;

const FALLBACK_MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

/** A colour string as the four floats a uniform wants. Skia owns the parsing. */
function colorVector(color: string): number[] {
  try {
    return Array.from(Skia.Color(color));
  } catch {
    return [0, 0, 0, 1];
  }
}

/** A style dimension that is actually a number, or the fallback. */
function points(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

export function LaunchSceneIntro({
  phase,
  finish,
  onDone,
}: SplashRenderContext & { onDone: () => void }) {
  const mirror = useSplashMirror();
  const packBackground = useLaunchBackground();
  const { theme: pack, assets } = useAppliedCustomTheme();
  const theme = useThemeTokens();
  const { resolvedMode } = useThemeMode();
  const { width, height } = useWindowDimensions();
  const reduced = useReducedMotion();
  const fonts = useMarkdownFonts();
  const packLabel = useThemePack().label;

  const beats = useMemo(
    () => (reduced ? reducedLaunchIntroTimeline(DURATION) : launchIntroTimeline(DURATION)),
    [reduced]
  );

  // Where Home keeps its picture. Subscribed rather than read once: Home is
  // mounting underneath this sheet at the same time, and may measure before or
  // after the opening starts.
  const [homeRect, setHomeRect] = useState<LaunchHeroRect | null>(null);
  useEffect(() => subscribeLaunchHeroRect(setHomeRect), []);

  // The picture's box on the launch screen the OS drew. The mirror centres it
  // in the window, so this is a size rather than a rectangle.
  const launchBox = Math.min(
    points(mirror.logo.style.width, width * LAUNCH_HERO_WIDTH_FRACTION),
    points(mirror.logo.style.height, LAUNCH_HERO_MAX_WIDTH)
  );
  const launchCentre = { x: width / 2, y: height / 2 };
  const landingCentre = homeRect
    ? { x: homeRect.x + homeRect.width / 2, y: homeRect.y + homeRect.height / 2 }
    : launchCentre;
  // Both the launch frame and Home draw the picture with `contain`, so the
  // scale between them is the smaller side of the band over the launch box.
  const landingScale = homeRect ? Math.min(homeRect.width, homeRect.height) / launchBox : 1;

  const paper = packBackground ?? mirror.backgroundColor ?? theme.colors.background;
  const widthClass = width >= THEME_ARTWORK_REGULAR_MIN_WIDTH ? 'regular' : 'compact';

  // The pack's own world, resolved exactly the way Home resolves it, so what
  // blooms here is what is underneath when the sheet goes.
  const wallpaper =
    pack && assets
      ? resolveThemeImage(
          pack.manifest,
          'home.background',
          resolvedMode,
          widthClass,
          true,
          'shell.background'
        )
      : null;
  const wallpaperUri = wallpaper ? assets?.[wallpaper.asset] : undefined;
  const hasArtwork = Boolean(wallpaperUri?.startsWith('file:///'));

  // Skia's own decode. `useImage` takes the same `file:///` path `HomeHero`
  // gives it, and hands back the decoded `SkImage` a commit later.
  const skiaSource = hasArtwork && LAUNCH_BLOOM_EFFECT ? wallpaperUri : undefined;
  const image = useImage(skiaSource);

  // The front will not wait past the budget. Armed on the handover rather than
  // on mount, because the handover is when the reader starts counting.
  const [deadlinePassed, setDeadlinePassed] = useState(false);
  useEffect(() => {
    if (phase !== 'visible' || reduced || !hasArtwork) return;
    const timer = setTimeout(() => setDeadlinePassed(true), beats.worldDeadlineAt);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, hasArtwork, reduced]);

  const world = chooseLaunchWorld({
    hasArtwork,
    shaderCompiled: LAUNCH_BLOOM_EFFECT !== null,
    imageReady: image !== null,
    deadlinePassed,
  });

  // How the painting sits on this screen. Unchanging for the whole opening, so
  // it is computed here rather than per frame in the worklet.
  const fit = useMemo(
    () =>
      worldFit(
        { width, height },
        { width: image?.width() ?? 1, height: image?.height() ?? 1 },
        wallpaper?.fit,
        wallpaper?.focalPoint
      ),
    [width, height, image, wallpaper?.fit, wallpaper?.focalPoint]
  );

  // The far corner from wherever the hero is, taken over both ends of its
  // travel: the front has to have covered the screen at the end of the beat no
  // matter which centre it was measured from.
  const maxRadius = Math.max(
    bloomRadius({ width, height }, launchCentre),
    bloomRadius({ width, height }, landingCentre)
  );
  const restRadius = launchBox * REST_RADIUS_FRACTION;

  const line = launchPromptLine(packLabel);
  const characters = useMemo(() => Array.from(line), [line]);
  const promptSize = Math.max(
    PROMPT_SIZE.min,
    Math.min(PROMPT_SIZE.max, (width - 80) / Math.max(1, characters.length * MONO_ADVANCE))
  );
  // Measured rather than assumed: the advance of the reader's own face is not
  // the advance of the platform's, and the cursor sits on a multiple of it.
  const [lineWidth, setLineWidth] = useState(0);
  const onLineLayout = useCallback((event: LayoutChangeEvent) => {
    const measured = event.nativeEvent.layout.width;
    setLineWidth((previous) => (previous === measured ? previous : measured));
  }, []);
  const characterWidth =
    lineWidth > 0 ? lineWidth / Math.max(1, characters.length) : promptSize * MONO_ADVANCE;
  const scrimFullWidth = characterWidth * characters.length + PROMPT_SCRIM_PADDING * 2;

  const ignite = useSharedValue(0);
  const bloom = useSharedValue(0);
  const settle = useSharedValue(0);
  const hero = useSharedValue(0);
  const type = useSharedValue(0);
  const blink = useSharedValue(0);
  const hold = useSharedValue(0);
  const exit = useSharedValue(0);
  const clock = useClock();

  // When the handover happened, for the skip gate. A ref rather than state:
  // reading it must not re-render the sheet mid-sequence.
  const startedAt = useRef(0);

  const skip = useCallback(() => {
    if (!canSkipLaunchIntro(Date.now() - startedAt.current, beats)) return;
    onDone();
  }, [beats, onDone]);

  // Whether the front has something to reveal. A palette pack, an iris and the
  // plain fallback all have it from the first frame; only a painting can be
  // late, and only a painting makes the front wait.
  const revealReady = world.kind !== 'painted' || world.ready;

  useEffect(() => {
    if (phase === 'visible') {
      startedAt.current = Date.now();
      if (reduced) {
        // Nothing travels, but the composition still has to be the finished one
        // so the cross-fade lands on Home rather than on a half-built stage.
        ignite.value = 1;
        bloom.value = 1;
        settle.value = 1;
        hero.value = 1;
        type.value = 1;
        blink.value = 1;
      } else {
        ignite.value = withTiming(1, timing(beats.ignite.ms));
        hero.value = withDelay(beats.hero.at, withTiming(1, timing(beats.hero.ms)));
        type.value = withDelay(beats.type.at, withTiming(1, timing(beats.type.ms)));
        blink.value = withDelay(beats.blink.at, withTiming(1, timing(beats.blink.ms)));
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

  // The bloom is the one beat driven by something other than the clock: it
  // leaves when the world behind it exists. Until then it breathes in place,
  // which is a front waiting rather than a launch that has hung.
  useEffect(() => {
    if (phase !== 'visible' || reduced) return;
    if (!revealReady) {
      bloom.value = withRepeat(
        withSequence(
          withTiming(BREATH.high, timing('short')),
          withTiming(BREATH.low, timing('short'))
        ),
        -1,
        true
      );
      return;
    }
    const elapsed = Date.now() - startedAt.current;
    const delay = Math.max(0, beats.bloom.at - elapsed);
    const remaining = Math.max(
      DURATION.short,
      beats.bloom.at + beats.bloom.ms - Math.max(elapsed, beats.bloom.at)
    );
    bloom.value = withDelay(delay, withTiming(1, timing(remaining)));
    settle.value = withDelay(delay, withTiming(1, timing(beats.settle.ms)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, revealReady, reduced]);

  const paperVector = useMemo(() => colorVector(paper), [paper]);
  const primaryVector = useMemo(() => colorVector(theme.colors.primary), [theme.colors.primary]);
  const rimVector = useMemo(() => colorVector(theme.colors.surface), [theme.colors.surface]);
  const mode =
    world.kind === 'palette'
      ? BLOOM_MODE.palette
      : world.kind === 'painted' && world.ready
        ? BLOOM_MODE.painted
        : BLOOM_MODE.waiting;
  const worldAlpha = wallpaper?.opacity ?? 1;
  const fitScale = fit.scale;
  const fitX = fit.x;
  const fitY = fit.y;

  // Every uniform, once per frame, on the UI thread. JavaScript does nothing
  // here at all: the shared values below are the only things that change.
  const uniforms = useDerivedValue(() => ({
    uResolution: [width, height],
    uCentre: [
      launchCentre.x + (landingCentre.x - launchCentre.x) * hero.value,
      launchCentre.y + (landingCentre.y - launchCentre.y) * hero.value,
    ],
    uWorldOrigin: [fitX, fitY],
    uWorldScale: fitScale,
    uZoom: WORLD_ARRIVAL_ZOOM + (1 - WORLD_ARRIVAL_ZOOM) * settle.value,
    uFront: restRadius + (maxRadius * BLOOM_OVERSHOOT - restRadius) * bloom.value,
    uWobble: BLOOM_WOBBLE,
    uTime: clock.value / 1000,
    uRimWidth: BLOOM_RIM_WIDTH,
    uGlowIn: BLOOM_GLOW_IN,
    uGlowOut: BLOOM_GLOW_OUT,
    uChroma: BLOOM_CHROMA * ignite.value,
    uMode: mode,
    uWorldAlpha: worldAlpha,
    uDrift: 1 - settle.value,
    uPaper: paperVector,
    uPrimary: primaryVector,
    uRimColor: [rimVector[0] ?? 1, rimVector[1] ?? 1, rimVector[2] ?? 1, ignite.value],
    uSurface: rimVector,
  }));

  const sheetStyle = useAnimatedStyle(() => ({ opacity: 1 - exit.value }));
  const heroStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: (landingCentre.x - launchCentre.x) * hero.value },
      { translateY: (landingCentre.y - launchCentre.y) * hero.value },
      { scale: 1 + (landingScale - 1) * hero.value },
    ],
  }));

  const showCanvas = world.kind === 'painted' || world.kind === 'palette';

  return (
    <Animated.View style={[mirror.container.style, sheetStyle]}>
      {/* The paper, which is the pack's own and is under everything. */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: paper }]} />

      {showCanvas && LAUNCH_BLOOM_EFFECT ? (
        // Opaque on purpose: the shader paints the paper outside the front
        // itself, so there is nothing for the compositor to blend and the
        // surface can be promoted. `androidWarmup` pays the context cost while
        // the native splash is still up rather than on the first drawn frame.
        <Canvas androidWarmup opaque style={StyleSheet.absoluteFill}>
          <Fill>
            <Shader source={LAUNCH_BLOOM_EFFECT} uniforms={uniforms}>
              {image ? (
                // No rect and no fit, so the local matrix is identity and the
                // shader samples the painting in its own pixels -- which is
                // what `worldFit`'s scale and origin are expressed in.
                <ImageShader image={image} />
              ) : (
                <ColorShader color={paper} />
              )}
            </Shader>
          </Fill>
        </Canvas>
      ) : null}

      {world.kind === 'iris' && wallpaperUri ? (
        <IrisReveal
          bloom={bloom}
          settle={settle}
          centre={launchCentre}
          radius={maxRadius * BLOOM_OVERSHOOT}
          restRadius={restRadius}
          rimColor={theme.colors.primary}
          screen={{ width, height }}
          source={wallpaperUri}
          fit={wallpaper?.fit}
          focalPoint={wallpaper?.focalPoint}
          opacity={worldAlpha}
        />
      ) : null}

      <LaunchPrompt
        blink={blink}
        bottom={height * PROMPT_BOTTOM_FRACTION}
        characters={characters}
        characterWidth={characterWidth}
        exit={exit}
        fontFamily={fonts.mono ?? FALLBACK_MONO}
        fontSize={promptSize}
        onLineLayout={onLineLayout}
        scrimColor={paper}
        scrimFullWidth={scrimFullWidth}
        sigilColor={theme.colors.primary}
        textColor={theme.colors.text}
        type={type}
      />

      {/*
        The picture, exactly as native drew it, travelling into Home's band --
        and two ghosts a beat behind it. Each is a full-bleed centring view
        rather than a positioned image, so the transform's origin is the same
        point the mirror centres on and the first frame is native's to the
        pixel. Only when native actually drew a picture: with no launch image
        the compiled launch screen is paper alone, and painting one here would
        be this sheet adding something the frame before it did not have.
      */}
      {mirror.hasLogo ? (
        <>
          {GHOST_LAG.map((lag, index) => (
            <HeroGhost
              key={lag}
              hero={hero}
              lag={lag}
              landingCentre={landingCentre}
              landingScale={landingScale}
              launchCentre={launchCentre}
              logo={mirror.logo}
              peak={GHOST_OPACITY[index] ?? 0}
            />
          ))}
          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, styles.centre, heroStyle]}>
            <Animated.Image {...mirror.logo} style={mirror.logo.style} />
          </Animated.View>
        </>
      ) : null}

      {/*
        The skip. Full-bleed and unlabelled: there is nothing here to read, so
        a button would be a second thing to look at during a sequence that
        lasts less than a second and a half.

        Not announced, and deliberately not called "Skip intro". Those words
        belong to the onboarding's own control, which the e2e launch subflow
        presses whenever it finds them: an earlier cover carried the same
        label, was found by the pre-check and was gone by the time of the
        press, and 20 of 22 flows died at launch.

        It is unmounted the moment the sheet starts leaving, rather than
        merely having its `pointerEvents` turned off, so a tap during the exit
        lands on the app rather than on a dissolving cover.
      */}
      {phase === 'visible' ? (
        <Pressable
          accessible={false}
          importantForAccessibility="no"
          onPress={skip}
          style={StyleSheet.absoluteFill}
          testID="launch-scene-skip"
        />
      ) : null}
    </Animated.View>
  );
}

/**
 * One trailing copy of the hero, a fraction of the travel behind it.
 *
 * Two of these make the landing read as speed rather than as a tween. The
 * opacity peaks in the middle of the travel and is gone by the end, so what
 * settles into Home's band is one picture and not three.
 */
function HeroGhost({
  hero,
  lag,
  landingCentre,
  landingScale,
  launchCentre,
  logo,
  peak,
}: {
  hero: SharedValue<number>;
  lag: number;
  landingCentre: { x: number; y: number };
  landingScale: number;
  launchCentre: { x: number; y: number };
  logo: ReturnType<typeof useSplashMirror>['logo'];
  peak: number;
}) {
  const style = useAnimatedStyle(() => {
    const behind = Math.max(0, hero.value - lag) / Math.max(0.001, 1 - lag);
    return {
      opacity: interpolate(hero.value, [0, 0.12, 0.62, 1], [0, peak, peak, 0], Extrapolation.CLAMP),
      transform: [
        { translateX: (landingCentre.x - launchCentre.x) * behind },
        { translateY: (landingCentre.y - launchCentre.y) * behind },
        { scale: 1 + (landingScale - 1) * behind },
      ],
    };
  });
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.centre, style]}>
      <Animated.Image {...logo} style={logo.style} />
    </Animated.View>
  );
}

/**
 * The terminal signature: a prompt in the lower third spelling out the world
 * being loaded.
 *
 * Every character is rendered from the first frame and only its opacity moves,
 * so the line's layout never changes while it types -- a line that reflowed per
 * character would be a layout pass per frame on the thread the app is starting
 * on, and it would jitter. The cursor steps a whole cell at a time because the
 * characters do; the scrim grows with it because a full-width plate arriving
 * before the text is the thing that makes a caption look like a caption.
 */
function LaunchPrompt({
  blink,
  bottom,
  characters,
  characterWidth,
  exit,
  fontFamily,
  fontSize,
  onLineLayout,
  scrimColor,
  scrimFullWidth,
  sigilColor,
  textColor,
  type,
}: {
  blink: SharedValue<number>;
  bottom: number;
  characters: string[];
  characterWidth: number;
  exit: SharedValue<number>;
  fontFamily: string;
  fontSize: number;
  onLineLayout: (event: LayoutChangeEvent) => void;
  scrimColor: string;
  scrimFullWidth: number;
  sigilColor: string;
  textColor: string;
  type: SharedValue<number>;
}) {
  const length = characters.length;
  // The dissolve: the line goes as Home's first card rises through where it
  // was. It rides the exit rather than a beat of its own, so the two are the
  // same moment by construction and cannot drift apart.
  const dissolveStyle = useAnimatedStyle(() => ({
    opacity: interpolate(exit.value, [0, 0.7], [1, 0], Extrapolation.CLAMP),
    transform: [{ translateY: -RISE_DISTANCE * exit.value }],
  }));
  const scrimStyle = useAnimatedStyle(() => {
    const typed = typedCount(type.value, length);
    const wide = scrimWidth(typed, characterWidth, PROMPT_SCRIM_PADDING, characterWidth);
    const scale = Math.min(1, wide / Math.max(1, scrimFullWidth));
    return {
      opacity: type.value > 0 ? PROMPT_SCRIM_OPACITY : 0,
      transform: [{ translateX: ((scale - 1) * scrimFullWidth) / 2 }, { scaleX: scale }],
    };
  });
  const cursorStyle = useAnimatedStyle(() => ({
    opacity: type.value <= 0 ? 0 : cursorOpacity(blink.value),
    transform: [{ translateX: typedCount(type.value, length) * characterWidth }],
  }));

  return (
    <View pointerEvents="none" style={[styles.prompt, { bottom }]}>
      <Animated.View style={[styles.promptRow, dissolveStyle]}>
        <Animated.View
          style={[
            styles.scrim,
            {
              backgroundColor: scrimColor,
              borderRadius: fontSize * 0.7,
              height: fontSize * CURSOR_HEIGHT + PROMPT_SCRIM_PADDING * 2,
              left: -PROMPT_SCRIM_PADDING,
              top: -PROMPT_SCRIM_PADDING,
              width: scrimFullWidth,
            },
            scrimStyle,
          ]}
        />
        <View onLayout={onLineLayout} style={styles.line}>
          {characters.map((character, index) => (
            <PromptCharacter
              // The line is a fixed string for the life of this sheet, so the
              // index is the identity: character 3 is character 3.
              key={`${index}:${character}`}
              character={character}
              color={index === 0 ? sigilColor : textColor}
              fontFamily={fontFamily}
              fontSize={fontSize}
              index={index}
              length={length}
              type={type}
            />
          ))}
        </View>
        <Animated.View
          style={[
            styles.cursor,
            {
              backgroundColor: sigilColor,
              height: fontSize * CURSOR_HEIGHT,
              width: characterWidth,
            },
            cursorStyle,
          ]}
        />
      </Animated.View>
    </View>
  );
}

function PromptCharacter({
  character,
  color,
  fontFamily,
  fontSize,
  index,
  length,
  type,
}: {
  character: string;
  color: string;
  fontFamily: string;
  fontSize: number;
  index: number;
  length: number;
  type: SharedValue<number>;
}) {
  const style = useAnimatedStyle(() => ({
    opacity: characterOpacity(type.value, length, index),
  }));
  return (
    <Animated.Text
      allowFontScaling={false}
      style={[styles.character, { color, fontFamily, fontSize }, style]}>
      {character}
    </Animated.Text>
  );
}

/**
 * The reveal when there is no runtime effect, or when Skia did not decode the
 * painting inside the budget.
 *
 * A circular iris: a round clip growing from the hero's centre with the
 * wallpaper counter-scaled inside it, so the picture stands still while the
 * hole in front of it opens. Both scales happen about the same point -- the
 * clip about the hero's centre and the image about the screen's -- and the
 * hero starts centred, so the two cancel exactly; the translate is there for
 * the case where they do not.
 *
 * A clean edge instead of an inked one, and a lit rim instead of a bank of
 * light. It is the same event drawn with less, which is what a fallback should
 * be, and it costs no shader and no second decode: `expo-image` is drawing the
 * same file Home is about to draw.
 */
function IrisReveal({
  bloom,
  settle,
  centre,
  radius,
  restRadius,
  rimColor,
  screen,
  source,
  fit,
  focalPoint,
  opacity,
}: {
  bloom: SharedValue<number>;
  settle: SharedValue<number>;
  centre: { x: number; y: number };
  radius: number;
  restRadius: number;
  rimColor: string;
  screen: { width: number; height: number };
  source: string;
  fit: 'cover' | 'contain' | 'tile' | undefined;
  focalPoint: { x: number; y: number } | undefined;
  opacity: number;
}) {
  const diameter = radius * 2;
  const left = centre.x - radius;
  const top = centre.y - radius;
  const floor = restRadius / Math.max(1, radius);

  const clipStyle = useAnimatedStyle(() => ({
    transform: [{ scale: floor + (1 - floor) * bloom.value }],
  }));
  const imageStyle = useAnimatedStyle(() => {
    const scale = floor + (1 - floor) * bloom.value;
    const zoom = WORLD_ARRIVAL_ZOOM + (1 - WORLD_ARRIVAL_ZOOM) * settle.value;
    return {
      transform: [
        { translateX: (1 - scale) * (centre.x - screen.width / 2) },
        { translateY: (1 - scale) * (centre.y - screen.height / 2) },
        { scale: zoom / scale },
      ],
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.iris,
        {
          borderColor: rimColor,
          borderRadius: radius,
          borderWidth: IRIS_RIM,
          height: diameter,
          left,
          top,
          width: diameter,
        },
        clipStyle,
      ]}>
      <Animated.View
        style={[
          styles.irisInner,
          { height: screen.height, left: -left, top: -top, width: screen.width },
          imageStyle,
        ]}>
        <Image
          accessible={false}
          autoplay={false}
          cachePolicy="memory"
          contentFit={fit === 'tile' ? 'contain' : (fit ?? 'cover')}
          contentPosition={
            focalPoint
              ? { left: `${focalPoint.x * 100}%`, top: `${focalPoint.y * 100}%` }
              : 'center'
          }
          source={{ uri: source }}
          style={[StyleSheet.absoluteFill, { opacity }]}
        />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  centre: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  character: {
    includeFontPadding: false,
  },
  cursor: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
  iris: {
    position: 'absolute',
    overflow: 'hidden',
  },
  irisInner: {
    position: 'absolute',
  },
  line: {
    flexDirection: 'row',
  },
  prompt: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  promptRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  scrim: {
    position: 'absolute',
  },
});
