import { useThemeTokens } from '@osuki-dev/ui';
import { create } from 'zustand';
import {
  Canvas,
  ColorShader,
  Fill,
  Image as SkiaImage,
  ImageShader,
  Shader,
  Skia,
  TileMode,
  useCanvasRef,
  type SkImage,
} from 'react-native-skia';
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
  type ViewInstance,
} from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
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
import { disposeViewPhotograph, photographView } from '@/lib/view-photograph';
import {
  denormalizeOrigin,
  halftoneCell,
  halftoneFront,
  halftoneReach,
  normalizeOrigin,
  recordSnapshotCost,
  veilWhenUnphotographed,
  reskinBlocksTouches,
  resolveOrigin,
  rippleDepth,
  rippleFront,
  rippleReach,
  scanFront,
  scanReach,
  selectReskinPlay,
  shouldAttemptSnapshot,
  snapshotBudget,
  snapshotOutcome,
  washFront,
  washGeometry,
  type ReskinPlay,
  type SnapshotOutcome,
  type WashGeometry,
} from '@/lib/reskin-geometry';
import {
  FONT_HALFTONE_EFFECT,
  FONT_SCAN_EFFECT,
  HALFTONE_BAND,
  THEME_RIPPLE_EFFECT,
  THEME_WASH_EFFECT,
  WASH_BLEED,
  fontHalftoneUniforms,
  fontScanUniforms,
  themeRippleUniforms,
  themeWashUniforms,
  type ReskinPoint,
  type ReskinSize,
} from '@/lib/reskin-shaders';
import { recoverWith, rethrow, settleAfter } from '@/lib/compiler-safe-control-flow';
import { runReskinSwap } from '@/lib/reskin-swap';
import { createCoverReadiness, waitForThemeRender } from '@/lib/theme-render-readiness';
import { useSkiaDrawReady } from '@/hooks/use-theme-render-ready';
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
 * So the app photographs the old screen (see {@link photograph}), holds the
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
 * cover a form sheet, and a snapshot of a root ref does not photograph one.
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
 * Theme changes start the ripple on the live old surface, then prepare the
 * new artwork before activating it under a real photograph. An unavailable
 * photograph leaves the live screen visible; a blank paper veil is never a
 * substitute for a theme snapshot. Native theme routes register their own
 * surfaces so feedback starts where the reader tapped, before dismissal.
 *
 * A theme applied from the editor or the file viewer lands on Home, a screen
 * the run did not start on. Its cover is handed to the root surface before the
 * leaving screen unmounts, the routes change without transitions under it,
 * and the reveal plays on Home: see `ReskinRunOptions.handoff`.
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
  /** Prepare assets while the old interface and its ripple remain visible. */
  prepare?: () => Promise<void | (() => void)>;
  /** A dismissed caller must not activate a theme after its preparation completes. */
  isCurrent?: () => boolean;
  /** The change itself, after preparation and only for the latest request. */
  apply: () => void | Promise<void>;
  /**
   * Navigation that should happen under the cover, after the new theme has
   * painted and before the cover lifts. Closing a sheet in the same turn as
   * `apply` makes the dismissal and the reveal fight -- and so does lifting
   * the cover while the dismissal is still animating, so a settle that
   * returns a promise (`afterNavigationSettles`) holds the cover until the
   * navigation has come to rest, up to `SETTLE_CAP_MS`.
   */
  settle?: () => void | Promise<void>;
  /**
   * Leave the screen the run started on for good, under the cover, before the
   * theme is applied. Used in place of `settle` when the change lands on
   * another screen (an apply from the theme editor or the file viewer goes
   * home), and resolves once that screen has arrived, bounded by
   * `SETTLE_CAP_MS`.
   *
   * The cover is a photograph of the surface the reader was looking at, and
   * that surface is about to unmount with its screen. So the run first hands
   * the photograph to the root surface, waits until the root has drawn it,
   * and only then navigates -- with every route transition switched off
   * (`useReskinActivity().quiet`), because the cover is a picture of the
   * leaving screen and a dismissal sliding it away would show it leaving
   * itself. Home then wears the new theme under the root's copy of that
   * picture, and the reveal is the one move the reader sees.
   */
  handoff?: () => void | Promise<void>;
};

