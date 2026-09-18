import { useThemeTokens } from '@osuki-dev/ui';
import {
  Canvas,
  Fill,
  Image as SkiaImage,
  ImageShader,
  Shader,
  Skia,
  TileMode,
  makeImageFromView,
  type SkImage,
} from '@shopify/react-native-skia';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  Platform,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import Animated, {
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { DURATION, RESKIN_MOTION, timing } from '@/lib/motion';
import {
  SNAPSHOT_BUDGET_MS,
  denormalizeOrigin,
  halftoneCell,
  halftoneFront,
  halftoneReach,
  normalizeOrigin,
  recordSnapshotCost,
  reskinCoverSource,
  resolveOrigin,
  selectReskinPlay,
  shouldAttemptSnapshot,
  snapshotOutcome,
  washFront,
  washGeometry,
  type ReskinPlay,
  type WashGeometry,
} from '@/lib/reskin-geometry';
import {
  FONT_HALFTONE_EFFECT,
  HALFTONE_BAND,
  THEME_WASH_EFFECT,
  WASH_BLEED,
  fontHalftoneUniforms,
  themeWashUniforms,
  type ReskinPoint,
  type ReskinSize,
} from '@/lib/reskin-shaders';
import { colorVector } from '@/lib/ink-bloom-shader';

/**
 * The re-skin transition: what stands between the reader and the one frame in
 * which the app is half of its old self.
 *
 * ## Why a photograph
 *
 * Changing a palette or a typeface re-skins every pixel of the app, and React
 * Native gets there over several frames. A font is the worse of the two: new
 * metrics mean every text node re-measures, so rows visibly jump before they
 * settle. Even without the reflow the change is a hard cut -- the reader taps
 * a row and the world they were reading is gone between two frames.
 *
 * So the app photographs the old screen with `makeImageFromView`, holds the
 * photograph over the top, lets the live interface underneath change and
 * settle where nobody is watching, and then erases the photograph with a
 * shader. The reflow happens behind a still image. What the reader sees is one
 * deliberate move.
 *
 * ## Surfaces, and the form sheet that started all this
 *
 * The obvious build is one overlay at the app root, and it is wrong here.
 * Every screen in this app that changes a theme or a font is a native
 * `formSheet` (`src/lib/route-presentation.ts`), and a form sheet is not a
 * view in the app's hierarchy: on iOS it is a separately presented
 * `UIViewController`, on Android a `Dialog` with a `Window` of its own. No
 * `zIndex` and no `elevation` reaches above either. A root overlay cannot
 * cover a form sheet, and `makeImageFromView` on a root ref does not
 * photograph one.
 *
 * For the theme sheet that does not matter, because applying a theme closes
 * it. For the font sheet it matters a great deal: "Use system font" and a
 * finished install both leave the sheet open, and the sheet is most of the
 * screen and is itself set in the typeface that just changed. A root-only
 * overlay would hide the reflow everywhere except the one surface the reader
 * is actually looking at.
 *
 * Hence {@link ReskinSurface}: a window gets an overlay by mounting one. The
 * root mounts one, the font sheet mounts one, and a run photographs and erases
 * every surface it can find. Origins cross between them as fractions rather
 * than as points, for the reason set out on `resolveOrigin`.
 *
 * ## The transition never delays the change
 *
 * Every failure here is answered by applying the setting with no effect at
 * all: a device that cannot snapshot, a snapshot that takes longer than
 * {@link SNAPSHOT_BUDGET_MS}, a shader that will not compile, a surface with
 * no size yet. The reader asked for a font, not for an animation, and a
 * setting that takes a beat longer to land because the app was taking its
 * picture is a worse app in exchange for a nicer one.
 */

/** What a caller asks for. */
export type ReskinRunOptions = {
  kind: 'theme' | 'font';
  /**
   * Where the reader touched, as a fraction of the surface they touched it on
   * -- `{ x: 0.5, y: 0.7 }` for a row seven tenths of the way down. Use
   * `normalizeOrigin` on a measured rectangle's centre. Omitted is fine and
   * documented: see `resolveOrigin`.
   */
  origin?: ReskinPoint;
  /**
   * The colour the front is lit in. For a theme change this is the *new*
   * theme's primary, which the caller can resolve without applying it
   * (`themeVariant(resolveThemePack(id), mode).colors.primary`) and which is
   * the one moment in the transition that tells the reader in colour what they
   * chose. Omitted, the current theme's primary is used -- which is right for
   * a font change, where the palette is not moving.
   */
  accent?: string;
  /** The change itself. Runs behind the photograph, and always runs. */
  apply: () => void | Promise<void>;
};

type ActiveRun = {
  id: number;
  play: Exclude<ReskinPlay, 'none'>;
  /** A fraction of each surface -- see `resolveOrigin`. */
  origin: ReskinPoint;
  rim: number[];
  wet: number[];
  cell: number;
  shots: ReadonlyMap<string, SkImage>;
  /**
   * Whether the cover has to arrive before it can leave. A photograph is the
   * old screen and so is simply there; a veil is not, and fades up first.
   */
  veiled: boolean;
};

/** Where a reader last put a finger on a surface, and when. */
type TouchRecord = { point: ReskinPoint; at: number } | null;

type SurfaceEntry = {
  ref: RefObject<View | null>;
  size: { current: ReskinSize };
  touch: { current: TouchRecord };
};

/**
 * How long a touch stays the reason a transition is happening, in
 * milliseconds.
 *
 * The origin should be the row the reader tapped, and the cheapest true answer
 * to "which row" is where their finger last went down. Past a second and a
 * half the connection is a guess: a font that finished installing, a theme
 * applied from a deep link, a change made by something other than the touch
 * being remembered. Those get their kind's default instead, which is an
 * honest "from the top" rather than a wash that comes from wherever the reader
 * happened to scroll a while ago.
 */
const TOUCH_RECENCY_MS = 1_500;

type ReskinContextValue = {
  run: (options: ReskinRunOptions) => Promise<void>;
  active: ActiveRun | null;
  progress: SharedValue<number>;
  /** The cover's own opacity: 1 for a photograph, 0 -> 1 for a veil. */
  veil: SharedValue<number>;
  register: (id: string, entry: SurfaceEntry) => () => void;
};

const COVER_SOURCE = reskinCoverSource(Platform.OS);

/**
 * A sheet of the old theme's paper, the size of one surface.
 *
 * The ground is the theme's background with its raised surface bleeding down
 * from the top, which is the same two tones every screen in the app is built
 * from -- so the veil reads as the old world with its furniture put away, not
 * as a colour from nowhere. Drawn in points rather than pixels: there is no
 * detail in it to lose, and a quarter-resolution target is a draw measured in
 * microseconds.
 *
 * `makeNonTextureImage` because an offscreen surface lives on the context of
 * the thread that made it, and the canvas that will draw this one is on
 * another. Null on any failure, and a null veil is an apply with no effect.
 */
function makeVeilImage(size: ReskinSize, paper: string, raised: string): SkImage | null {
  try {
    const width = Math.max(1, Math.round(size.width));
    const height = Math.max(1, Math.round(size.height));
    const surface = Skia.Surface.MakeOffscreen(width, height) ?? Skia.Surface.Make(width, height);
    if (!surface) return null;
    const canvas = surface.getCanvas();
    canvas.drawColor(Skia.Color(paper));
    const wash = Skia.Paint();
    wash.setShader(
      Skia.Shader.MakeLinearGradient(
        { x: 0, y: 0 },
        { x: 0, y: height },
        [Skia.Color(raised), Skia.Color(paper)],
        [0, 1],
        TileMode.Clamp
      )
    );
    wash.setAlphaf(0.6);
    canvas.drawRect({ x: 0, y: 0, width, height }, wash);
    surface.flush();
    const snapshot = surface.makeImageSnapshot();
    const image = snapshot.makeNonTextureImage();
    if (image !== snapshot) snapshot.dispose();
    return image;
  } catch {
    return null;
  }
}

const ReskinContext = createContext<ReskinContextValue | null>(null);

/**
 * How dark the damp band behind the wash's front is, as a fraction of the new
 * theme's primary.
 *
 * The band is the primary taken almost to black rather than black itself, so
 * the paper the wash has just crossed is holding the new ink rather than a
 * grey shadow. On a dark pack it is close to invisible and the lit rim carries
 * the edge instead, which is the right way round: a dark theme has no wet
 * paper to show.
 */
const WET_SHADE = 0.18;

/** The primary, taken down to the damp band's shade, premultiplied by nothing. */
function dampen(color: number[]): number[] {
  return [(color[0] ?? 0) * WET_SHADE, (color[1] ?? 0) * WET_SHADE, (color[2] ?? 0) * WET_SHADE, 1];
}

/** Two frames: one for the new interface to commit, one for it to have painted. */
function afterNextPaint(run: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(run));
}

