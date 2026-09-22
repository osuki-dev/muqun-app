import type { SplashRenderContext } from '@osuki-dev/react-native-splash';
import { useSplashMirror } from '@osuki-dev/react-native-splash';
import { useThemeMode, useThemeTokens } from '@osuki-dev/ui';
import { Canvas, ColorShader, Fill, Shader } from '@shopify/react-native-skia';
import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
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
import { useLaunchHeroEdge } from '@/hooks/use-launch-hero-edge';
import {
  LAUNCH_ARTWORK_MAX_WIDTH,
  LAUNCH_ARTWORK_WIDTH_FRACTION,
} from '@/hooks/use-launch-image-sync';
import { useThemePack } from '@/hooks/use-theme-pack';
import { useMarkdownFonts } from '@/hooks/use-user-fonts';
import {
  colorVector,
  INK_BLOOM_EFFECT,
  inkBloomUniforms,
  type InkBloomHole,
} from '@/lib/ink-bloom-shader';
import { containedImageRect } from '@/lib/hero-feather';
import { heroEdgeAmount, HERO_EDGE_REST_FRACTION } from '@/lib/launch-hero-edge';
import { subscribeLaunchArtworkRect, type LaunchArtworkRect } from '@/lib/launch-artwork-rect';
import { cursorOpacity, launchPromptLine, scrimWidth, typedCount } from '@/lib/launch-intro-prompt';
import {
  BLOOM_OVERSHOOT,
  canSkipLaunchIntro,
  launchIntroTimeline,
  reducedLaunchIntroTimeline,
  WORLD_ARRIVAL_ZOOM,
} from '@/lib/launch-intro-timeline';
import { bloomRadius, chooseLaunchWorld } from '@/lib/launch-intro-world';
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
 *    picture -- around *the picture*, tracing its own outline rather than a
 *    circle near it. It is the only thing that moves for a sixth of a second,
 *    and it is attached to the picture, so what comes next has somewhere to
 *    come from.
 * 2. **The world blooms.** A front spreads from that outline to past the far
 *    corner, and behind it is the pack's wallpaper. The front is not a circle:
 *    it begins as the picture's own edge, its radius is displaced by noise, so
 *    it reads as ink soaking outward from the drawing, and it relaxes to a
 *    plain radial front as it leaves the picture behind. The edge carries a
 *    bank of `primary`, a thin bright rim in the pack's lightest tone, and a
 *    two-pixel chromatic split. The wallpaper arrives a touch zoomed and
 *    settles, so the world has depth as it comes.
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
 *   `use-launch-image-sync` already set to the pack's `home.artwork`;
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
 * Home measures its hero band and publishes it (`publishLaunchArtworkRect`). The
 * overlay cannot compute that rectangle: it is a measured header, plus a brand
 * block some packs hide, plus a banner slot. When Home has not reported one --
 * no servers paired yet, the hero switched off, the lock gate up, a
 * notification deep-linking past Home -- there is nothing to land in, so the
 * hero holds where it is and the opening ends on a cross-fade. That is the
 * documented fallback, not a failure; the world still blooms, because the world
 * arriving is true of every first screen.
 *
 * ## The picture's edge
 *
 * A pack ships whatever it likes in `home.artwork`: a character on a transparent
 * ground, a wide banner, a square logo. The opening used to begin from a
 * circle a third of the launch box across, which meant the rim closed around
 * empty paper for one pack and cut across the drawing for the next, and the
 * bloom visibly started as a disc.
 *
 * It now starts from the picture's own edge -- the alpha silhouette where
 * there is one, the drawn rectangle where there is not -- measured by
 * `use-launch-hero-edge.ts` and fitted by `launch-hero-edge.ts`. The shape is
 * a handful of uniforms, so nothing per frame changes; it is latched the
 * moment the opening starts, so a decode landing late cannot reshape a rim
 * already on screen; and a picture that has not been measured yet opens from
 * its rectangle, which is a fallback rather than a wait.
 *
 * Timing is entirely `launch-intro-timeline.ts`'s, the reveal's fallbacks are
 * `launch-intro-world.ts`'s and the prompt's schedule is
 * `launch-intro-prompt.ts`'s -- which is where all three can be tested. This
 * file is the drawing.
 */