type ActiveRun = {
  id: number;
  preparing?: boolean;
  initiator?: string;
  coverReady?: (surface: string, ready: boolean) => void;
  play: Exclude<ReskinPlay, 'none'>;
  /** A fraction of each surface -- see `resolveOrigin`. */
  origin: ReskinPoint;
  rim: number[];
  wet: number[];
  cell: number;
  shots: ReadonlyMap<string, SkImage>;
  /**
   * Photographs of the *new* interface, per surface, for the ripple to bend.
   * Taken once the change has settled under the cover, on platforms that
   * photograph at all, and only when that second picture lands inside the
   * same budget as the first. Empty is normal: the ripple then lights its
   * rings over the live interface instead of refracting a picture of it.
   */
  next: ReadonlyMap<string, SkImage>;
  /**
   * Whether the cover has to arrive before it can leave. A photograph is the
   * old screen and so is simply there; a veil is not, and fades up first.
   */
  veiled: boolean;
  /** Block only the covered swap, not the reveal of the interactive new theme. */
  swapping: boolean;
};

/** Where a reader last put a finger on a surface, and when. */
type TouchRecord = { point: ReskinPoint; at: number } | null;

type SurfaceEntry = {
  ref: RefObject<ViewInstance | null>;
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
 * `makeRasterImage` because an offscreen surface lives on the context of the
 * thread that made it, and the canvas that will draw this one is on another.
 * Null on any failure, and a null veil is an apply with no effect.
 */
async function makeVeilImage(
  size: ReskinSize,
  paper: string,
  raised: string
): Promise<SkImage | null> {
  try {
    const width = Math.max(1, Math.round(size.width));
    const height = Math.max(1, Math.round(size.height));
    const surface =
      Skia.Surface.MakeOffscreen(width, height) ?? Skia.Surface.MakeRaster(width, height);
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
    const image = await snapshot.makeRasterImage();
    if (image !== snapshot) snapshot.dispose();
    return image;
  } catch {
    return null;
  }
}

const ReskinContext = createContext<ReskinContextValue | null>(null);

/**
 * Whether the re-skin says what it did in the log: which play ran, whether it
 * had its photographs, and what they cost. On in development, and in a release
 * bundle built with `EXPO_PUBLIC_RESKIN_TRACE=1` -- the snapshot costs that
 * decide the Android path are only worth anything measured on a real phone.
 */
const TRACE = __DEV__ || process.env.EXPO_PUBLIC_RESKIN_TRACE === '1';

function trace(message: string): void {
  if (TRACE) console.log(`[reskin] ${message}`);
}

/** What one attempt at photographing the surfaces came back with. */
type Photographs = {
  shots: Map<string, SkImage> | null;
  /** How long the capture took, once it finished; -1 if it never did. */
  ms: number;
  outcome: SnapshotOutcome | 'overtaken';
};

/**
 * Photograph every surface, inside the budget, or come back with nothing.
 *
 * The budget is a race the apply always wins. A snapshot that arrives after it
 * is not waited for and not used -- only released. A capture that lands is
 * scored against `strikes` either way, so a device that cannot do this in
 * time stops being asked; see `SNAPSHOT_STRIKES`.
 */
async function photographSurfaces(
  entries: readonly (readonly [string, SurfaceEntry])[],
  strikes: { current: number },
  stillWanted: () => boolean,
  budgetMs: number,
  keepCompleted = false
): Promise<Photographs> {
  const started = Date.now();
  const capture = Promise.all(
    entries.map(([, entry]) =>
      Promise.resolve()
        .then(() => photograph(entry))
        .catch((): SkImage | null => null)
    )
  );
  const raced = await Promise.race([
    capture,
    new Promise<'slow'>((resolve) => setTimeout(() => resolve('slow'), budgetMs)),
  ]);
  if (raced === 'slow' || !stillWanted()) {
    void capture.then((late) => {
      if (raced === 'slow') trace(`photo arrived late: ${Date.now() - started} ms`);
      release(late);
    });
    return { shots: null, ms: -1, outcome: raced === 'slow' ? 'slow' : 'overtaken' };
  }
  const elapsed = Date.now() - started;
  strikes.current = recordSnapshotCost(strikes.current, elapsed, budgetMs);
  const outcome = snapshotOutcome(
    raced.find((image) => Boolean(image)),
    elapsed,
    budgetMs
  );
  if (outcome !== 'ok' && !(keepCompleted && raced.some(Boolean))) {
    release(raced);
    return { shots: null, ms: elapsed, outcome };
  }
  const shots = bySurface(
    entries.map(([key]) => key),
    keepCompleted ? raced.map(uploadCover) : raced
  );
  return { shots: shots.size > 0 ? shots : null, ms: elapsed, outcome };
}

/** A picture of one surface (`photographView`). */
function photograph(entry: SurfaceEntry): Promise<SkImage | null> {
  const { width, height } = entry.size.current;
  return photographView(entry.ref, width, height);
}

const disposeImage = disposeViewPhotograph;

/** Share the cover's upload with its on-screen and readiness canvases. */
function uploadCover(image: SkImage | null): SkImage | null {
  if (!image) return null;
  try {
    const texture = image.makeTextureImage();
    if (texture !== image) disposeImage(image);
    return texture;
  } catch {
    // A renderer failure takes the bounded live-screen fallback.
    disposeImage(image);
    return null;
  }
}

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
  const doomed = [...new Set(images)];
  afterNextPaint(() => {
    for (const image of doomed) if (image) disposeImage(image);
  });
}