/**
 * Give an image back to Skia, once nothing can still be drawing it.
 *
 * A frame later rather than now: unmounting the canvas is a React state
 * change, so the draw that is already in flight has not finished when the
 * state is set, and disposing a texture out from under it is a native crash
 * rather than a dropped frame.
 */
function release(images: Iterable<SkImage | null>): void {
  const doomed = [...images];
  requestAnimationFrame(() => {
    for (const image of doomed) image?.dispose();
  });
}

export function ReskinTransitionProvider({ children }: { children: ReactNode }) {
  const { colors, typography } = useThemeTokens();
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<ActiveRun | null>(null);
  const progress = useSharedValue(0);
  const veil = useSharedValue(1);
  const surfaces = useRef(new Map<string, SurfaceEntry>());
  const nextId = useRef(0);
  const strikes = useRef(0);
  const activeRef = useRef<ActiveRun | null>(null);
  // Synchronised after the commit rather than during the render, so that `run`
  // and `finish` -- both of which are called long after any render, from a tap
  // or from an animation ending -- can read what is on screen now without
  // holding a stale closure over it.
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const register = useCallback((id: string, entry: SurfaceEntry) => {
    surfaces.current.set(id, entry);
    return () => {
      surfaces.current.delete(id);
    };
  }, []);

  // A live copy of everything a run needs off the theme, so that `run` can
  // stay a stable callback and still read today's palette and type scale.
  const paint = useRef({
    primary: colors.primary,
    body: typography.body.fontSize,
    paper: colors.background,
    raised: colors.surfaceRaised,
  });
  useEffect(() => {
    paint.current = {
      primary: colors.primary,
      body: typography.body.fontSize,
      paper: colors.background,
      raised: colors.surfaceRaised,
    };
  }, [colors.background, colors.primary, colors.surfaceRaised, typography.body.fontSize]);

  const finish = useCallback((id: number) => {
    const current = activeRef.current;
    if (!current || current.id !== id) return;
    release(current.shots.values());
    setActive(null);
  }, []);

  const run = useCallback(
    async (options: ReskinRunOptions) => {
      const { kind, apply } = options;
      const id = ++nextId.current;

      // Anything already on screen belongs to a run the reader has overtaken.
      const previous = activeRef.current;
      if (previous) {
        release(previous.shots.values());
        setActive(null);
      }

      const entries = [...surfaces.current.entries()].filter(
        ([, entry]) => entry.size.current.width > 0 && entry.size.current.height > 0
      );
      if (entries.length === 0) {
        await apply();
        return;
      }

      const play = (size: ReskinSize) =>
        selectReskinPlay({
          kind,
          reduceMotion,
          effectReady: Boolean(kind === 'theme' ? THEME_WASH_EFFECT : FONT_HALFTONE_EFFECT),
          snapshot: 'ok',
          size,
        });

      /** Take the cover away: the same last beat for a photograph and a veil. */
      const erase = (chosen: Exclude<ReskinPlay, 'none'>) => {
        afterNextPaint(() => {
          if (id !== nextId.current) return;
          const config =
            chosen === 'crossfade'
              ? // The one animation in the app that must ignore the reduced-motion
                // setting, because it *is* the accommodation. `ReduceMotion.System`
                // would collapse it to a single frame, which is the hard cut this
                // whole module exists to prevent -- and the cut between two entire
                // colour schemes is the most violent thing it could do to a reader
                // who has asked for less movement.
                timing(DURATION.short, { reduceMotion: ReduceMotion.Never })
              : timing(chosen === 'wash' ? RESKIN_MOTION.washMs : RESKIN_MOTION.halftoneMs);
          progress.value = withTiming(1, config, (done) => {
            'worklet';
            if (done) runOnJS(finish)(id);
          });
        });
      };

      /** Where the reader last touched, as a fraction of that surface. */
      const sniffOrigin = (): ReskinPoint | undefined => {
        let sniffed: ReskinPoint | undefined;
        let freshest = Date.now() - TOUCH_RECENCY_MS;
        for (const [, entry] of entries) {
          const touch = entry.touch.current;
          if (touch && touch.at > freshest) {
            freshest = touch.at;
            sniffed = normalizeOrigin(touch.point, entry.size.current);
          }
        }
        return sniffed;
      };

      if (COVER_SOURCE === 'veil') {
        const chosen = play(entries[0]?.[1].size.current ?? { width: 0, height: 0 });
        const shots = new Map<string, SkImage>();
        if (chosen !== 'none') {
          for (const [key, entry] of entries) {
            const image = makeVeilImage(
              entry.size.current,
              paint.current.paper,
              paint.current.raised
            );
            if (image) shots.set(key, image);
          }
        }
        if (chosen === 'none' || shots.size === 0) {
          release(shots.values());
          await apply();
          return;
        }

        const accent = colorVector(options.accent ?? paint.current.primary);
        progress.value = 0;
        veil.value = 0;
        setActive({
          id,
          play: chosen,
          origin: resolveOrigin(options.origin ?? sniffOrigin(), kind),
          rim: accent,
          wet: dampen(accent),
          cell: halftoneCell(paint.current.body),
          shots,
          veiled: true,
        });

        // The veil comes up over the old interface, the change lands under it
        // once it is opaque, and only then does the front take it away. The
        // apply is awaited by the caller as it always was; it is simply a
        // fifth of a second later than the tap, behind a cover that is
        // already moving.
        await new Promise<void>((resolve) => {
          const covered = () => resolve();
          afterNextPaint(() => {
            veil.value = withTiming(
              1,
              timing(DURATION.short, { reduceMotion: ReduceMotion.Never }),
              () => {
                'worklet';
                runOnJS(covered)();
              }
            );
          });
        });
        await apply();
        if (id === nextId.current) erase(chosen);
        return;
      }

      // A device that has already shown it cannot photograph itself in time is
      // not asked again: the picture is the expensive half, and taking one we
      // know we will discard would only make the setting slower to land.
      if (!shouldAttemptSnapshot(strikes.current)) {
        await apply();
        return;
      }

      const started = Date.now();
      const capture = Promise.all(
        entries.map(([, entry]) => makeImageFromView(entry.ref).catch((): SkImage | null => null))
      );
      // The budget is a race the apply always wins. A snapshot that arrives
      // after it is not waited for and not used -- only released.
      const raced = await Promise.race([
        capture,
        new Promise<'slow'>((resolve) => setTimeout(() => resolve('slow'), SNAPSHOT_BUDGET_MS)),
      ]);
      if (raced === 'slow' || id !== nextId.current) {
        void capture.then(release);
        await apply();
        return;
      }

      const elapsed = Date.now() - started;
      strikes.current = recordSnapshotCost(strikes.current, elapsed);

      const primarySurface = entries[0]?.[1].size.current ?? { width: 0, height: 0 };
      const photographed = snapshotOutcome(
        raced.find((image) => Boolean(image)),
        elapsed
      );
      const chosen = photographed === 'ok' ? play(primarySurface) : 'none';
      if (chosen === 'none') {
        release(raced);
        await apply();
        return;
      }

      const shots = new Map<string, SkImage>();
      raced.forEach((image, index) => {
        const key = entries[index]?.[0];
        if (image && key) shots.set(key, image);
        else if (image) image.dispose();
      });
      if (shots.size === 0) {
        await apply();
        return;
      }

      const accent = colorVector(options.accent ?? paint.current.primary);
      progress.value = 0;
      veil.value = 1;
      // The cover goes up and the setting changes in the same React commit, so
      // there is no frame in which one has happened and the other has not.
      // The origin is where the reader last touched, on whichever surface they
      // touched: a finger is a better record of what was tapped than a row
      // component's idea of where it is.
      setActive({
        id,
        play: chosen,
        origin: resolveOrigin(options.origin ?? sniffOrigin(), kind),
        rim: accent,
        wet: dampen(accent),
        cell: halftoneCell(paint.current.body),
        shots,
        veiled: false,
      });
      await apply();
      erase(chosen);
    },
    [finish, progress, reduceMotion, veil]
  );

  // A run still on screen when the tree goes away would otherwise take its
  // textures with it.
  useEffect(
    () => () => {
      const current = activeRef.current;
      if (current) for (const image of current.shots.values()) image.dispose();
    },
    []
  );

  const value = useMemo<ReskinContextValue>(
    () => ({ run, active, progress, veil, register }),
    [run, active, progress, veil, register]
  );

  return <ReskinContext.Provider value={value}>{children}</ReskinContext.Provider>;
}