/**
 * How far the noise field drifts across the whole bloom, in noise units.
 *
 * The launch's own taste rather than the effect's: the edge should crawl a
 * little as it travels, and this is how much.
 */
const BLOOM_DRIFT = 0.9;

/**
 * The two trailing copies of the hero, as a fraction of the travel they lag by.
 *
 * Further behind than the first cut of this, where the lag was re-normalised
 * over the remaining travel and the ghosts ended up six percent behind the
 * hero -- thirty points on a six-hundred-point journey, which at a quarter
 * opacity is invisible. A smear has to be far enough behind to be a second
 * image and near enough to be the same one.
 */
const GHOST_LAG = [0.16, 0.3] as const;

/** And how solid each is at its most visible. Falling, so the trail has a direction. */
const GHOST_OPACITY = [0.26, 0.12] as const;

/**
 * Where the front rests before it takes off, as a fraction of the picture's
 * box, **when there is no picture to start from**.
 *
 * A launch frame with a picture starts from that picture's outline instead
 * (see the note above, and `HERO_EDGE_REST_FRACTION`); this is what is left
 * for a compiled launch screen that is paper alone, and for the circular iris
 * fallback, which has no outline to trace.
 *
 * It has to read as a ring *around the hero*, which means it has to sit just
 * outside the drawn artwork and nowhere near the edges of the screen. The
 * launch box is `contain`, so the picture fills rather less of it than its
 * width suggests, and half the box was far too big -- the opening began with a
 * ring a third of the screen across, which is a shape rather than a halo.
 */
const REST_RADIUS_FRACTION = 0.34;

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

/**
 * How opaque the scrim under the line is. Enough to read on a painting, not a
 * plate -- and a pack's lower third can be anything, so this is set for the
 * worst case rather than the pack it was tuned on.
 */
const PROMPT_SCRIM_OPACITY = 0.55;

/** The block cursor's height, as a fraction of the type size. */
const CURSOR_HEIGHT = 1.18;

/** The iris fallback's lit edge, in points. Wider than the shader's, having no glow. */
const IRIS_RIM = 2;