/** Every picture a run holds: the cover, and the new interface if it has one. */
function picturesOf(run: ActiveRun): SkImage[] {
  return [...run.shots.values(), ...run.next.values()];
}

/** Pictures matched back to the surfaces they were taken of; the strays disposed. */
function bySurface(
  keys: readonly string[],
  images: readonly (SkImage | null)[]
): Map<string, SkImage> {
  const shots = new Map<string, SkImage>();
  images.forEach((image, index) => {
    const key = keys[index];
    if (image && key) shots.set(key, image);
    else if (image) disposeImage(image);
  });
  return shots;
}

/** How a run takes its cover away: the ripple's clock is linear, the others ease out. */
function eraseTiming(play: Exclude<ReskinPlay, 'none'>) {
  switch (play) {
    case 'crossfade':
      // The one animation in the app that must ignore the reduced-motion
      // setting, because it *is* the accommodation. `ReduceMotion.System`
      // would collapse it to a single frame, which is the hard cut this
      // whole module exists to prevent -- and the cut between two entire
      // colour schemes is the most violent thing it could do to a reader
      // who has asked for less movement.
      return timing(DURATION.short, { reduceMotion: ReduceMotion.Never });
    case 'ripple':
      // Linear, because the ripple eases its own front and settles its own
      // depth (`rippleFront`, `rippleDepth`) on different parts of the clock.
      return {
        duration: RESKIN_MOTION.rippleMs,
        easing: Easing.linear,
        reduceMotion: ReduceMotion.System,
      };
    case 'scan':
      return timing(RESKIN_MOTION.scanMs);
    case 'wash':
      return timing(RESKIN_MOTION.washMs);
    case 'halftone':
      return timing(RESKIN_MOTION.halftoneMs);
  }
}

/** The longest the cover waits on a settle's promise before lifting anyway. */
const SETTLE_CAP_MS = 800;

/** A settle's promise, or nothing, bounded so the cover always lifts. */
async function settled(outcome: void | Promise<void>): Promise<void> {
  if (!outcome) return;
  await Promise.race([
    outcome.catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, SETTLE_CAP_MS)),
  ]);
}

/** The root surface: the one that outlives every screen, so a handed-off cover lives here. */
const ROOT_SURFACE = 'root';

/**
 * Whether a reskin is under way, for the navigator: blurred screens are
 * frozen the rest of the time, and a frozen Home would pay its whole
 * re-render under the new theme during the transition back to it. For the
 * length of a run they thaw and re-render under the cover instead.
 *
 * `quiet` is set while a handed-off run navigates under the root's cover (see
 * `ReskinRunOptions.handoff`): every route then changes without a transition,
 * since the picture on top already shows where the reader is coming from.
 */