/**
 * Ask for a re-skin transition.
 *
 * Outside the provider the hook still answers, with a `run` that applies the
 * change and plays nothing. A screen should not have to know whether it is
 * mounted under the root, and a setting must work either way.
 */
export function useReskinTransition(): { run: (options: ReskinRunOptions) => Promise<void> } {
  const context = useContext(ReskinContext);
  const fallback = useCallback(async (options: ReskinRunOptions) => {
    await options.apply();
  }, []);
  return { run: context?.run ?? fallback };
}

/**
 * A window that can be photographed and erased.
 *
 * Wrap the content of the root, and the content of any native form sheet that
 * stays open across a change. `collapsable={false}` is not optional: without
 * it Android is free to flatten the view out of the hierarchy and there is
 * nothing left to photograph.
 */
export function ReskinSurface({ id, children }: { id: string; children: ReactNode }) {
  const context = useContext(ReskinContext);
  const ref = useRef<View>(null);
  const size = useRef<ReskinSize>({ width: 0, height: 0 });
  const touch = useRef<TouchRecord>(null);
  const [measured, setMeasured] = useState<ReskinSize>({ width: 0, height: 0 });

  const register = context?.register;
  useEffect(() => {
    if (!register) return;
    return register(id, { ref, size, touch });
  }, [id, register]);

  /**
   * Note where the finger went down, and decline to do anything else about it.
   *
   * The capture phase sees every touch on this window before any child has
   * claimed it, and returning `false` declines the responder, so the row the
   * reader is actually pressing negotiates exactly as it would have. Nothing
   * here consumes a gesture, delays one, or re-renders: it writes one object
   * to a ref. That is the whole mechanism by which a wash knows which side of
   * the screen the reader is on.
   */
  const noteTouch = useCallback((event: GestureResponderEvent) => {
    const { locationX, locationY } = event.nativeEvent;
    touch.current = { point: { x: locationX, y: locationY }, at: Date.now() };
    return false;
  }, []);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    size.current = { width, height };
    setMeasured((previous) =>
      previous.width === width && previous.height === height ? previous : { width, height }
    );
  }, []);

  const active = context?.active ?? null;
  const image = active?.shots.get(id) ?? null;

  return (
    <View
      collapsable={false}
      onLayout={onLayout}
      onStartShouldSetResponderCapture={noteTouch}
      ref={ref}
      style={styles.surface}>
      {children}
      {active && image && measured.width > 0 && context ? (
        <ReskinOverlay
          image={image}
          key={active.id}
          progress={context.progress}
          run={active}
          size={measured}
          veil={context.veil}
        />
      ) : null}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* The overlays                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Whether the overlay eats the reader's touches while it is up, and why the
 * answer is not the same for the two transitions.
 *
 * A **theme** change moves no geometry. Every row is exactly where it was and
 * where the photograph shows it, so a tap during the wash lands on the thing
 * the reader is pointing at. There is no reason to take the app away from
 * them for two thirds of a second, so the wash lets everything through and
 * the reader can keep scrolling the list while the new world arrives.
 *
 * A **font** change moves all of it. New metrics re-measure every line, so
 * while the halftone is up the live rows underneath have already shifted and
 * the photograph is the only thing still showing them where they were. A tap
 * would hit whatever slid under the finger, which is worse than no tap at all,
 * so the halftone swallows them for its six hundred milliseconds.
 *
 * Neither choice delays the apply; both are over in well under a second.
 */
function overlayTouches(play: ActiveRun['play']): 'none' | 'auto' {
  return play === 'halftone' ? 'auto' : 'none';
}

function ReskinOverlay({
  image,
  progress,
  run,
  size,
  veil,
}: {
  image: SkImage;
  progress: SharedValue<number>;
  run: ActiveRun;
  size: ReskinSize;
  veil: SharedValue<number>;
}) {
  const origin = useMemo(() => denormalizeOrigin(run.origin, size), [run.origin, size]);
  // A photograph is the old screen and is simply there. A veil has to arrive:
  // composited opacity on the view, so its fade costs the shader nothing.
  const arriving = useAnimatedStyle(() => ({ opacity: run.veiled ? veil.value : 1 }));

  return (
    <Animated.View
      // `importantForAccessibility` on this view alone, and deliberately not
      // `accessibilityViewIsModal` or `no-hide-descendants`: the live
      // interface underneath must stay in the accessibility tree throughout.
      // A screen reader should never lose the app for half a second because it
      // is being repainted, and the end-to-end suite reads that tree the
      // instant a flow applies a theme.
      accessible={false}
      importantForAccessibility="no"
      pointerEvents={run.veiled ? 'auto' : overlayTouches(run.play)}
      style={[styles.cover, arriving]}>
      {run.play === 'wash' ? (
        <WashOverlay image={image} origin={origin} progress={progress} run={run} size={size} />
      ) : run.play === 'halftone' ? (
        <HalftoneOverlay image={image} origin={origin} progress={progress} run={run} size={size} />
      ) : (
        <CrossfadeOverlay image={image} progress={progress} size={size} />
      )}
    </Animated.View>
  );
}

function WashOverlay({
  image,
  origin,
  progress,
  run,
  size,
}: {
  image: SkImage;
  origin: ReskinPoint;
  progress: SharedValue<number>;
  run: ActiveRun;
  size: ReskinSize;
}) {
  const geometry: WashGeometry = useMemo(
    () => washGeometry(origin, size, WASH_BLEED),
    [origin, size]
  );

  const uniforms = useDerivedValue(() =>
    themeWashUniforms({
      origin,
      direction: geometry.direction,
      front: washFront(progress.value, geometry),
      drift: progress.value * RESKIN_MOTION.washDrift,
      rim: run.rim,
      wet: run.wet,
    })
  );

  // The parallax, as a composited transform on the canvas rather than as a
  // matrix inside the sampler. Scaling *up* means the canvas always covers the
  // surface, so the old screen can recede without uncovering an edge.
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + (RESKIN_MOTION.washParallax - 1) * progress.value }],
  }));

  if (!THEME_WASH_EFFECT) return null;
  return (
    <Animated.View style={[styles.overlay, style]}>
      <Canvas style={styles.overlay}>
        <Fill>
          <Shader source={THEME_WASH_EFFECT} uniforms={uniforms}>
            <ImageShader
              fit="cover"
              image={image}
              rect={{ x: 0, y: 0, width: size.width, height: size.height }}
              tx="clamp"
              ty="clamp"
            />
          </Shader>
        </Fill>
      </Canvas>
    </Animated.View>
  );
}