const FALLBACK_MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

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
  const latestHomeRect = useRef<LaunchArtworkRect | null>(null);
  const [homeRect, setHomeRect] = useState<LaunchArtworkRect | null>(null);
  useEffect(
    () =>
      subscribeLaunchArtworkRect((rect) => {
        latestHomeRect.current = rect;
      }),
    []
  );
  // Capture before scheduling travel. The animation is armed only after this
  // snapshot has committed, so a delayed JS render cannot redirect it mid-flight.
  useEffect(() => {
    if (phase === 'visible' && !reduced) setHomeRect(latestHomeRect.current);
  }, [phase, reduced]);

  // The picture's box on the launch screen the OS drew. The mirror centres it
  // in the window, so this is a size rather than a rectangle.
  const launchBoxFallback = Math.min(
    width * LAUNCH_ARTWORK_WIDTH_FRACTION,
    LAUNCH_ARTWORK_MAX_WIDTH
  );
  const launchBox = Math.min(
    points(mirror.logo.style.width, launchBoxFallback),
    points(mirror.logo.style.height, launchBoxFallback)
  );
  const launchCentre = { x: width / 2, y: height / 2 };
  // The picture's box on screen, which the mirror centres in the window. Given
  // explicitly rather than by a full-bleed centring layer: three of those --
  // the hero and its two ghosts, two of them carrying an opacity -- are three
  // screen-sized things for the compositor to blend on every frame of the
  // opening, and the picture is a fifth of the screen.
  const heroBox = {
    width: points(mirror.logo.style.width, launchBoxFallback),
    height: points(mirror.logo.style.height, launchBoxFallback),
  };
  const heroFrame = {
    left: launchCentre.x - heroBox.width / 2,
    top: launchCentre.y - heroBox.height / 2,
    width: heroBox.width,
    height: heroBox.height,
  };
  // A different responsive image, a cover crop or a hidden Home uses a
  // dissolve. Pretending these are the same picture causes a visible face jump.
  const canLand = Boolean(
    !reduced &&
    homeRect &&
    !homeRect.cropped &&
    homeRect.source === mirror.logo.source?.uri &&
    homeRect.intrinsicWidth &&
    homeRect.intrinsicHeight
  );
  const landingCentre =
    canLand && homeRect
      ? { x: homeRect.x + homeRect.width / 2, y: homeRect.y + homeRect.height / 2 }
      : launchCentre;
  const launchDrawing = containedImageRect(heroBox, {
    width: homeRect?.intrinsicWidth ?? 0,
    height: homeRect?.intrinsicHeight ?? 0,
  });
  const landingScale = canLand && homeRect ? homeRect.width / launchDrawing.width : 1;

  const paper = packBackground ?? mirror.backgroundColor ?? theme.colors.background;
  const widthClass = width >= THEME_ARTWORK_REGULAR_MIN_WIDTH ? 'regular' : 'compact';

  // The pack's own world, resolved exactly the way Home resolves it, so what
  // blooms here is what is underneath when the sheet goes.
  const wallpaper =
    pack && assets
      ? resolveThemeImage(
          pack.manifest,
          'home.wallpaper',
          resolvedMode,
          widthClass,
          true,
          'shell.wallpaper'
        )
      : null;
  const wallpaperUri = wallpaper ? assets?.[wallpaper.asset] : undefined;
  const hasArtwork = Boolean(wallpaperUri?.startsWith('file:///'));

  // The painting is an ordinary image layer under the canvas, not something
  // the shader samples -- see the note atop `launch-bloom-shader.ts`. That is
  // why readiness is `expo-image`'s `onLoad` rather than a second decode of
  // our own: Home is about to draw this exact file through the same loader, so
  // a cold start now decodes the pack's wallpaper once instead of twice.
  const [imageReady, setImageReady] = useState(false);
  const onImageSettled = useCallback(() => setImageReady(true), []);

  // The front will not wait past the budget. Armed on the handover rather than
  // on mount, because the handover is when the reader starts counting.
  const [deadlinePassed, setDeadlinePassed] = useState(false);
  useEffect(() => {
    if (phase !== 'visible' || reduced || !hasArtwork) return;
    const timer = setTimeout(() => setDeadlinePassed(true), beats.worldDeadlineAt);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, hasArtwork, reduced]);

  // The reveal, once chosen, may only become more conservative. `irisLatched`
  // is the one-way door: see `LaunchWorldInput`.
  const [irisLatched, setIrisLatched] = useState(false);
  const world = chooseLaunchWorld({
    hasArtwork,
    shaderCompiled: INK_BLOOM_EFFECT !== null,
    imageReady,
    deadlinePassed,
    irisLatched,
  });
  const worldKind = world.kind;
  useEffect(() => {
    if (worldKind === 'iris') setIrisLatched(true);
  }, [worldKind]);

  // The far corner from wherever the hero is, taken over both ends of its
  // travel: the front has to have covered the screen at the end of the beat no
  // matter which centre it was measured from.
  const maxRadius = Math.max(
    bloomRadius({ width, height }, launchCentre),
    bloomRadius({ width, height }, landingCentre)
  );
  const restRadius = launchBox * REST_RADIUS_FRACTION;

  // The picture's own outline, which is what the front and the rim start from.
  // Latched on the handover: see `use-launch-hero-edge.ts`. Null when the
  // launch frame drew no picture, and then everything below is what it was --
  // a circle a third of the box across, around a centre with nothing in it.
  const heroEdge = useLaunchHeroEdge({
    uri: mirror.logo.source?.uri,
    box: mirror.hasLogo ? heroBox : null,
    // Anything past the handover counts as started, `'exiting'` included: the
    // latch is one-way, and `phase === 'visible'` would quietly let it go
    // again for the length of the cross-fade.
    started: phase !== 'native',
  });
  // Where the front rests before it takes off. With an outline to start from
  // that is a short distance *outside the drawing*, not a radius: the rim has
  // to sit just off the artwork's own antialiased border, and how far that is
  // has nothing to do with how big the picture happens to be in its box.
  const restFront = heroEdge ? launchBox * HERO_EDGE_REST_FRACTION : restRadius;

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

  // Once the front has passed the far corner the cover has nothing left to
  // cover, and a full-screen layer the compositor blends for no reason is not
  // free -- least of all on a device without a GPU. So the canvas leaves, and
  // what is left is the image layer it was uncovering. One state change at the
  // end of one animation, not a per-frame read.
  //
  // Only for a painted world: for a palette pack the canvas *is* the world and
  // has to stay, which costs nothing because nothing is animating by then and
  // Skia does not redraw a canvas whose uniforms have stopped changing.
  const [frontGone, setFrontGone] = useState(false);
  const onFrontGone = useCallback(() => setFrontGone(true), []);

  useEffect(() => {
    if (phase === 'visible') {
      startedAt.current = Date.now();
      if (reduced) {
        // Nothing travels, but the composition still has to be the finished one
        // so the cross-fade lands on Home rather than on a half-built stage.
        ignite.value = 1;
        bloom.value = 1;
        settle.value = 1;
        setFrontGone(true);
        hero.value = 1;
        type.value = 1;
        blink.value = 1;
      } else {
        ignite.value = withTiming(1, timing(beats.ignite.ms));
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

  useEffect(() => {
    if (phase !== 'visible' || reduced || !canLand) return;
    const elapsed = Date.now() - startedAt.current;
    // Missing the scheduled departure chooses the dissolve, never a late flight
    // or a longer splash. The rest of the opening keeps its original timeline.
    if (elapsed > beats.hero.at) return;
    hero.value = withDelay(beats.hero.at - elapsed, withTiming(1, timing(beats.hero.ms)));
  }, [phase, reduced, canLand, homeRect, beats.hero.at, beats.hero.ms, hero]);

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
    bloom.value = withDelay(
      delay,
      withTiming(1, timing(remaining), (finished) => {
        if (finished) scheduleOnRN(onFrontGone);
      })
    );
    settle.value = withDelay(delay, withTiming(1, timing(beats.settle.ms)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, revealReady, reduced]);

  const paperVector = useMemo(() => colorVector(paper), [paper]);
  const primaryVector = useMemo(() => colorVector(theme.colors.primary), [theme.colors.primary]);
  const rimVector = useMemo(() => colorVector(theme.colors.surface), [theme.colors.surface]);
  // What is behind the hole -- and, before the handover, nothing is.
  //
  // The overlay paints a copy of the native launch screen and native is removed
  // the moment that copy has laid out, which leaves a window where this sheet is
  // what the reader is looking at while `phase` is still 'native'. Anything the
  // cover reveals during that window is a hole sitting on the splash before the
  // opening has started: invisible for a painted pack, whose closed hole is the
  // paper it is already showing, but a palette pack drew a small coloured blob
  // on the splash for half a second. The cover stays shut until there is an
  // opening to open.
  const hole: InkBloomHole =
    phase !== 'visible'
      ? 'closed'
      : world.kind === 'palette'
        ? 'field'
        : world.kind === 'painted' && world.ready
          ? 'through'
          : 'closed';
  const worldAlpha = wallpaper?.opacity ?? 1;

  // Every uniform, once per frame, on the UI thread. JavaScript does nothing
  // here at all: the shared values below are the only things that change.
  const uniforms = useDerivedValue(() => {
    const front = restFront + (maxRadius * BLOOM_OVERSHOOT - restFront) * bloom.value;
    return inkBloomUniforms({
      resolution: { width, height },
      // The hole follows the picture rather than staying where the picture
      // started: the world came out of the hero, so it goes on coming out of
      // the hero while the hero travels.
      centre: {
        x: launchCentre.x + (landingCentre.x - launchCentre.x) * hero.value,
        y: launchCentre.y + (landingCentre.y - launchCentre.y) * hero.value,
      },
      front,
      // The drift rides the bloom rather than a clock, so the canvas stops
      // redrawing the moment the animation stops rather than at unmount.
      drift: bloom.value * BLOOM_DRIFT,
      settle: settle.value,
      // The picture's outline, and how much of it the front still carries.
      // The shape scales with the hero as it flies into Home's band and
      // relaxes out of the front as the front leaves the picture behind, so
      // that what crosses the far corner is the plain radial front it always
      // was. One uniform does both -- see `heroEdgeAmount`.
      edge: heroEdge,
      edgeAmount: heroEdge
        ? heroEdgeAmount(front, heroEdge.max, 1 + (landingScale - 1) * hero.value)
        : 0,
      hole,
      cover: 'paper',
      paper: paperVector,
      accent: primaryVector,
      rim: rimVector,
      surface: rimVector,
      // The rim wakes with the ignite beat rather than being there from the
      // first frame, which is what makes it read as the picture catching light.
      rimOpacity: ignite.value,
      chroma: ignite.value,
    });
  });

  const sheetStyle = useAnimatedStyle(() => ({ opacity: 1 - exit.value }));
  const heroStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: (landingCentre.x - launchCentre.x) * hero.value },
      { translateY: (landingCentre.y - launchCentre.y) * hero.value },
      { scale: 1 + (landingScale - 1) * hero.value },
    ],
  }));

  // The arrival zoom is a transform on the image layer now, not a matrix
  // inside a sampler: one composited scale instead of per-pixel arithmetic.
  const worldStyle = useAnimatedStyle(() => ({
    transform: [{ scale: WORLD_ARRIVAL_ZOOM + (1 - WORLD_ARRIVAL_ZOOM) * settle.value }],
  }));

  const showWorldImage = world.kind === 'painted' && Boolean(wallpaperUri);
  // The cover may only leave once it has something to leave behind. Unmounting
  // it while the painting has still not loaded would swap a covered screen for
  // an uncovered one in a single frame -- the hard cut this opening exists to
  // avoid -- so `ready` is part of the condition and not merely `frontGone`.
  const showCanvas =
    world.kind === 'palette' || (world.kind === 'painted' && !(frontGone && world.ready));

  return (
    <Animated.View style={[mirror.container.style, sheetStyle]}>
      {/* The paper, which is the pack's own and is under everything. */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: paper }]} />

      {/*
        The world itself, drawn the way Home draws it. It is under the cover
        from the first frame, so it is loading and decoding while the rim is
        still breathing, and the front does not reveal it until `onLoad` says
        there is something to reveal.
      */}
      {showWorldImage && wallpaperUri ? (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, worldStyle]}>
          <Image
            accessible={false}
            autoplay={false}
            cachePolicy="memory"
            contentFit={wallpaper?.fit === 'tile' ? 'contain' : (wallpaper?.fit ?? 'cover')}
            contentPosition={
              wallpaper?.focalPoint
                ? {
                    left: `${wallpaper.focalPoint.x * 100}%`,
                    top: `${wallpaper.focalPoint.y * 100}%`,
                  }
                : 'center'
            }
            onError={onImageSettled}
            onLoad={onImageSettled}
            source={{ uri: wallpaperUri }}
            style={[StyleSheet.absoluteFill, { opacity: worldAlpha }]}
          />
        </Animated.View>
      ) : null}

      {/*
        The cover, with the hole in it. `androidWarmup` pays the GL context
        cost while the native splash is still up rather than on the first frame
        anybody sees; the canvas itself has been drawing (invisibly, under that
        splash) since the first commit, so the SkSL program is compiled and
        warm long before the front starts to move.
      */}
      {showCanvas && INK_BLOOM_EFFECT ? (
        <Canvas androidWarmup style={StyleSheet.absoluteFill}>
          <Fill>
            <Shader source={INK_BLOOM_EFFECT} uniforms={uniforms}>
              {/*
                The effect declares a cover image and a runtime effect must be
                given every child it declares, but this caller's cover is flat
                paper -- so this is bound and never evaluated.
              */}
              <ColorShader color={paper} />
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
        characterWidth={characterWidth}
        exit={exit}
        fontFamily={fonts.mono ?? FALLBACK_MONO}
        fontSize={promptSize}
        line={line}
        lineWidth={characterWidth * characters.length}
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
          {canLand &&
            GHOST_LAG.map((lag, index) => (
              <HeroGhost
                key={lag}
                frame={heroFrame}
                hero={hero}
                lag={lag}
                landingCentre={landingCentre}
                landingScale={landingScale}
                launchCentre={launchCentre}
                logo={mirror.logo}
                peak={GHOST_OPACITY[index] ?? 0}
              />
            ))}
          <Animated.View pointerEvents="none" style={[styles.hero, heroFrame, heroStyle]}>
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
  frame,
  hero,
  lag,
  landingCentre,
  landingScale,
  launchCentre,
  logo,
  peak,
}: {
  frame: { left: number; top: number; width: number; height: number };
  hero: SharedValue<number>;
  lag: number;
  landingCentre: { x: number; y: number };
  landingScale: number;
  launchCentre: { x: number; y: number };
  logo: ReturnType<typeof useSplashMirror>['logo'];
  peak: number;
}) {
  const style = useAnimatedStyle(() => {
    // The same journey, started later -- not the same journey compressed,
    // which is what re-normalising the remainder would do and is why the
    // first version of this had no visible trail at all.
    const behind = Math.max(0, hero.value - lag);
    return {
      opacity: interpolate(hero.value, [0, 0.14, 0.62, 1], [0, peak, peak, 0], Extrapolation.CLAMP),
      transform: [
        { translateX: (landingCentre.x - launchCentre.x) * behind },
        { translateY: (landingCentre.y - launchCentre.y) * behind },
        { scale: 1 + (landingScale - 1) * behind },
      ],
    };
  });
  return (
    <Animated.View pointerEvents="none" style={[styles.hero, frame, style]}>
      <Animated.Image {...logo} style={logo.style} />
    </Animated.View>
  );
}