export const useReskinActivity = create<{ active: boolean; quiet: boolean }>(() => ({
  active: false,
  quiet: false,
}));

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
  const updateActive = useCallback(
    (next: ActiveRun | null | ((current: ActiveRun | null) => ActiveRun | null)) => {
      const value = typeof next === 'function' ? next(activeRef.current) : next;
      activeRef.current = value;
      setActive(value);
      const activity = useReskinActivity.getState();
      if ((value !== null) !== activity.active || (value === null && activity.quiet))
        useReskinActivity.setState({ active: value !== null, quiet: false });
    },
    []
  );

  const register = useCallback(
    (id: string, entry: SurfaceEntry) => {
      surfaces.current.set(id, entry);
      return () => {
        surfaces.current.delete(id);
        const current = activeRef.current;
        if (current?.preparing && current.initiator === id) {
          nextId.current += 1;
          updateActive(null);
          release(picturesOf(current));
        }
      };
    },
    [updateActive]
  );

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

  const finish = useCallback(
    (id: number) => {
      const current = activeRef.current;
      if (!current || current.id !== id) return;
      updateActive(null);
      release(picturesOf(current));
    },
    [updateActive]
  );

  const run = useCallback(
    async (options: ReskinRunOptions) => {
      const { kind, apply } = options;
      const id = ++nextId.current;

      // Anything already on screen belongs to a run the reader has overtaken.
      const previous = activeRef.current;
      if (previous) {
        cancelAnimation(progress);
        cancelAnimation(veil);
        updateActive(null);
        release(picturesOf(previous));
      }

      const entries = [...surfaces.current.entries()].filter(
        ([, entry]) => entry.size.current.width > 0 && entry.size.current.height > 0
      );
      if (entries.length === 0) {
        await runReskinSwap({
          prepare: options.prepare,
          cover: async () => {},
          apply: async () => {
            await settled(options.handoff?.());
            await apply();
            options.settle?.();
          },
          painted: async () => {},
          reveal: () => {},
          current: () => id === nextId.current && options.isCurrent?.() !== false,
        });
        return;
      }

      const play = (size: ReskinSize) =>
        selectReskinPlay({
          kind,
          reduceMotion,
          effectReady: Boolean(kind === 'theme' ? THEME_RIPPLE_EFFECT : FONT_SCAN_EFFECT),
          fallbackReady: Boolean(kind === 'theme' ? THEME_WASH_EFFECT : FONT_HALFTONE_EFFECT),
          snapshot: 'ok',
          size,
        });

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

      const chosen = play(entries[entries.length - 1]?.[1].size.current ?? { width: 0, height: 0 });
      if (chosen === 'none') {
        await runReskinSwap({
          prepare: options.prepare,
          cover: async () => {},
          apply: async () => {
            await settled(options.handoff?.());
            await apply();
            options.settle?.();
          },
          painted: async () => {},
          reveal: () => {},
          current: () => id === nextId.current && options.isCurrent?.() !== false,
        });
        return;
      }
      let applied = false;
      const stillWanted = () =>
        id === nextId.current && (applied || options.isCurrent?.() !== false);
      const budget = snapshotBudget(Platform.OS, chosen);
      // On Android only the topmost surface is photographed: it is the one the
      // reader is looking at (a font sheet covers the app behind it), and a
      // second full-window capture there is the difference between landing
      // inside the budget and not.
      const targets = Platform.OS === 'android' ? entries.slice(-1) : entries;

      /** Take the cover away: the same last beat for a photograph and a veil. */
      const erase = (photographed: boolean) => {
        afterNextPaint(() => {
          if (!stillWanted()) return;
          updateActive((current) =>
            current?.id === id && current.swapping ? { ...current, swapping: false } : current
          );
          const start = (mode: string) => {
            if (!stillWanted()) return;
            trace(`${chosen} runs (${mode})`);
            progress.set(
              withTiming(1, eraseTiming(chosen), (done) => {
                'worklet';
                if (done) runOnJS(finish)(id);
              })
            );
          };
          // The ripple bends the new interface as well as the old, so it wants
          // a picture of the new one too -- taken now, once the change has
          // settled under the cover, on the same budget and strikes as the
          // first. Without it the ripple still runs, lit over the live view.
          if (chosen !== 'ripple' || !photographed || budget === null) {
            start(photographed ? 'photo' : 'veil');
            return;
          }
          if (!shouldAttemptSnapshot(strikes.current)) {
            start('photo, live inside: strikes');
            return;
          }
          void photographSurfaces(targets, strikes, stillWanted, budget).then((taken) => {
            const { shots: next } = taken;
            if (next && stillWanted()) {
              updateActive((current) => (current?.id === id ? { ...current, next } : current));
            } else if (next) {
              release(next.values());
            }
            start(
              next
                ? `refract; new-UI photo ${taken.ms} ms`
                : `photo, live inside; new-UI photo ${taken.outcome} ${taken.ms} ms`
            );
          });
        });
      };

      const accent = colorVector(options.accent ?? paint.current.primary);
      const base = {
        id,
        initiator: entries.at(-1)?.[0],
        play: chosen,
        origin: resolveOrigin(options.origin ?? sniffOrigin(), kind),
        rim: accent,
        wet: dampen(accent),
        cell: halftoneCell(paint.current.body),
        next: new Map<string, SkImage>(),
      };

      if (kind === 'theme') {
        // Start on the live old screen, including the native theme sheet. A
        // missing/slow snapshot must never be replaced by an opaque blank veil.
        progress.set(0);
        veil.set(1);
        updateActive({ ...base, shots: new Map(), veiled: false, swapping: true, preparing: true });
        if (chosen === 'ripple')
          progress.set(withTiming(0.18, { duration: 180, easing: Easing.linear }));
        const painted = () => new Promise<void>((resolve) => afterNextPaint(resolve));
        /**
         * Move the cover to the root surface and leave under it; see
         * `ReskinRunOptions.handoff`. The root draws the same photograph with
         * `fit="cover"`, so a source surface of another size (a full-screen
         * modal against the root window, an iPad's safe areas) still covers
         * the root edge to edge rather than letterboxing.
         */
        const handOff = async (leave: () => void | Promise<void>) => {
          const current = activeRef.current;
          if (current?.id !== id) return;
          const source = current.initiator;
          const image = source ? current.shots.get(source) : undefined;
          let covered = false;
          if (image && source === ROOT_SURFACE) {
            covered = true;
          } else if (image) {
            const root = createCoverReadiness([ROOT_SURFACE]);
            updateActive((run) =>
              run?.id === id
                ? {
                    ...run,
                    // The root now owns the run: the leaving screen's surface
                    // unregistering must not cancel it.
                    initiator: ROOT_SURFACE,
                    shots: new Map([...run.shots, [ROOT_SURFACE, image]]),
                    coverReady: root.complete,
                  }
                : run
            );
            covered = await root.promise;
            trace(`root cover handoff ${covered ? 'ready' : 'failed or timed out'}`);
            // A late draw must not bring the old screen back over Home. The
            // image stays with its source surface, which releases it.
            if (!covered)
              updateActive((run) => {
                if (run?.id !== id) return run;
                const shots = new Map(run.shots);
                shots.delete(ROOT_SURFACE);
                return { ...run, shots, coverReady: undefined };
              });
          } else {
            updateActive((run) => (run?.id === id ? { ...run, initiator: ROOT_SURFACE } : run));
          }
          if (!stillWanted()) return;
          // Without a drawn cover a transition-less navigation would be a hard
          // cut, so the routes keep their own transitions.
          if (covered) {
            useReskinActivity.setState({ quiet: true });
            // The options reach the native screens in the next commit.
            await painted();
            await painted();
          }
          if (stillWanted()) await settled(leave());
        };
        await settleAfter(
          () =>
            recoverWith(
              async () => {
                // Let the UI-thread ripple paint before capture or decoding can occupy JS.
                await painted();
                if (!stillWanted()) return;
                await runReskinSwap({
                  current: stillWanted,
                  prepare: options.prepare,
                  cover: async () => {
                    // Capture before preparing assets. The old screen stays live
                    // until every cover has submitted its image to Skia.
                    // Only the surface the reader is looking at. Photographing Home
                    // underneath the sheet made the capture slower and showed
                    // Home through the ripple while the sheet was still leaving.
                    const taken = await photographSurfaces(
                      entries.slice(-1),
                      strikes,
                      stillWanted,
                      3000,
                      true
                    );
                    if (taken.shots && stillWanted()) {
                      const cover = createCoverReadiness(taken.shots.keys());
                      updateActive((current) =>
                        current?.id === id
                          ? {
                              ...current,
                              shots: taken.shots ?? new Map(),
                              coverReady: cover.complete,
                            }
                          : current
                      );
                      const ready = await cover.promise;
                      trace(`theme cover draw ${ready ? 'ready' : 'failed or timed out'}`);
                      if (!ready && stillWanted()) {
                        // Unmount failed covers before applying. A late GPU upload
                        // must not bring the old screen back over the new one.
                        updateActive((current) =>
                          current?.id === id
                            ? { ...current, shots: new Map(), coverReady: undefined }
                            : current
                        );
                        release(taken.shots.values());
                      }
                      await painted();
                    } else if (taken.shots) release(taken.shots.values());
                  },
                  apply: async () => {
                    if (options.handoff) await handOff(options.handoff);
                    if (!stillWanted()) return;
                    applied = true;
                    updateActive((current) =>
                      current?.id === id ? { ...current, preparing: false } : current
                    );
                    await apply();
                  },
                  painted: async () => {
                    await painted();
                    const ready = await waitForThemeRender();
                    trace(`theme renderers ${ready ? 'ready' : 'timed out'}`);
                    await painted();
                    if (stillWanted()) await settled(options.settle?.());
                    await painted();
                  },
                  reveal: () => {
                    updateActive((current) =>
                      current?.id === id ? { ...current, swapping: false } : current
                    );
                    progress.set(
                      withTiming(1, eraseTiming(chosen), (done) => {
                        'worklet';
                        if (done) runOnJS(finish)(id);
                      })
                    );
                  },
                });
              },
              (error) => {
                finish(id);
                return rethrow(error);
              }
            ),
          () => {
            if (!stillWanted()) finish(id);
          }
        );
        return;
      }

      // A device that has already shown it cannot photograph itself in time is
      // not asked again: the picture is the expensive half, and taking one we
      // know we will discard would only make the setting slower to land.
      let shots: Map<string, SkImage> | null = null;
      if (budget !== null && shouldAttemptSnapshot(strikes.current)) {
        const taken = await photographSurfaces(targets, strikes, stillWanted, budget);
        trace(`old-UI photo ${taken.outcome} ${taken.ms} ms (budget ${budget} ms)`);
        if (!stillWanted()) {
          if (taken.shots) release(taken.shots.values());
          return;
        }
        shots = taken.shots;
      } else if (budget !== null) {
        trace('old-UI photo skipped: strikes');
      }

      if (shots) {
        progress.set(0);
        veil.set(1);
        // The cover goes up first; the setting changes under it. The origin is
        // where the reader last touched, on whichever surface they touched: a
        // finger is a better record of what was tapped than a row component's
        // idea of where it is.
        updateActive({ ...base, shots, veiled: false, swapping: false });
        // Not in the same commit as the apply: a Skia canvas does not paint
        // in the commit that mounts it -- its picture is recorded after the
        // commit and handed to the UI thread a frame or more later. Measured on Android, applying a
        // theme in that same commit kept the JS thread busy long enough that
        // the live, half-repainted interface showed for some 300 ms before the
        // photograph arrived over it. So the cover gets two frames to paint
        // before the change it is covering is made.
        await new Promise<void>((resolve) => afterNextPaint(() => afterNextPaint(resolve)));
        if (!stillWanted()) return;
        try {
          await apply();
        } catch (error) {
          finish(id);
          throw error;
        }
        erase(true);
        return;
      }

      if (!veilWhenUnphotographed(Platform.OS, chosen)) {
        // A platform that photographs and could not, for a play that is no
        // more than a dissolve without its picture: no transition at all.
        await apply();
        return;
      }

      const veils = new Map<string, SkImage>();
      for (const [key, entry] of entries) {
        const image = await makeVeilImage(
          entry.size.current,
          paint.current.paper,
          paint.current.raised
        );
        if (image) veils.set(key, image);
      }
      if (!stillWanted()) {
        release(veils.values());
        return;
      }
      if (veils.size === 0) {
        await apply();
        return;
      }

      progress.set(0);
      veil.set(0);
      updateActive({ ...base, shots: veils, veiled: true, swapping: true });

      // The veil comes up over the old interface, the change lands under it
      // once it is opaque, and only then does the front take it away. It has
      // to be opaque first: the re-skin commits over several frames, and a
      // veil that was still fading would show the half-painted interface
      // through it. So the hold is as short as it can honestly be -- a tenth
      // of a second of fade, then the apply's own commit.
      await new Promise<void>((resolve) => {
        const covered = () => resolve();
        afterNextPaint(() => {
          veil.set(
            withTiming(
              1,
              timing(RESKIN_MOTION.veilMs, { reduceMotion: ReduceMotion.Never }),
              () => {
                'worklet';
                runOnJS(covered)();
              }
            )
          );
        });
      });
      if (!stillWanted()) return;
      try {
        await apply();
      } catch (error) {
        finish(id);
        throw error;
      }
      if (stillWanted()) erase(false);
    },
    [finish, progress, reduceMotion, veil, updateActive]
  );

  // A run still on screen when the tree goes away would otherwise take its
  // textures with it.
  useEffect(
    () => () => {
      nextId.current += 1;
      cancelAnimation(progress);
      cancelAnimation(veil);
      const current = activeRef.current;
      activeRef.current = null;
      if (current) release(picturesOf(current));
    },
    [progress, veil]
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
    await runReskinSwap({
      prepare: options.prepare,
      cover: async () => {},
      apply: async () => {
        await settled(options.handoff?.());
        await options.apply();
        options.settle?.();
      },
      painted: async () => {},
      reveal: () => {},
      current: () => options.isCurrent?.() !== false,
    });
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
  const ref = useRef<ViewInstance>(null);
  const frame = useRef<ViewInstance>(null);
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
    // `pageX`/`pageY`, not `locationX`/`locationY`: the location is relative
    // to whichever child the finger landed on -- a segmented control's "Light"
    // reads as a few points from the top-left -- so every run came from the
    // corner. The page point is made relative to this surface once the
    // surface has said where it is, which lands long before the tap's
    // release starts a run.
    const { pageX, pageY } = event.nativeEvent;
    const at = Date.now();
    touch.current = { point: { x: pageX, y: pageY }, at };
    frame.current?.measure((_x, _y, _width, _height, left, top) => {
      if (touch.current?.at !== at || !Number.isFinite(left) || !Number.isFinite(top)) return;
      touch.current = { point: { x: pageX - left, y: pageY - top }, at };
    });
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

  // The photographed view is the content alone, with the overlay beside it
  // rather than inside it: the ripple's second picture is taken while the
  // cover is still up, and must be of the new interface, not of the cover.
  return (
    <View
      collapsable={false}
      onLayout={onLayout}
      onStartShouldSetResponderCapture={noteTouch}
      ref={frame}
      style={styles.surface}>
      <View collapsable={false} ref={ref} style={styles.surface}>
        {children}
      </View>
      {active &&
      (image || active.preparing || active.play === 'ripple') &&
      measured.width > 0 &&
      context ? (
        <ReskinOverlay
          image={image}
          onReady={(ready) => active.coverReady?.(id, ready)}
          key={`${active.id}:${image ? 'captured' : 'live'}`}
          next={active.next.get(id) ?? null}
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
 * while the scan (or halftone) is up the live rows underneath have already
 * shifted and the photograph is the only thing still showing them where they
 * were. A tap would hit whatever slid under the finger, which is worse than
 * no tap at all, so the scan swallows them for its two thirds of a second.
 *
 * Neither choice delays the apply; both are over in well under a second.
 */
function ReskinOverlay({
  image,
  onReady,
  next,
  progress,
  run,
  size,
  veil,
}: {
  image: SkImage | null;
  onReady: (ready: boolean) => void;
  next: SkImage | null;
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
      pointerEvents={reskinBlocksTouches(run.play, run.swapping) ? 'auto' : 'none'}
      style={[styles.cover, arriving]}>
      {run.play === 'ripple' ? (
        <RippleOverlay
          image={image}
          onReady={onReady}
          next={next}
          origin={origin}
          progress={progress}
          run={run}
          size={size}
        />
      ) : !image ? null : run.play === 'scan' ? (
        <ScanOverlay image={image} origin={origin} progress={progress} run={run} size={size} />
      ) : run.play === 'wash' ? (
        <WashOverlay
          image={image}
          onReady={onReady}
          origin={origin}
          progress={progress}
          run={run}
          size={size}
        />
      ) : run.play === 'halftone' ? (
        <HalftoneOverlay image={image} origin={origin} progress={progress} run={run} size={size} />
      ) : (
        <CrossfadeOverlay image={image} onReady={onReady} progress={progress} size={size} />
      )}
    </Animated.View>
  );
}

function WashOverlay({
  image,
  onReady,
  origin,
  progress,
  run,
  size,
}: {
  image: SkImage;
  onReady: (ready: boolean) => void;
  origin: ReskinPoint;
  progress: SharedValue<number>;
  run: ActiveRun;
  size: ReskinSize;
}) {
  const canvas = useCanvasRef();
  useSkiaDrawReady(canvas, image, true, onReady);
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
      <Canvas ref={canvas} style={styles.overlay}>
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
 * The theme ripple. Two child shaders, in declaration order: the cover, then
 * the new interface. With no picture of the new interface the cover is bound
 * twice and `live` tells the program to leave the inside of the front clear.
 */
function RippleOverlay({
  image,
  onReady,
  next,
  origin,
  progress,
  run,
  size,
}: {
  image: SkImage | null;
  onReady: (ready: boolean) => void;
  next: SkImage | null;
  origin: ReskinPoint;
  progress: SharedValue<number>;
  run: ActiveRun;
  size: ReskinSize;
}) {
  const canvas = useCanvasRef();
  useSkiaDrawReady(canvas, image, image !== null, onReady);
  const reach = useMemo(() => rippleReach(origin, size), [origin, size]);
  const live = image === null || (!run.swapping && next === null);

  const uniforms = useDerivedValue(() =>
    themeRippleUniforms({
      origin,
      front: rippleFront(progress.value, reach),
      depth: rippleDepth(progress.value),
      live,
      rim: run.rim,
    })
  );

  const rect = { x: 0, y: 0, width: size.width, height: size.height };
  if (!THEME_RIPPLE_EFFECT) return null;
  return (
    <Canvas ref={canvas} style={styles.overlay}>
      <Fill>
        <Shader source={THEME_RIPPLE_EFFECT} uniforms={uniforms}>
          {image ? (
            <ImageShader fit="cover" image={image} rect={rect} tx="clamp" ty="clamp" />
          ) : (
            <ColorShader color="transparent" />
          )}
          {image ? (
            <ImageShader fit="cover" image={next ?? image} rect={rect} tx="clamp" ty="clamp" />
          ) : (
            <ColorShader color="transparent" />
          )}
        </Shader>
      </Fill>
    </Canvas>
  );
}

/** The font scan: one picture, two bands. */
function ScanOverlay({
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
  const reach = useMemo(() => scanReach(origin, size), [origin, size]);

  const uniforms = useDerivedValue(() =>
    fontScanUniforms({
      originY: origin.y,
      front: scanFront(progress.value, reach),
      tint: run.rim,
    })
  );

  if (!FONT_SCAN_EFFECT) return null;
  return (
    <Canvas style={styles.overlay}>
      <Fill>
        <Shader source={FONT_SCAN_EFFECT} uniforms={uniforms}>
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
  onReady,
  progress,
  size,
}: {
  image: SkImage;
  onReady: (ready: boolean) => void;
  progress: SharedValue<number>;
  size: ReskinSize;
}) {
  const canvas = useCanvasRef();
  useSkiaDrawReady(canvas, image, true, onReady);
  const style = useAnimatedStyle(() => ({ opacity: 1 - progress.value }));
  return (
    <Animated.View style={[styles.overlay, style]}>
      <Canvas ref={canvas} style={styles.overlay}>
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