function HalftoneOverlay({
  image,
  origin,
  progress,
  run,
  size,
}: {
  image: SkImage;
  origin: ReskinPoint;
  progress: SharedValue<number>;
  run: ActiveRun;
  size: ReskinSize;
}) {
  const reach = useMemo(
    () => halftoneReach(origin, size, run.cell, HALFTONE_BAND),
    [origin, run.cell, size]
  );

  const uniforms = useDerivedValue(() =>
    fontHalftoneUniforms({
      origin,
      front: halftoneFront(progress.value, reach),
      cell: run.cell,
      tint: run.rim,
    })
  );

  if (!FONT_HALFTONE_EFFECT) return null;
  return (
    <Canvas style={styles.overlay}>
      <Fill>
        <Shader source={FONT_HALFTONE_EFFECT} uniforms={uniforms}>
          <ImageShader
            fit="cover"
            image={image}
            rect={{ x: 0, y: 0, width: size.width, height: size.height }}
            tx="clamp"
            ty="clamp"
          />
        </Shader>
      </Fill>
    </Canvas>
  );
}

/**
 * The reduced-motion answer: the photograph dissolves and nothing travels.
 *
 * No shader at all -- the opacity is a composited transform on the view, which
 * is both the cheapest thing here and the only one that needs no GPU program,
 * so this is also what a device whose shader would not compile gets.
 */
function CrossfadeOverlay({
  image,
  progress,
  size,
}: {
  image: SkImage;
  progress: SharedValue<number>;
  size: ReskinSize;
}) {
  const style = useAnimatedStyle(() => ({ opacity: 1 - progress.value }));
  return (
    <Animated.View style={[styles.overlay, style]}>
      <Canvas style={styles.overlay}>
        <SkiaImage fit="cover" height={size.height} image={image} width={size.width} x={0} y={0} />
      </Canvas>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  surface: { flex: 1 },
  /**
   * Above the app's own floating furniture -- the update banner sits at 100,
   * the notification host at 90 -- because a banner drawn over the photograph
   * would be one piece of the new interface arriving early, which is the whole
   * defect this module exists to remove. Below the launch overlay's 10_000,
   * which outranks everything by right: an opening is not something a re-skin
   * may paint over.
   */
  cover: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    elevation: 9_000,
    zIndex: 9_000,
  },
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
});