/**
 * The terminal signature: a prompt in the lower third spelling out the world
 * being loaded.
 *
 * The reveal is two transforms and no layout at all. The line is one `Text`,
 * laid out once; a clip view is translated left by everything not yet typed,
 * and the line is translated right by the same amount inside it, so the line
 * ends up exactly where it was laid out while the clip's own edge cuts it at
 * the cursor. Clipping happens in a view's own coordinates and its transform
 * is applied afterwards, which is the whole trick: clip-then-move reveals,
 * where move-then-clip would only squash.
 *
 * It was twenty-six animated nodes before this -- one opacity per character --
 * which worked and was honest but meant twenty-six property writes on every
 * frame of a launch whose whole point is that it does not stutter. Four nodes
 * do the same job: the clip, the line, the cursor and the scrim.
 *
 * The cursor steps a whole cell at a time, which is what makes the hard edge
 * of the reveal read as typing rather than as a wipe: the block is always
 * sitting on the character that just arrived. The scrim grows with it, because
 * a full-width plate arriving before the text is the thing that makes a
 * caption look like a caption.
 */
function LaunchPrompt({
  blink,
  bottom,
  characterWidth,
  exit,
  fontFamily,
  fontSize,
  line,
  lineWidth,
  onLineLayout,
  scrimColor,
  scrimFullWidth,
  sigilColor,
  textColor,
  type,
}: {
  blink: SharedValue<number>;
  bottom: number;
  characterWidth: number;
  exit: SharedValue<number>;
  fontFamily: string;
  fontSize: number;
  line: string;
  lineWidth: number;
  onLineLayout: (event: LayoutChangeEvent) => void;
  scrimColor: string;
  scrimFullWidth: number;
  sigilColor: string;
  textColor: string;
  type: SharedValue<number>;
}) {
  const length = Array.from(line).length;
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
  const clipStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -(lineWidth - typedCount(type.value, length) * characterWidth) }],
  }));
  const lineStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: lineWidth - typedCount(type.value, length) * characterWidth }],
  }));
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
        <Animated.View style={[styles.clip, clipStyle]}>
          <Animated.View style={lineStyle}>
            <Text
              allowFontScaling={false}
              numberOfLines={1}
              onLayout={onLineLayout}
              style={[styles.line, { color: textColor, fontFamily, fontSize }]}>
              {/* The sigil is the pack's `primary`; the name is its text. One
                  `Text` with one nested span, so it is still one layout. */}
              <Text style={{ color: sigilColor }}>{line.slice(0, 1)}</Text>
              {line.slice(1)}
            </Text>
          </Animated.View>
        </Animated.View>
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
  hero: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  clip: {
    overflow: 'hidden',
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
    includeFontPadding: false,
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
