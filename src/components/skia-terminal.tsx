import {
  Canvas,
  Fill,
  FontSlant,
  FontWeight,
  Group,
  Picture,
  Rect,
  PaintStyle,
  Skia,
  matchFont,
  rect,
  useFont,
  type SkCanvas,
  type SkFont,
  type SkPaint,
  type SkParagraph,
  type SkPicture,
  type SkRect,
  type SkTypefaceFontProvider,
} from '@shopify/react-native-skia';
import { Button, useThemeTokens, useToast } from '@osuki-dev/ui';
import { Trans, useLingui } from '@lingui/react/macro';

import { LogoLoader } from '@/components/logo-loader';
import { Asset } from 'expo-asset';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  type LayoutChangeEvent,
  PixelRatio,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  default as Animated,
  cancelAnimation,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  withDecay,
  withDelay,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { PressableScale } from '@/components/pressable-scale';
import { useCoalescedValue } from '@/hooks/use-coalesced-value';
import { useFreezeGate, useFrozenValue } from '@/hooks/use-frozen-value';
import { useLatestRef, useResetSignal } from '@/hooks/use-render-refs';
import { latestPillVisible } from '@/lib/dock-presentation';
import { feedback } from '@/lib/feedback';
import { fadeOut, timing, zoomIn, zoomOut } from '@/lib/motion';
import { isSafeExternalLink } from '@/lib/safe-link';
import {
  classifyTwoFingerGesture,
  twoFingerFrame,
  type TabCycleDirection,
  type TwoFingerFrame,
} from '@/lib/tab-swipe';
import { createMMKV } from 'react-native-mmkv';
import { terminalGridFor } from '@/lib/ssh-grid-metrics';
import {
  pinchedTerminalScale,
  terminalFitToWidthScale,
  terminalFontSize,
  terminalOpenScale,
  terminalOpenView,
  terminalPanMinX,
  terminalScaleOnScreenLeave,
  type TerminalPaneScales,
  type TerminalPinchPhase,
  type TerminalTextSize,
} from '@/lib/terminal-text-size';
import {
  nextHeadRecording,
  planTerminalChunks,
  terminalChunkLayoutKey,
  type TerminalChunkPlan,
  type TerminalHeadRecording,
} from '@/terminal/chunk-plan';
import { terminalPaneTheme, type TerminalTheme } from '@/terminal/palette';
import {
  packTerminalTouchModes,
  terminalTouchCellAt,
  terminalTouchDragBytes,
  terminalTouchDragTarget,
  terminalTouchLayer,
  terminalTouchPressBytes,
  terminalTouchPressDrags,
  terminalTouchReleaseBytes,
  terminalTouchTapBytes,
  type TerminalTouchModes,
} from '@/terminal/touch-input';
import { readTerminalSurface } from '@/terminal/surface';
import { useTerminalTheme, useThemePack } from '@/hooks/use-theme-pack';
import {
  TERMINAL_LONG_PRESS_MS,
  TERMINAL_LONG_PRESS_SLOP,
  TERMINAL_SELECTION_OPACITY,
  cellAtViewportPoint,
  lineSelectionAt,
  longPressArms,
  selectAllSelection,
  selectionIsBlank,
  selectionAutoScrollVelocity,
  selectionRects,
  selectionSpans,
  selectionText,
  shiftSelectionRows,
  tabSwipeClearsSelection,
  terminalDragIntent,
  wordSelectionAt,
  type TerminalCellPoint,
  type TerminalSelection,
} from '@/terminal/selection';
import {
  TERMINAL_SWEEP_BATCH,
  TerminalPictureCache,
  freeRecording,
} from '@/terminal/picture-cache';
import {
  terminalFollowsOutput,
  TERMINAL_APPLIED_FRAME_MS,
  TERMINAL_HISTORY_HINT_INTRO_MS,
  captureScrollAnchor,
  clampScrollOffset,
  followCatchUpDurationMs,
  historyHintOpacity,
  measureRowsDropped,
  measureRowsPrepended,
  terminalBottomStop,
  terminalContentRows,
  terminalPullOvershoot,
  terminalRestOffset,
  terminalTopStop,
} from '@/terminal/scroll-anchor';
import { parseTerminalSnapshot, terminalFrameLinks } from '@/terminal/terminal-core';
import type {
  TerminalFrame,
  TerminalLine,
  TerminalLink,
  TerminalRun,
  TerminalStyle,
} from '@/terminal/types';
import {
  TERMINAL_ADVANCE_RATIO,
  TERMINAL_GRID_HORIZONTAL_PADDING,
  TERMINAL_GRID_VERTICAL_PADDING,
  fitFallbackToSpan,
  snapToDevicePixel,
  terminalLineHeight,
  terminalViewportClearance,
} from '@/terminal/text-scale';
import { graphemeWidth, splitGraphemes, substituteRenderedGrapheme } from '@/terminal/unicode';

const horizontalPadding = TERMINAL_GRID_HORIZONTAL_PADDING;
const verticalPadding = TERMINAL_GRID_VERTICAL_PADDING;
const AXIS_UNDECIDED = 0;
const AXIS_HORIZONTAL = 1;
const AXIS_VERTICAL = 2;
/** How far a drag must travel before it commits to an axis. */
const AXIS_LOCK_DISTANCE = 10;
/**
 * Horizontal has to win by this much to take the lock. Vertical is the default
 * because that is what reading a pane is; sideways panning is for the
 * occasional wide line and can afford to be deliberate.
 */
const AXIS_LOCK_BIAS = 1.6;

/**
 * How far a two-finger gesture has to travel before it is considered at all.
 *
 * Only an activation threshold for the recogniser -- whether the travel then
 * meant a swipe, a pinch or nothing is `classifyTwoFingerGesture`'s judgement,
 * against a threshold an order of magnitude larger.
 */
const TWO_FINGER_MIN_DISTANCE = 4;

const terminalFontFamily = 'JetBrainsMono Nerd Font Mono';
const terminalFontFamilies =
  process.env.EXPO_OS === 'ios'
    ? [terminalFontFamily, 'Menlo', 'PingFang SC', 'Apple Color Emoji']
    : [
        terminalFontFamily,
        'Noto Sans Mono CJK SC',
        'Noto Sans CJK SC',
        'Noto Sans SC',
        'sans-serif',
        'Noto Color Emoji',
      ];
const terminalFontSource = require('../../assets/fonts/JetBrainsMonoNerdFontMono-Regular.ttf');

/**
 * Where a pinch is remembered per pane -- see the module comment on
 * `terminal-text-size.ts` for why this lives here instead of there. MMKV,
 * like `shortcut-usage.ts` uses for another per-key, non-secret table that is
 * written far more often than it is read: synchronous and memory-mapped, so
 * neither the read on opening a pane nor the write on leaving the screen costs
 * an await. The same OTA fallback as that file, too -- a binary shipped before
 * the native module existed degrades to remembering nothing across a restart
 * rather than crashing.
 */
type PaneScaleStore = {
  getString: (key: string) => string | undefined;
  set: (key: string, value: string) => void;
};

function openPaneScaleStore(): PaneScaleStore {
  try {
    return createMMKV({ id: 'muqun.terminal-pane-scale' });
  } catch {
    const memory = new Map<string, string>();
    return {
      getString: (key) => memory.get(key),
      set: (key, value) => {
        memory.set(key, value);
      },
    };
  }
}

const PANE_SCALE_STORAGE_KEY = 'muqun.terminal-pane-scale.v1';

/**
 * How long the terminal's measured box must hold still before the grid follows
 * it.
 *
 * Everything downstream of `viewport` is expensive: the content width, the
 * unobstructed height, the clamps that re-run on it, and -- through them -- the
 * recorded picture the canvas draws. That is the right price to pay once, for
 * a size the reader is going to keep. It is the wrong price to pay fifteen
 * times for the fifteen sizes a keyboard passes through on its way up, and a
 * caller that resizes this terminal to animate is not doing anything unusual:
 * an animated height reaches the layout system frame by frame by design.
 *
 * So a resize is committed at the size it settles on rather than at each size
 * on the way there. A quarter-second keyboard becomes one resize, and the grid
 * still ends up exactly where the layout put it. `ssh-terminal-workspace.tsx`
 * settles its own viewport for the same reason and by the same clock -- there
 * it is the PTY on the far side that must not hear about fifteen sizes; here
 * it is the picture.
 */
const VIEWPORT_SETTLE_MS = 100;

let paneScaleStoreInstance: PaneScaleStore | null = null;
function paneScaleStore(): PaneScaleStore {
  if (!paneScaleStoreInstance) paneScaleStoreInstance = openPaneScaleStore();
  return paneScaleStoreInstance;
}

// Loaded once per process and kept here rather than in component state: the
// canvas is deliberately never remounted on a pane switch, but a second
// terminal screen (rare, but the file has no rule against it) would otherwise
// each hold their own copy and the later one to leave would clobber the
// other's write.
let paneScaleCache: TerminalPaneScales | null = null;

function loadPaneScales(): TerminalPaneScales {
  if (paneScaleCache) return paneScaleCache;
  try {
    const raw = paneScaleStore().getString(PANE_SCALE_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    const sanitized: Record<string, number> = {};
    if (parsed && typeof parsed === 'object') {
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value === 'number' && Number.isFinite(value)) sanitized[key] = value;
      }
    }
    paneScaleCache = sanitized;
  } catch {
    paneScaleCache = {};
  }
  return paneScaleCache;
}

function savePaneScales(next: TerminalPaneScales): void {
  paneScaleCache = next;
  try {
    paneScaleStore().set(PANE_SCALE_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Best effort: the in-memory cache still answers the rest of this run: only
    // a future launch loses the pinch.
  }
}

/**
 * The two numbers a caller sizing a PTY to this canvas needs: the measured
 * cell advance and the row pitch, in points. See `onCellMetrics`.
 */
export type TerminalCellMetrics = {
  cellWidth: number;
  lineHeight: number;
};

export function SkiaTerminal({
  output = '',
  frame: frameProp,
  onCellMetrics,
  terminalId,
  bottomInset = 0,
  topInset = 0,
  keyboardOffset,
  textSize = 'default',
  screenRows = 0,
  ownsScreen = false,
  canLoadEarlier = false,
  historyRevision = 0,
  loadingEarlier = false,
  onLoadEarlier,
  historyIndicatorTopInset = 10,
  stickBottomNonce = 0,
  onFileLink,
  onTwoFingerSwipe,
  screenFocused = true,
  paneColumns,
  paneRows,
  paneCursorColumn,
  paneCursorRow,
  touchInput,
}: {
  /**
   * The pane's rendered text, parsed here on every change. What the gateway
   * path passes; a caller that has a `frame` leaves it out.
   */
  output?: string;
  /**
   * A frame from a long-lived emulator -- the SSH shell's -- drawn as it is,
   * with no parse: the emulator already holds its own scrollback, so the frame
   * IS the window and the caller never pages history in. Identity is the
   * version: a new object per change is what re-records the picture, and a
   * held object is what the gesture freeze holds. `output` is ignored while
   * this is set.
   */
  frame?: TerminalFrame;
  /**
   * The measured cell advance and row pitch, reported whenever either
   * changes -- the font loading, a text-size change -- so a caller sizing a
   * PTY can use the canvas's own numbers (see `@/lib/ssh-grid-metrics`).
   */
  onCellMetrics?: (metrics: TerminalCellMetrics) => void;
  terminalId: string;
  bottomInset?: number;
  /**
   * Clearance for the floating header, passed only by a pane running a
   * full-screen program. Zero everywhere else, and zero is the behaviour this
   * had before the prop existed: a pane that prints lines wants its newest
   * output against the bottom and does not care what is over its oldest.
   *
   * An editor is the other case. It paints a screen, its first row is the row
   * being read, and the chrome is drawn edge to edge over the grid -- so without
   * this the first line of every file opened on a phone was behind the back
   * button. See `terminalRestOffset`.
   */
  topInset?: number;
  keyboardOffset?: SharedValue<number>;
  /**
   * The Text size setting, and the only thing that decides how big the text is
   * when a pane opens. Taken as the setting rather than as a point size so the
   * pinch indicator can name it, and so there is one place -- not one per
   * screen -- where the setting becomes a number.
   */
  textSize?: TerminalTextSize;
  /**
   * How many rows of the content are the live screen -- the pane's own
   * viewport, as the gateway reports it. Only meaningful together with
   * `topInset`: a full-screen program repaints exactly its viewport, so the
   * last `screenRows` rows of the window are the screen and everything above
   * them is the ring-buffer history the gateway kept. The rest anchor needs
   * the distinction (see `terminalRestOffset`); nothing else here does. 0
   * means unknown, which reads as "the whole content is screen" -- the world
   * before the gateway kept history for these panes.
   */
  screenRows?: number;
  /**
   * Whether the pane's program owns the whole screen -- an editor rather than a
   * shell. The gateway's answer, resolved once by the screen (see
   * `isFullScreenTuiPane`) because four other decisions hang off the same fact.
   *
   * Here it is the permission to stop resolving this pane's defaults against
   * the app theme: a program that owns the screen and paints in 24-bit colour
   * gets the surface it painted instead. See `terminalPaneTheme`.
   */
  ownsScreen?: boolean;
  canLoadEarlier?: boolean;
  historyRevision?: number;
  loadingEarlier?: boolean;
  onLoadEarlier?: () => void;
  historyIndicatorTopInset?: number;
  /** Bumping this snaps to the latest line -- used after sending input. */
  stickBottomNonce?: number;
  /**
   * A tapped file path. Handed up rather than opened here: resolving a path to
   * an artifact is a session concern, and the terminal knows nothing about the
   * session it is rendering.
   */
  onFileLink?: (path: string) => void;
  /**
   * A two-finger swipe across the pane, which the screen answers by cycling the
   * workspace's tabs. Recognised here rather than by the screen because
   * gesture-handler cancels React Native's touch stream for everything under an
   * active gesture -- the whole story is in `useTabSwipe` -- and because the
   * pinch this has to be told apart from is one of the gestures below.
   */
  onTwoFingerSwipe?: (direction: TabCycleDirection) => void;
  /**
   * False while the screen this pane is on is not the one in front.
   *
   * The pinch is a look at the session in front of you and ends with it. The
   * canvas is deliberately never remounted on a pane switch, so nothing about
   * the component's lifetime would reset the zoom on its own; the screen losing
   * focus is the moment, and it is the right one because the pane is off screen
   * while the size changes back.
   */
  screenFocused?: boolean;
  /**
   * The pane's own width, as the gateway reports it (`pane.raw.width`) --
   * columns, not points. The authoritative answer to how wide the grid is;
   * without it the parser has to infer one from the widest line it happened to
   * receive, clamped to a constant far narrower than a large monitor's pane.
   * `undefined` for demo mode and older gateways that do not report it, which
   * leaves the parser on that inference exactly as before.
   */
  paneColumns?: number;
  /**
   * The pane's own height, as the gateway reports it. Used for two things and
   * only for a pane that owns the screen: it floors the parsed frame so an
   * editor's grid is the pane's rather than the read's line count, and it is
   * one input to where the pane opens (`terminalOpenView`). Absent on a gateway
   * that does not report it, which is every herdr pane today.
   */
  paneRows?: number;
  /** The program's cursor, when the gateway reports one. Both or neither. */
  paneCursorColumn?: number;
  paneCursorRow?: number;
  /**
   * The far side's input channel, for a pane whose program has asked to hear
   * about the pointer. Left out by a caller that has no such channel -- the
   * gateway path, where the output arrives already rendered and the modes a
   * program set are not in it -- and leaving it out is exactly the behaviour
   * this component had before: every touch is muqun's own.
   *
   * `modes` is the emulator's live answer, re-read on every frame it publishes;
   * `rows` is the PTY's row count, which is what turns a row of the drawn
   * frame into a row of the live screen (see `terminalTouchCellAt`).
   */
  touchInput?: {
    modes: TerminalTouchModes;
    rows: number;
    send: (bytes: Uint8Array) => void;
  };
}) {
  const fontSize = terminalFontSize(textSize);
  const theme = useThemeTokens();
  const { t } = useLingui();
  const { showToast } = useToast();
  // Follows the theme pack, both halves of it: a light terminal in light mode,
  // dark in dark, in whichever palette is selected. Agent 24-bit colours are
  // tuned for a dark background, so they read best in dark mode, but forcing
  // the whole surface dark under a light app was more jarring than a slightly
  // muted checkmark.
  //
  // That trade still holds for a pane that *prints* -- an agent's output lands
  // on the app's surface and the app is entitled to it. It does not hold for a
  // pane that repaints a screen of its own; `paneTheme` below is where the two
  // part company, and the pack is kept here so it has both halves to choose
  // from rather than only the one the app is wearing.
  const terminalTheme = useTerminalTheme();
  const themePack = useThemePack();
  const [fontUri, setFontUri] = useState<string | null>(null);
  const [fontError, setFontError] = useState<string | null>(null);
  const [following, setFollowing] = useState(true);
  const loadedFont = useFont(fontUri, fontSize, (error) => setFontError(error.message));
  // Every measurement in this file -- the cell advance, each glyph's advance --
  // has to be the font's *real* advance, not the hinted one. An SkFont reports
  // integer-rounded advances unless linear metrics are on, and rounding a 0.6em
  // advance to whole points is what breaks the grid: at 14pt the true advance is
  // 8.4pt and the hinted one is 8.0, so every cell is 4.8% narrower than the
  // glyphs drawn into it. Set once, here, so the cell width and the per-glyph
  // advance below can never be measured under different rules.
  //
  // Drawing is unaffected: `drawGlyphs` is handed an explicit position for every
  // glyph, so the font's own advance never moves anything. This changes what the
  // font *reports*, not what it paints.
  const nerdFont = useMemo(() => {
    loadedFont?.setLinearMetrics(true);
    return loadedFont;
  }, [loadedFont]);
  const fontManager = useMemo(() => {
    const typeface = nerdFont?.getTypeface();
    if (!typeface) return null;
    const provider = Skia.TypefaceFontProvider.Make();
    provider.registerFont(typeface, terminalFontFamily);
    return provider;
  }, [nerdFont]);
  const lineHeight = terminalLineHeight(fontSize);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  /** The settle timer behind `handleLayout`, and whether a first size has landed. */
  const viewportSettleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewportMeasuredRef = useRef(false);
  useEffect(
    () => () => {
      if (viewportSettleRef.current) clearTimeout(viewportSettleRef.current);
    },
    []
  );
  // Parsing + re-recording the picture is the expensive part of an output
  // burst, so it runs off a coalesced snapshot (leading + trailing, ~100ms) --
  // keyed on terminalId so a pane switch flushes at once. The raw `output` prop
  // is still used below only for the empty/loading check. historyRevision
  // travels inside the same snapshot because the anchor effect below matches a
  // revision bump against the row delta of the same frame: a revision arriving
  // ahead of its coalesced output would see zero added rows and silently skip
  // the scroll compensation for prepended history.
  const snapshot = useMemo(
    () => ({ output, frame: frameProp, historyRevision }),
    [frameProp, historyRevision, output]
  );
  // Interaction freeze. While a finger owns the pane -- or the fling it let go
  // of is still coasting -- new snapshots are not applied at all: the frame on
  // screen stays exactly the one that was there when the gesture began.
  //
  // Snapping the translation to device pixels stopped the glyphs re-rasterising
  // at a new subpixel phase every frame, but it cannot help with the other half
  // of the problem: during a stream the grid itself is being re-laid-out several
  // times a second, and rows appearing, scrolling and being trimmed off the top
  // move the very glyphs the reader is tracking with their thumb. Two unrelated
  // motions on the same axis do not separate visually -- they read as the text
  // swimming rather than as the page sliding, which is the nausea Ellen
  // reported. Frozen, the pane under the finger is a still image and the only
  // thing moving is the drag.
  //
  // Nothing is dropped by holding: the newest snapshot is a prop, so the render
  // that clears the freeze is handed it and applies it in one step.
  //
  // The gate closes without a render of its own (see `useFreezeGate`), because
  // the window it used to take to close was the window a burst arrived in.
  const gate = useFreezeGate();
  // Held on both sides of the coalescer. Ahead of it so a held snapshot keeps
  // its identity and nothing downstream re-parses, re-records or re-renders
  // while the gesture runs; behind it because the coalescer owns a trailing
  // timer that was scheduled before the gate closed, and that timer publishes
  // whatever was newest when it was set -- a frame the gesture was supposed to
  // hold, arriving up to a window late, in the middle of the drag.
  const held = useFrozenValue(snapshot, gate.frozen, terminalId);
  const coalesced = useCoalescedValue(held, terminalId, TERMINAL_APPLIED_FRAME_MS);
  const applied = useFrozenValue(coalesced, gate.frozen, terminalId);
  const coalescedOutput = applied.output;
  const appliedFrame = applied.frame;
  const coalescedRevision = applied.historyRevision;
  // What the effects below key an applied frame on: the frame when a caller
  // supplies one, the text otherwise -- so the gateway path keys on exactly
  // what it keyed on before frames could be handed in.
  const appliedContent: unknown = appliedFrame ?? coalescedOutput;
  // Whether there is anything to draw yet, for the loader and the caret. A
  // supplied frame counts even when it is empty: the emulator behind it is
  // the screen, and a screen exists before anything is printed on it.
  const hasOutput = output !== '' || frameProp !== undefined;
  // Parsed from the snapshot exactly as it arrived -- or taken as it is from
  // the emulator that supplied it. Glyphs the bundled font cannot draw are
  // swapped at the moment they are drawn (see `substituteRenderedGrapheme`)
  // rather than here, so the cells hold the text the agent printed -- which is
  // what the clipboard has to be given.
  const frame = useMemo(
    () =>
      appliedFrame ??
      // The pane's rows are handed to the parse only for a program that owns
      // the screen. An editor's frame IS its grid, so a read one line short of
      // the pane would otherwise put the pane's last row somewhere it is not.
      // A shell's frame is a tail of a stream and has no height to be wrong
      // about, so it keeps the arithmetic it has always had. Rows are a floor
      // rather than a size (see `parseTerminalSnapshot`), so the scrollback a
      // read carries above the screen still arrives whole.
      parseTerminalSnapshot(
        coalescedOutput,
        terminalTheme,
        paneColumns,
        ownsScreen ? paneRows : undefined
      ),
    [appliedFrame, coalescedOutput, terminalTheme, paneColumns, paneRows, ownsScreen]
  );
  // The pane's own colours, which are the app's unless the frame says the
  // program owns the screen and is painting in colours we never named. The
  // whole argument is on `terminalPaneTheme`; what matters here is that this is
  // the theme *everything below draws with* -- the canvas fill, the run
  // backgrounds, the cursor, the block cache's key. Only the parse above stays
  // on `terminalTheme`, and deliberately: the surface is read off the frame, so
  // feeding it back into the parse would be a cycle, and it would cost a second
  // full parse per snapshot to break. It buys nothing either, because a pane
  // this applies to is by definition one whose colours did not come from the
  // sixteen slots the parse resolves.
  //
  // A shell or an agent pane never reads its frame at all: `ownsScreen` gates
  // the scan, not just its answer, so every pane that had no bug pays nothing
  // for the fix. Measured on the repro capture (64x242, 104 runs) the scan is
  // 0.054 ms against the 2.24 ms parse standing beside it -- 2.4% -- so even
  // the panes that do run it are not paying for it in any way a frame notices.
  const paneTheme = useMemo(() => {
    if (!ownsScreen) return terminalTheme;
    return terminalPaneTheme(
      themePack,
      terminalTheme,
      readTerminalSurface(frame, screenRows),
      true
    );
  }, [frame, ownsScreen, screenRows, terminalTheme, themePack]);
  const links = useMemo(() => terminalFrameLinks(frame), [frame]);
  const cellWidth = useMemo(
    () => measureCellWidth(fontSize, fontManager, nerdFont),
    [fontManager, fontSize, nerdFont]
  );
  useEffect(() => {
    onCellMetrics?.({ cellWidth, lineHeight });
  }, [cellWidth, lineHeight, onCellMetrics]);
  // The pane's own drawn width: its columns, plus the padding the grid keeps at
  // each edge. Kept beside `contentWidth` rather than folded into it, because
  // the two are wanted for different things. `contentWidth` is this floored at
  // the viewport, so a pane narrower than the screen still records and draws
  // onto a full-width surface; the pan wants the unfloored number, or a pane
  // scaled up to fit could be dragged sideways past the end of its own text
  // (see `terminalPanMinX`). For every pane at least as wide as the viewport --
  // which is every pane the fit does not touch -- they are the same number and
  // nothing downstream can tell them apart.
  const textWidth = frame.columns * cellWidth + horizontalPadding * 2;
  const contentWidth = Math.max(viewport.width, textWidth);
  const contentWidthRef = useRef(contentWidth);
  // `terminalContentRows`, not `frame.lines.length`: a freshly opened pane's
  // frame is one prompt line and the rest of the pane's rows blank beneath it
  // (see that function), and resting against the raw row count rests the pane
  // at the bottom of the blank tail instead of at the bottom of the text.
  const contentHeight = Math.max(
    lineHeight + verticalPadding * 2,
    terminalContentRows(frame.lines) * lineHeight + verticalPadding * 2
  );
  // A terminal grows upward from the bottom of the screen, so the resting
  // position is always `visibleHeight - contentHeight`: negative once the
  // output is taller than the viewport, positive while it is still short. Both
  // cases are the same expression, which is why nothing here clamps it to 0.

  // The height of the ring-buffer history sitting above the live screen, at
  // scale 1 -- worklets multiply by the live scale themselves. Zero unless the
  // gateway said how tall the screen is AND the content is taller than it,
  // which keeps every ordinary pane, and every editor against an old gateway,
  // on exactly the arithmetic they had.
  const historyHeight =
    screenRows > 0 ? Math.max(0, frame.lines.length - screenRows) * lineHeight : 0;

  // The parameters a block's pixels depend on that are not part of its rows.
  // The font provider is rebuilt from `nerdFont` and never outlives it, so the
  // font's identity stands for both.
  const chunkLayoutKey = useMemo(
    () =>
      terminalChunkLayoutKey({
        cellWidth,
        fontSize,
        lineHeight,
        contentWidth,
        themeId: renderingIdentity(paneTheme),
        fontId: renderingIdentity(nerdFont),
      }),
    [cellWidth, contentWidth, fontSize, lineHeight, nerdFont, paneTheme]
  );

  // Recorded blocks by content key, kept across refreshes: this is the whole
  // point of the chunking. The key is the rows, never their position, so a block
  // the stream has pushed a row up the pane is found here and re-drawn at its
  // new offset instead of re-recorded.
  //
  // Which block may be freed, and when, is `TerminalPictureCache`'s single rule
  // and its file has the argument. All that matters here: **the render phase
  // only reads and adds.** It retires nothing and frees nothing, because a
  // render is a proposal -- React discards them routinely, and the compiler is
  // on -- and a proposal must not be able to take a display list away from the
  // frame that is actually on screen. Held in state rather than a ref so the
  // recording below, which has to read it while it renders, is not reaching into
  // a ref mid-render.
  const [chunkCache] = useState(() => new TerminalPictureCache<SkPicture>());
  // The recording covering the top of the pane, with the rows it was made from.
  // A window that drops a row off the top leaves the head block holding a suffix
  // of what is already recorded, and this is what lets the planner see that.
  // Written by the commit effect below, from the frame that was committed.
  const [headBox] = useState<{ current: TerminalHeadRecording | undefined }>(() => ({
    current: undefined,
  }));
  const chunkFrame = useMemo(() => {
    if (!nerdFont) return noChunkFrame;
    // Read once, at the top: the plan and the head it produces are two answers
    // about the same starting point, and re-reading between them would let a
    // commit landing mid-render answer them from different frames.
    const previousHead = headBox.current;
    const plans = planTerminalChunks(
      frame.lines,
      chunkLayoutKey,
      (key) => chunkCache.has(key),
      previousHead
    );
    const linksByChunk = bucketLinksByChunk(links, plans);
    const draws = plans.map((plan) => {
      // `add` hands back whatever the cache already holds under the key, so a
      // duplicate key inside one frame -- two identical runs of rows -- resolves
      // to the one recording both draws share, and a block a discarded render
      // already recorded is found rather than recorded twice.
      const picture =
        chunkCache.get(plan.key) ??
        chunkCache.add(
          plan.key,
          recordTerminalChunk({
            lines: frame.lines,
            startRow: plan.startRow,
            endRow: plan.endRow,
            links: linksByChunk[plan.index],
            width: contentWidth,
            cellWidth,
            fontSize,
            lineHeight,
            fontManager,
            nerdFont,
            terminalTheme: paneTheme,
          })
        );
      // Blocks record their rows from their own first row down, so the offset of
      // that first row within the content is the whole difference between where
      // the recording was made and where it is being drawn. A re-used head is
      // drawn `overhang` rows higher still, which puts the rows the window has
      // since dropped above the pane's first row -- hence the clip, which is the
      // only thing keeping them off screen while the pane is pulled down for
      // earlier output.
      const top = verticalPadding + (plan.startRow - plan.overhang) * lineHeight;
      return {
        picture,
        transform: [{ translateY: top }],
        // Group clips apply after the group's own transform (saveCTM concats the
        // matrix, then clips), so this is in the recording's coordinates: cut
        // everything above the block's first row, and leave a row of slack below
        // for descenders and synthesised bold.
        clip:
          plan.overhang > 0
            ? rect(
                0,
                plan.overhang * lineHeight,
                contentWidth,
                (plan.endRow - plan.startRow) * lineHeight + lineHeight
              )
            : undefined,
      };
    });
    // The keys and the head travel with the draws instead of being written to
    // the cache here, so that the commit -- and only the commit -- decides what
    // this frame superseded.
    return {
      draws,
      keys: plans.map((plan) => plan.key),
      head: nextHeadRecording(plans, frame.lines, previousHead),
    };
  }, [
    cellWidth,
    chunkCache,
    chunkLayoutKey,
    contentWidth,
    fontManager,
    fontSize,
    frame,
    headBox,
    lineHeight,
    links,
    nerdFont,
    paneTheme,
  ]);
  const chunkDraws = chunkFrame.draws;

  // The half of the chunking the render above deliberately does not do.
  //
  // A SkPicture is a native display list holding memory the JS heap barely sees,
  // so a streaming pane that retired a block per frame and never freed one is
  // what OOM-killed the app in #557. But a block is only safe to free once a
  // *committed* frame has stopped drawing it, and only a commit knows which
  // frame that is -- hence here rather than in the memo, and hence one frame of
  // defer on top, so the scene the retirement replaced is done with it.
  //
  // No cleanup, deliberately. A sweep already in flight drains the queue it was
  // handed whether or not the pane is still on screen; the live blocks are left
  // to the GC when the component goes. `picture-cache.ts` has the reasoning, and
  // it is the reason this pane stopped taking the process down with it.
  const sweepFrame = useRef<number | null>(null);
  useLayoutEffect(() => {
    chunkCache.retain(chunkFrame.keys);
    headBox.current = chunkFrame.head;
    if (chunkCache.retiredCount === 0 || sweepFrame.current !== null) return;
    const sweep = () => {
      chunkCache.sweep(TERMINAL_SWEEP_BATCH);
      sweepFrame.current = chunkCache.retiredCount > 0 ? requestAnimationFrame(sweep) : null;
    };
    sweepFrame.current = requestAnimationFrame(sweep);
  }, [chunkCache, chunkFrame, headBox]);

  // Same native-memory story for the font provider: a font-size change rebuilds
  // nerdFont and this provider, and the one it replaced has to go. A recorded
  // picture was built from it but does not reference it afterwards, so the same
  // one-frame defer covers this too. Nothing frees it on the way out, for the
  // reason above: an unmounted pane's provider is the GC's.
  const committedFontManager = useRef<SkTypefaceFontProvider | null>(null);
  useLayoutEffect(() => {
    const superseded = committedFontManager.current;
    committedFontManager.current = fontManager;
    if (!superseded || superseded === fontManager) return;
    requestAnimationFrame(() => freeRecording(superseded));
  }, [fontManager]);

  // 1 is the size the Text size setting names, for every pane on every server.
  // There is no per-pane resting scale to count from any more: fitting each
  // pane's columns to the viewport gave panes of different widths different
  // glyph sizes under one setting, and the indicator, counting from each pane's
  // own fit, reported all of them as 100% (card #643).
  const scale = useSharedValue(1);
  // Where the pinch is, so the size pill is shown for a pinch and not for the
  // fit that runs when a pane opens -- and not for a one-finger scroll, which
  // is what `began` turned out to mean on Android (see `TerminalPinchPhase`).
  const pinchPhase = useSharedValue<TerminalPinchPhase>('idle');
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const panAxis = useSharedValue(AXIS_UNDECIDED);
  // True while a pan or pinch is in flight. An output refresh during a pinch
  // was firing the anchor reaction below, which re-set translateY under the
  // gesture and flickered. The reaction stands down while a gesture owns the
  // transform.
  const gesturing = useSharedValue(false);
  // Decay animations still in flight after the finger left, counted rather than
  // flagged because an undecided drag flings both axes at once. Every withDecay
  // below is paired with exactly one callback -- Reanimated invokes it on
  // completion AND on cancellation (`valueSetter` fires `callback(false)` before
  // it installs a replacement animation) -- so the count cannot leak.
  const coasting = useSharedValue(0);
  const gestureStartX = useSharedValue(0);
  const gestureStartY = useSharedValue(0);
  const gestureStartScale = useSharedValue(1);
  const focalX = useSharedValue(0);
  const focalY = useSharedValue(0);
  const followOutput = useSharedValue(true);
  // Set on a pane switch so the first positioning after new output snaps to the
  // bottom instantly instead of animating up from the top, which read as the
  // terminal "filling in from the top" on every switch.
  const snapToBottomNext = useSharedValue(false);
  // How many rows below the pane's resting anchor the first frame after a
  // switch should be placed at, from `terminalOpenView`. A one-shot for the
  // same reason `snapToBottomNext` is one: the placement is an opening
  // position, not a rule the pane is held to, so it is spent on the frame it
  // applies to and never argues with a reader who has since panned. 0 -- every
  // pane that is not a full-screen program bigger than this phone -- leaves
  // that frame exactly where it lands today.
  /**
   * Whether this opening of the pane still owes a placement.
   *
   * Not a shared-value one-shot, which is what this was first: armed in the
   * switch render and cleared by whichever applied frame got there first, it
   * lost races that only a device showed. Measured on a 359-column pane armed
   * at column 158 -- the arm ran, the frame that consumed it read 0, and the
   * pane opened at column 1 anyway.
   *
   * `null` means armed. The switch render arms it -- that render happens
   * exactly once per opening, which is exactly how often a pane should be
   * placed -- and the first frame that belongs to this pane spends it and
   * writes the key back. Every frame after that leaves the transform alone, so
   * a reader who pans is never argued with.
   *
   * Keying it on the pane alone was not enough: a reader who leaves a pane and
   * comes back gets the same key, and the placement would be skipped for a
   * pane whose pan the switch render had just reset to the left edge. Measured:
   * the 359-column pane placed correctly on first open and at column 1 on every
   * return to it.
   *
   * Written during render, like the reset signal it follows and for the same
   * reason: an effect would arm it a commit late, after the frame that should
   * have spent it.
   */
  const placedOpenKeyRef = useRef<string | null>(null);
  const pullDistance = useSharedValue(0);
  const fallbackKeyboardOffset = useSharedValue(0);
  const activeKeyboardOffset = keyboardOffset ?? fallbackKeyboardOffset;
  const historyAnchorRef = useRef({
    terminalId,
    revision: coalescedRevision,
    anchor: captureScrollAnchor(frame.lines),
  });

  /* ── Selecting text ─────────────────────────────────────────────────── */
  //
  // Two representations of one selection, and they are not redundant.
  //
  // The shared values are the live ones: a drag reads a cell out of the touch
  // and writes them on the UI thread, where the highlight has to keep up with
  // the finger. React state is the settled one, and is what the Skia rectangles
  // and the action bar are built from. The bridge between them fires on a *cell
  // change*, not on a frame -- a finger crossing cells does so a handful of
  // times a second, where a frame is sixty -- so the pane re-renders about as
  // often as the selection actually changes.
  //
  // `selecting` is the mode, and it is the pane's, not the gesture's: it
  // survives the finger lifting, which is the whole point of the bar that then
  // floats up. Its mutual exclusion with panning is `terminalDragIntent`.
  const selecting = useSharedValue(false);
  const anchorRow = useSharedValue(0);
  const anchorColumn = useSharedValue(0);
  const focusRow = useSharedValue(0);
  const focusColumn = useSharedValue(0);
  const selectionPointerX = useSharedValue(0);
  const selectionPointerY = useSharedValue(0);
  const selectionDragActive = useSharedValue(false);
  const [selection, setSelection] = useState<TerminalSelection | null>(null);
  // True only while a finger is on the glass extending it. The action bar waits
  // for the finger to leave: a control that appears under a moving thumb is a
  // control that gets pressed by accident.
  const [selectionDragging, setSelectionDragging] = useState(false);

  const applySelection = useCallback(
    (next: TerminalSelection | null) => {
      setSelection(next);
    },
    [setSelection]
  );

  const beginSelection = useCallback(
    (cell: TerminalCellPoint) => {
      const word = wordSelectionAt(frame.lines, cell);
      anchorRow.value = word.anchor.row;
      anchorColumn.value = word.anchor.column;
      // The finger may already have moved a cell or two in the tick this took
      // to arrive. Widening to the word must not haul the far end back to where
      // the press started, so the focus is only taken while it is untouched.
      if (focusRow.value === cell.row && focusColumn.value === cell.column) {
        focusRow.value = word.focus.row;
        focusColumn.value = word.focus.column;
        setSelection(word);
      } else {
        setSelection({
          anchor: word.anchor,
          focus: { row: focusRow.value, column: focusColumn.value },
        });
      }
      setSelectionDragging(true);
      void feedback('selection');
    },
    [
      anchorColumn,
      anchorRow,
      focusColumn,
      focusRow,
      frame.lines,
      setSelection,
      setSelectionDragging,
    ]
  );

  const selectLine = useCallback(
    (cell: TerminalCellPoint) => {
      const next = lineSelectionAt(frame.lines, cell);
      if (!next) return;
      selecting.value = true;
      anchorRow.value = next.anchor.row;
      anchorColumn.value = next.anchor.column;
      focusRow.value = next.focus.row;
      focusColumn.value = next.focus.column;
      setSelection(next);
      setSelectionDragging(false);
      void feedback('selection');
    },
    [
      anchorColumn,
      anchorRow,
      focusColumn,
      focusRow,
      frame.lines,
      selecting,
      setSelection,
      setSelectionDragging,
    ]
  );

  const startSelectionDrag = useCallback(() => setSelectionDragging(true), []);
  const endSelectionDrag = useCallback(() => setSelectionDragging(false), []);

  const clearSelection = useCallback(() => {
    selecting.value = false;
    setSelection(null);
    setSelectionDragging(false);
  }, [selecting, setSelection, setSelectionDragging]);

  /**
   * Follow the content the selection was made from as the window slides under
   * it. The shared values are the position of record -- a drag in flight is
   * writing them, and reading React state here would hand back the frame the
   * last commit saw rather than the cell the finger is on.
   */
  const moveSelectionRows = useCallback(
    (droppedRows: number, rows: number) => {
      if (!selecting.value || droppedRows === 0) return;
      const moved = shiftSelectionRows(
        {
          anchor: { row: anchorRow.value, column: anchorColumn.value },
          focus: { row: focusRow.value, column: focusColumn.value },
        },
        droppedRows,
        rows
      );
      if (!moved) {
        // The rows it named have left the scrollback window. There is nothing
        // left to highlight and nothing honest left to copy.
        clearSelection();
        return;
      }
      anchorRow.value = moved.anchor.row;
      anchorColumn.value = moved.anchor.column;
      focusRow.value = moved.focus.row;
      focusColumn.value = moved.focus.column;
      setSelection(moved);
    },
    [anchorColumn, anchorRow, clearSelection, focusColumn, focusRow, selecting, setSelection]
  );

  // Clearance above the composer. Output resting flush against the dock reads
  // as clipped even when it is not, so it stops a couple of lines short.
  //
  // The inset is followed rather than adopted. The dock above it changes height
  // for a dozen reasons -- an approval banner, the pane strip appearing, a
  // multiline draft growing a row -- and each of those used to arrive here as a
  // new number on one frame, which is what made the whole terminal jump a beat
  // behind the surface that caused it. The dock animates its own height on the
  // same token, so easing to the new inset is what puts the two in step.
  const animatedBottomInset = useSharedValue(bottomInset);
  useEffect(() => {
    animatedBottomInset.value = withTiming(bottomInset, timing('short'));
  }, [animatedBottomInset, bottomInset]);
  // Eased for the same reason the bottom one is: the inset appears and
  // disappears with what the pane is running, and a pane that switches from a
  // shell to nvim should slide its first row clear rather than jump it.
  const animatedTopInset = useSharedValue(topInset);
  useEffect(() => {
    animatedTopInset.value = withTiming(topInset, timing('short'));
  }, [animatedTopInset, topInset]);
  const unobstructedHeight = viewport.height - terminalViewportClearance(lineHeight);
  const animatedVisibleHeight = useDerivedValue(() =>
    Math.max(
      1,
      unobstructedHeight - animatedBottomInset.value - Math.max(0, -activeKeyboardOffset.value)
    )
  );
  // The pill sits against the dock, so it travels with it.
  const latestButtonStyle = useAnimatedStyle(() => ({
    bottom: 14 + animatedBottomInset.value,
  }));

  useEffect(() => {
    let active = true;
    // Let Metro/Expo resolve the bundled module on every platform. Android's
    // generated raw-resource URI is not a downloadable URL, so feeding it to
    // Asset.fromURI makes downloadAsync reject in standalone APKs.
    const fontAsset = Asset.fromModule(terminalFontSource);
    void fontAsset
      .downloadAsync()
      .then((asset) => {
        const uri = asset.localUri;
        if (!uri) throw new Error('The bundled terminal font has no local URI.');
        if (active) setFontUri(uri);
      })
      .catch((error: unknown) => {
        if (active) {
          setFontError(error instanceof Error ? error.message : 'Could not load terminal font.');
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    translateY.value = 0;
    pullDistance.value = 0;
    followOutput.value = true;
    snapToBottomNext.value = true;
    // A selection belongs to the output it was dragged across. The canvas is
    // deliberately kept mounted through a pane switch, so nothing else would
    // take it down, and a highlight left sitting over another pane's rows would
    // copy that pane's text.
    clearSelection();
  }, [clearSelection, followOutput, pullDistance, snapToBottomNext, terminalId, translateY]);

  // How many columns this phone would draw into this viewport at this font --
  // the same function, on the same constants, that sizes an SSH PTY to this
  // canvas, so the two cannot drift. The measured cell advance is passed in, so
  // the answer is the grid actually being drawn rather than an estimate of it.
  const phoneGrid = terminalGridFor({
    width: viewport.width,
    height: viewport.height,
    fontSize,
    cellWidth,
    lineHeight,
  });
  const phoneColumns = phoneGrid.cols;
  // The size this pane rests at with nothing remembered for it: 1 for every
  // pane as wide as the phone or wider, and for every pane whose width the
  // gateway did not report -- which is every SSH shell, whose grid *is* the
  // PTY and can never differ from this one. Only a pane narrower than the grid
  // above gets anything else. See `terminalFitToWidthScale`.
  const paneRestingScale = terminalFitToWidthScale(phoneColumns, paneColumns);
  // The size this pane is about to open at -- the remembered pinch if it has
  // one, the fit otherwise. Computed here rather than inside the switch render
  // below because the placement needs it too: how many of the pane's cells are
  // on the glass is `phoneColumns / scale`, and a remembered 1.44 turns 52
  // columns into 36. Getting that wrong does not nudge the placement, it moves
  // it by a third of a screen -- measured on Android, where a stale entry for a
  // reused pane id had this pane at 1.44 while the placement still counted at
  // 1:1. `loadPaneScales` is a plain object after its first read (see it), so
  // asking every render costs a lookup.
  const paneOpenScale = terminalOpenScale({
    paneId: terminalId,
    remembered: loadPaneScales(),
    phoneColumns,
    paneColumns,
  });
  // Which cell of the pane the reader is put in front of. `{ 0, 0 }` for every
  // pane that is not a full-screen program bigger than this phone's grid, which
  // is every pane that opens correctly today. See `terminalOpenView`.
  const openView = terminalOpenView({
    paneColumns,
    paneRows,
    phoneColumns,
    phoneRows: phoneGrid.rows,
    // The scale it is about to be drawn at, so the placement counts the cells
    // that will actually be on the glass rather than the ones that would be at
    // 1:1 -- the remembered pinch included, not just the fit.
    scale: paneOpenScale,
    cursorColumn: paneCursorColumn,
    cursorRow: paneCursorRow,
    ownsScreen,
  });

  /*
   * Opening a pane starts at the size the Text size setting names, unless this
   * exact pane has a remembered pinch -- or unless it is narrower than the grid
   * this phone would otherwise draw, in which case it opens scaled up until its
   * columns reach the edge. `terminalOpenScale` is the whole rule and this is
   * its only call site.
   *
   * During the render the pane changes on, not in an effect after it. The scale
   * is a transform on the recorded picture rather than an input to it -- nothing
   * here re-parses, re-records or re-measures -- so the cost is a shared-value
   * write, and the reason it is here is timing rather than cost: an effect runs
   * after the commit it belongs to has been painted, so a fitted pane would
   * show one frame of its text at 1:1 hugging the left of the screen and then
   * jump. #33 measured that shape of mistake from the other end and moved its
   * own restore into the switch render for the same reason; `useResetSignal`'s
   * docblock describes this case by name.
   *
   * The key is the pane *and* the geometry, which is exactly the set of
   * dependencies the effect this replaces re-ran on, plus the pane's own column
   * count -- so a viewport that changes still re-applies, and a pane tmux
   * re-splits under the reader is re-fitted to the width it has now. The
   * remembered table is read here rather than in an effect for the same timing
   * reason; after the first read it is a plain object held for the process
   * (see `loadPaneScales`).
   *
   * A reset signal is false on the render it is first called on, which would
   * matter if a mount could arrive with a viewport already measured. It cannot:
   * `viewport` is this component's own state, seeded `{ width: 0, height: 0 }`
   * on every mount, so the first geometry worth acting on is always a later
   * render and always a change from the zero this saw first.
   */
  const paneOpenKey = `${terminalId}:${viewport.width}x${viewport.height}:${paneColumns ?? 0}x${paneRows ?? 0}:${ownsScreen ? 1 : 0}`;
  const paneOpened = useResetSignal(paneOpenKey);
  if (paneOpened && viewport.width > 0 && viewport.height > 0) {
    // A shared value, not React state: nothing in this render reads it back, so
    // there is no torn render to have. This is the adjust-during-render pattern
    // `useResetSignal` exists for, and an effect here is a painted frame late.
    scale.value = paneOpenScale;
    // The pan goes back to the left edge, as it always has on open.
    translateX.value = 0;
    // The placement itself is applied on the first frame of the new pane rather
    // than here. This render still describes the outgoing pane -- its content
    // height, which the resting anchor is made of, and its text width, which
    // both pan clamps are made of -- so a position applied here is clamped
    // against the wrong pane and lost. All this render does is say one is owed.
    // oxlint-disable-next-line react/refs -- deliberate: nothing renders from this ref; it is the arm half of the adjust-during-render pattern above, and an effect would set it a commit too late. See its doc comment.
    placedOpenKeyRef.current = null;
  }

  // What the placement needs, read from the one frame that can honour it. Both
  // are mailboxes rather than dependencies so the applied-frame effect below is
  // not restarted by a cursor that moved; the key beside them is what decides
  // whether it is time to act at all.
  const openViewRef = useLatestRef(openView);
  const paneOpenKeyRef = useLatestRef(paneOpenKey);

  // Leaving the service screen remembers the pinch this pane is showing, keyed
  // on its id (see `terminalScaleOnScreenLeave`), rather than resetting it.
  // Deliberately not keyed on the pane: the carousel keeps this canvas mounted
  // across a pane switch, and going out to Settings or the panels sheet leaves
  // the screen mounted underneath, so `screenFocused` still reaches `false` on
  // a render for those. Running while the pane is off screen still matters:
  // the write happens where the reader cannot see it land.
  useEffect(() => {
    if (screenFocused) return;
    if (viewport.width <= 0) return;
    savePaneScales(
      terminalScaleOnScreenLeave(terminalId, scale.value, loadPaneScales(), paneRestingScale)
    );
    translateX.value = 0;
  }, [paneRestingScale, scale, screenFocused, terminalId, translateX, viewport.width]);

  // The other half of the write above, for the one path that never renders
  // `screenFocused: false` at all.
  //
  // Going back to the server list does not push a screen over this one, it
  // pops this screen's own route -- confirmed live: the route
  // disappears from the stack in the same commit that starts the pop, so this
  // component unmounts with whatever `screenFocused` it last rendered, which
  // is still `true`. `useIsFocused` never has a render in between to say
  // otherwise. The comment above used to claim the server list left the
  // screen mounted the way Settings does; measured live, it does not, and
  // this effect is the fix rather than the comment.
  //
  // A ref pair, not `terminalId`/`viewport.width` in the deps, because this
  // has to run *once*, on the unmount that actually happens -- putting either
  // in the deps would make the effect restart (and its cleanup fire) on every
  // ordinary prop change, which is not a pane leaving the screen. Both refs
  // are read only from this cleanup, never from render.
  const unmountTerminalIdRef = useLatestRef(terminalId);
  const unmountViewportWidthRef = useLatestRef(viewport.width);
  // The size this pane would have opened at anyway, so the write below can tell
  // a scale the reader chose from one the fit handed them (see
  // `terminalScaleOnScreenLeave`). Same mailbox pattern as the two above, and
  // read from the same one place.
  const unmountRestingScaleRef = useLatestRef(paneRestingScale);
  useEffect(() => {
    return () => {
      // oxlint-disable-next-line react/exhaustive-deps -- deliberate: `useLatestRef` (see its own doc comment) exists exactly so a callback outside render can read the current value; this is that read, at the one moment -- unmount -- render can no longer reach.
      if (unmountViewportWidthRef.current <= 0) return;
      savePaneScales(
        terminalScaleOnScreenLeave(
          // oxlint-disable-next-line react/exhaustive-deps -- deliberate: same as above.
          unmountTerminalIdRef.current,
          scale.value,
          loadPaneScales(),
          // oxlint-disable-next-line react/exhaustive-deps -- deliberate: same as above.
          unmountRestingScaleRef.current
        )
      );
    };
    // oxlint-disable-next-line react/exhaustive-deps -- deliberate: unmount only, see comment above. `scale` and the two refs are stable identities, so listing them would not change when this runs.
  }, []);

  // Output arriving in a wider column must not undo a pinch or scroll the
  // reader was in the middle of; only the pan bounds move.
  useEffect(() => {
    contentWidthRef.current = contentWidth;
    if (viewport.width <= 0) return;
    const minX = terminalPanMinX(viewport.width, textWidth, scale.value);
    translateX.value = Math.max(minX, Math.min(0, translateX.value));
  }, [contentWidth, scale, textWidth, translateX, viewport.width]);

  // Everything that has to happen when a frame is *applied* -- which, with the
  // freeze above, is no longer once per snapshot but once per gesture-free
  // moment. Both cases here are the same correction in opposite directions:
  // rows arriving above the reader push their content down, rows trimmed off the
  // top pull it up, and the offset has to move with the content or the reader
  // loses their place. The release after a freeze is where this stops being a
  // slow creep and becomes a jump, because it pays for the whole gesture at once.
  useEffect(() => {
    const previous = historyAnchorRef.current;
    const anchor = captureScrollAnchor(frame.lines);
    if (previous.terminalId !== terminalId) {
      historyAnchorRef.current = { terminalId, revision: coalescedRevision, anchor };
      return;
    }
    const minimumY = animatedVisibleHeight.value - contentHeight * scale.value;
    if (previous.revision !== coalescedRevision) {
      // Pull-to-load prepended history: everything the reader can see moved down
      // by the rows that went in above it -- and only by those. The compensation
      // is the measured position of the old top inside the new frame, not the
      // length delta, because the pane kept printing while the page was being
      // fetched: on a streaming pane the tail grows by most of a screen during
      // one round trip, the delta conflates that growth with the prepend, and a
      // compensation built from the sum overshoots downward until the clamp
      // parks the reader at the bottom. A pull for older history that lands on
      // the newest line was the reported bug, and this line was it. The delta
      // stays as the fallback for the one case the probe cannot answer -- a
      // previous top too blank or too repeated to fingerprint -- where on a
      // quiet pane it is also simply correct.
      const measured = measureRowsPrepended(previous.anchor, frame.lines);
      const addedRows =
        measured >= 0 ? measured : Math.max(0, frame.lines.length - previous.anchor.rows);
      if (addedRows > 0) {
        translateY.value = clampScrollOffset(
          translateY.value - addedRows * lineHeight * scale.value,
          minimumY,
          animatedTopInset.value,
          historyHeight * scale.value
        );
        followOutput.value = false;
        // Rows going in above the selection push it down by exactly as many.
        // The offset correction above and this are the same correction, applied
        // to the two things that name a position in the content.
        moveSelectionRows(-addedRows, frame.lines.length);
      }
    } else if (!followOutput.value) {
      // A full scrollback window drops a row off the top for every row the agent
      // prints, so a reader parked in history watches their content climb out of
      // the viewport on its own. Following readers are already pinned to the
      // bottom and want exactly that motion, so they are left alone.
      const droppedRows = measureRowsDropped(previous.anchor, frame.lines);
      if (droppedRows > 0) {
        const compensation = droppedRows * lineHeight * scale.value;
        translateY.value = clampScrollOffset(
          translateY.value + compensation,
          minimumY,
          animatedTopInset.value,
          historyHeight * scale.value
        );
        moveSelectionRows(droppedRows, frame.lines.length);
        // A drag in flight positions from where it started, so without this the
        // next touch move would overwrite the compensation and the reader would
        // lose the rows anyway. The gate makes this rare rather than impossible:
        // a frame can still land between the touch and the gate closing.
        gestureStartY.value += compensation;
      }
    }
    historyAnchorRef.current = { terminalId, revision: coalescedRevision, anchor };
  }, [
    animatedTopInset,
    animatedVisibleHeight,
    contentHeight,
    followOutput,
    frame,
    coalescedRevision,
    gestureStartY,
    historyHeight,
    lineHeight,
    moveSelectionRows,
    scale,
    terminalId,
    translateY,
  ]);

  // Whether the pane has been frozen at any point since the last applied frame,
  // which is what makes the next one a *debt* rather than a step: it carries
  // everything the agent printed for the whole length of the gesture. Written
  // by its own effect, in the commit that closes the gate, so the commit that
  // opens it again finds the flag already set whatever order effects run in.
  const owesFreezeDebt = useRef(false);
  useEffect(() => {
    if (gate.frozen) owesFreezeDebt.current = true;
  }, [gate.frozen]);
  // An ease already heading for the bottom. Nothing may start a second one over
  // it, and nothing may assign through it -- both are how a moving target turns
  // an animation into a stutter.
  const catchingUp = useSharedValue(false);

  useEffect(() => {
    if (!followOutput.value || viewport.height <= 0) return;
    const bottom = terminalRestOffset(
      animatedVisibleHeight.value - contentHeight * scale.value,
      animatedTopInset.value,
      historyHeight * scale.value
    );
    const debt = owesFreezeDebt.current;
    owesFreezeDebt.current = false;
    const frameRows = frame.lines.length;

    // The placement, applied on the first frame that can actually carry it.
    //
    // Kept ahead of the snap below and armed independently of it, because the
    // two do not always get the same frame. A switch into a pane the cache
    // already had lands its window on the switch render itself (#33), so both
    // fire together; a switch into a pane the cache missed renders once with no
    // output at all, and a placement spent on that empty frame would put the
    // pane 55 rows down a one-line canvas, clamp it straight back to the
    // anchor, and be gone before the real frame arrived. So the placement waits
    // for a frame with the rows to hold it, and `snapToBottomNext` keeps its
    // own behaviour exactly.
    // Read from mailboxes, not from dependencies: `useLatestRef` is what lets
    // this see the current placement without the effect restarting every time
    // a cursor moves, which is the one thing it must not chase. The refs
    // themselves are stable identities, so listing them below changes nothing
    // about when this runs.
    const placement = openViewRef.current;
    const placedRows = placement.row;
    const placedColumns = placement.column;
    if (
      placedOpenKeyRef.current === null &&
      (placedRows > 0 || placedColumns > 0) &&
      // The frame has to be this pane's, not the one being left. A switch into
      // a pane the cache missed renders once with the outgoing pane's window
      // still in hand, and a placement spent on it would be spent on the wrong
      // grid. A placement only exists when the gateway reported a height, so
      // that height is always available to check against -- and since #39 an
      // alternate-screen frame is exactly the pane's rows, never fewer.
      frameRows >= (paneRows ?? 0) &&
      frameRows > placedRows
    ) {
      placedOpenKeyRef.current = paneOpenKeyRef.current;
      cancelAnimation(translateY);
      catchingUp.value = false;
      // `bottom` is the pane's resting offset, which for a full-screen program
      // is its FIRST row under the header rather than its last (see
      // `terminalRestOffset`), so a placement is always a move downward into
      // the pane and the clamp is what stops it at the real end of the content.
      translateY.value = clampScrollOffset(
        bottom - placedRows * lineHeight * scale.value,
        animatedVisibleHeight.value - contentHeight * scale.value,
        animatedTopInset.value,
        historyHeight * scale.value
      );
      // The horizontal half, measured against this frame's own width so the
      // clamp is the one the finger would meet rather than the outgoing pane's.
      translateX.value = Math.max(
        terminalPanMinX(viewport.width, textWidth, scale.value),
        Math.min(0, -placedColumns * cellWidth * scale.value)
      );
      // A pane placed downward is deliberately not at its anchor, so follow is
      // released -- otherwise the next frame's reaction would rest it straight
      // back to the top and the placement would last exactly one frame. This is
      // the same state a reader who scrolls up puts the pane in, so the Latest
      // pill, the clamps and the re-engagement on scrolling back all behave as
      // they already do. A pane placed only sideways keeps following, because
      // sideways is not what follow is about.
      if (placedRows > 0) followOutput.value = false;
      snapToBottomNext.value = false;
      return;
    }

    if (snapToBottomNext.value) {
      // First output after a pane switch: jump to the bottom with no animation,
      // so the content is simply there rather than scrolling into place.
      cancelAnimation(translateY);
      catchingUp.value = false;
      translateY.value = bottom;
      snapToBottomNext.value = false;
      return;
    }

    // An ease from the last freeze release is still running. Leave it: the
    // target it was given is at most a couple of frames stale, and the next
    // applied frame after it lands pins the remainder. Retargeting mid-flight
    // is what `withTiming` cannot do -- it cancels and re-eases from a partial
    // position, which is the judder this whole block exists to remove.
    if (catchingUp.value) return;

    // The ordinary case, and the one a streaming pane is in the whole time: the
    // bottom moved because rows arrived, so put the pane on it. The scrolling
    // the reader sees is the content moving, not the offset animating. Starting
    // an animation here is what made a printing pane judder ten times a second
    // -- see `followCatchUpDurationMs`, which now returns 0 for a step.
    const duration = debt
      ? followCatchUpDurationMs(bottom - translateY.value, lineHeight * scale.value)
      : 0;
    if (duration <= 0) {
      translateY.value = bottom;
      return;
    }

    // A whole gesture's worth of output in one frame. This is a jump, not a
    // step, and landing it instantly under a finger that has just lifted is the
    // lurch the ease was written for.
    catchingUp.value = true;
    translateY.value = withTiming(bottom, { duration }, () => {
      catchingUp.value = false;
    });
  }, [
    animatedTopInset,
    animatedVisibleHeight,
    catchingUp,
    contentHeight,
    followOutput,
    cellWidth,
    frame.lines.length,
    openViewRef,
    paneOpenKeyRef,
    paneRows,
    gate.frozen,
    historyHeight,
    textWidth,
    translateX,
    viewport.width,
    appliedContent,
    lineHeight,
    scale,
    snapToBottomNext,
    translateY,
    viewport.height,
  ]);

  useAnimatedReaction(
    () => animatedVisibleHeight.value - contentHeight * scale.value,
    (minimumY, previousMinimumY) => {
      if (minimumY === previousMinimumY || gesturing.value) return;
      const topInsetValue = animatedTopInset.value;
      translateY.value = followOutput.value
        ? terminalRestOffset(minimumY, topInsetValue, historyHeight * scale.value)
        : clampScrollOffset(translateY.value, minimumY, topInsetValue, historyHeight * scale.value);
    }
  );

  // The same correction, for the other input the resting position is made of.
  //
  // The inset is EASED (see `animatedTopInset`), so switching between a shell
  // and an editor walks it through every value in between -- and those values
  // describe neither pane. The rest anchor is read off it, so a pane that is on
  // its way to `topInset: 0` gets rested against an inset it is not going to
  // have, and then nothing puts it right: the reaction above only fires when the
  // content changes height, and a quiet pane's does not. Measured on a shell
  // pane switched to from nvim: rested at -800 while its own bottom was -476,
  // which is 324pt of blank under the prompt.
  //
  // Reacting to the inset itself is also the motion the easing was added for --
  // the pane's first row slides clear of the header with it, rather than
  // arriving there in one frame at the end.
  useAnimatedReaction(
    () => animatedTopInset.value,
    (topInsetValue, previousTopInset) => {
      if (topInsetValue === previousTopInset || gesturing.value) return;
      const minimumY = animatedVisibleHeight.value - contentHeight * scale.value;
      translateY.value = followOutput.value
        ? terminalRestOffset(minimumY, topInsetValue, historyHeight * scale.value)
        : clampScrollOffset(translateY.value, minimumY, topInsetValue, historyHeight * scale.value);
    }
  );

  useAnimatedReaction(
    () => followOutput.value,
    (current, previous) => {
      if (current !== previous) scheduleOnRN(setFollowing, current);
    }
  );

  // The freeze covers the fling as well as the finger. A frame swap mid-decay is
  // the worst of the lot: the content is travelling fastest exactly then, so a
  // re-layout lands as a jump rather than as drift, and the reader has no thumb
  // on the screen to explain it.
  useAnimatedReaction(
    () => gesturing.value || coasting.value > 0,
    (current, previous) => {
      if (current !== previous) scheduleOnRN(gate.setActive, current);
    }
  );

  // Read out of the frame once, so the worklets below close over two numbers
  // rather than over the parsed frame. Both are what a hit test has to be
  // clamped to: a finger past the last row selects to the end of the output,
  // not to a row that does not exist.
  const gridRows = frame.lines.length;
  const gridColumns = frame.columns;

  const selectionAutoScrollFrame = useFrameCallback((frameInfo) => {
    if (!selecting.value || !selectionDragActive.value) return;
    const velocity = selectionAutoScrollVelocity(
      selectionPointerY.value,
      animatedTopInset.value,
      animatedVisibleHeight.value
    );
    if (velocity === 0) return;

    // Cap a delayed frame so returning from an interruption cannot jump a
    // screenful. Ordinary frames use their real elapsed time and therefore
    // keep the same speed on 60 Hz and 120 Hz displays.
    const elapsedMs = Math.min(32, Math.max(0, frameInfo.timeSincePreviousFrame ?? 0));
    const minY = animatedVisibleHeight.value - contentHeight * scale.value;
    const nextY = clampScrollOffset(
      translateY.value + velocity * (elapsedMs / 1000),
      minY,
      animatedTopInset.value,
      historyHeight * scale.value
    );
    if (nextY === translateY.value) return;
    translateY.value = nextY;
    followOutput.value = terminalFollowsOutput(
      nextY,
      terminalRestOffset(minY, animatedTopInset.value, historyHeight * scale.value)
    );

    const cell = cellAtViewportPoint(
      selectionPointerX.value,
      selectionPointerY.value,
      {
        cellWidth,
        lineHeight,
        scale: scale.value,
        translateX: translateX.value,
        translateY: nextY,
        horizontalPadding,
        verticalPadding,
      },
      gridRows,
      gridColumns
    );
    if (cell.row === focusRow.value && cell.column === focusColumn.value) return;
    focusRow.value = cell.row;
    focusColumn.value = cell.column;
    scheduleOnRN(applySelection, {
      anchor: { row: anchorRow.value, column: anchorColumn.value },
      focus: cell,
    });
  }, false);

  // Registering a Reanimated frame callback with its default autostart keeps
  // Choreographer waking at the display refresh rate even while no selection
  // exists. The worklet returned early, but the phone still paid for every
  // frame. Auto-scroll only has work while a finger is extending a selection.
  useEffect(() => {
    selectionAutoScrollFrame.setActive(selectionDragging);
    return () => selectionAutoScrollFrame.setActive(false);
  }, [selectionAutoScrollFrame, selectionDragging]);

  /*
    Touch as the program's input, when the program has said it wants it.

    Three layers, and `@/terminal/touch-input` has the argument for them: a
    program reporting the mouse gets clicks and the wheel, a program on the
    alternate screen that is not gets arrow keys, and everything else keeps the
    scrollback pan this pane has always had. Two fingers are always the
    scrollback, in every layer.

    The modes cross to the UI thread as one packed integer rather than as an
    object, because the pan reads them on every touch sample to decide whether
    it may move the transform at all -- a decision that cannot wait for a hop
    to JS without the first frames of every drag scrolling the wrong thing.
    Zero is "no channel and no modes", which is the gateway path and which
    resolves to the scrollback layer, so a caller that passes no `touchInput`
    gets exactly the component that existed before this.
  */
  const touchModeBits = useSharedValue(0);
  const touchScreenRows = useSharedValue(0);
  const touchInputRef = useLatestRef(touchInput);
  const touchModes = touchInput?.modes;
  const touchRows = touchInput?.rows ?? 0;
  useEffect(() => {
    touchModeBits.value = touchModes ? packTerminalTouchModes(touchModes) : 0;
    touchScreenRows.value = touchRows;
  }, [touchModeBits, touchModes, touchRows, touchScreenRows]);

  /**
   * The finger's own accumulator, in cells rather than in points.
   *
   * `travel` is how far the drag has come from where the program took it over,
   * truncated to whole cells; `emitted` is how much of that has already gone
   * out. The frame callback below sends the difference and moves `emitted` up
   * to `travel`, which is the whole of the coalescing: a flick that crosses
   * forty rows in one frame is one write of forty wheel events, not forty
   * writes, and a thumb that wanders inside one cell writes nothing at all.
   *
   * The divisor is `lineHeight * scale`, not `lineHeight`: a cell on the glass
   * is as tall as the current zoom makes it, and a drag over a pinched-in pane
   * must cross the rows the reader can see crossing.
   */
  const programDragActive = useSharedValue(false);
  const programDragHeld = useSharedValue(false);
  const programBaseX = useSharedValue(0);
  const programBaseY = useSharedValue(0);
  const programTravelRows = useSharedValue(0);
  const programTravelColumns = useSharedValue(0);
  const programEmittedRows = useSharedValue(0);
  const programEmittedColumns = useSharedValue(0);
  const programCellRow = useSharedValue(1);
  const programCellColumn = useSharedValue(1);
  /**
   * Set when a drag is live but its origin is not, which is the one case a long
   * press makes: the press arms the button from a recogniser that knows where
   * the finger is but not how far the pan thinks it has come, and only the pan
   * can supply that. The next update takes its own translation as the origin.
   */
  const programRebase = useSharedValue(false);

  const sendTouchBytes = useCallback(
    (bytes: Uint8Array | null) => {
      if (bytes) touchInputRef.current?.send(bytes);
    },
    [touchInputRef]
  );

  const emitProgramDrag = useCallback(
    (drag: { row: number; column: number; rows: number; columns: number; held: boolean }) => {
      const input = touchInputRef.current;
      if (!input) return;
      sendTouchBytes(
        terminalTouchDragBytes(
          {
            cell: { row: drag.row, column: drag.column },
            rows: drag.rows,
            columns: drag.columns,
            held: drag.held,
          },
          packTerminalTouchModes(input.modes)
        )
      );
    },
    [sendTouchBytes, touchInputRef]
  );

  const emitProgramPress = useCallback(
    (cell: { row: number; column: number }) => {
      const input = touchInputRef.current;
      if (!input) return;
      sendTouchBytes(terminalTouchPressBytes(cell, packTerminalTouchModes(input.modes)));
      void feedback('selection');
    },
    [sendTouchBytes, touchInputRef]
  );

  const emitProgramRelease = useCallback(
    (cell: { row: number; column: number }) => {
      const input = touchInputRef.current;
      if (!input) return;
      sendTouchBytes(terminalTouchReleaseBytes(cell, packTerminalTouchModes(input.modes)));
    },
    [sendTouchBytes, touchInputRef]
  );

  const emitProgramTap = useCallback(
    (cell: { row: number; column: number }) => {
      const input = touchInputRef.current;
      if (!input) return;
      sendTouchBytes(terminalTouchTapBytes(cell, packTerminalTouchModes(input.modes)));
      void feedback('selection');
    },
    [sendTouchBytes, touchInputRef]
  );

  /**
   * The cell under a viewport point, as the program spells one.
   *
   * Two steps: the same hit test the selection uses, which answers in rows of
   * the *drawing*, and then the conversion to rows of the live screen. On the
   * main screen those differ by the whole scrollback above, which is why a
   * click in a mouse-aware pager was landing hundreds of rows off before this
   * existed.
   */
  const programCellAt = useCallback(
    (x: number, y: number) => {
      'worklet';
      const hit = cellAtViewportPoint(
        x,
        y,
        {
          cellWidth,
          lineHeight,
          scale: scale.value,
          translateX: translateX.value,
          translateY: translateY.value + pullDistance.value,
          horizontalPadding,
          verticalPadding,
        },
        gridRows,
        gridColumns
      );
      return terminalTouchCellAt({
        row: hit.row,
        column: hit.column,
        lineCount: gridRows,
        screenRows: touchScreenRows.value,
        columns: gridColumns,
      });
    },
    [
      cellWidth,
      gridColumns,
      gridRows,
      lineHeight,
      pullDistance,
      scale,
      touchScreenRows,
      translateX,
      translateY,
    ]
  );

  const beginProgramDrag = useCallback(
    (event: { x: number; y: number; translationX: number; translationY: number }) => {
      'worklet';
      const cell = programCellAt(event.x, event.y);
      programCellRow.value = cell.row;
      programCellColumn.value = cell.column;
      programBaseX.value = event.translationX;
      programBaseY.value = event.translationY;
      programTravelRows.value = 0;
      programTravelColumns.value = 0;
      programEmittedRows.value = 0;
      programEmittedColumns.value = 0;
      programRebase.value = false;
      programDragActive.value = true;
    },
    [
      programBaseX,
      programBaseY,
      programCellAt,
      programCellColumn,
      programCellRow,
      programDragActive,
      programEmittedColumns,
      programEmittedRows,
      programRebase,
      programTravelColumns,
      programTravelRows,
    ]
  );

  const trackProgramDrag = useCallback(
    (event: { x: number; y: number; translationX: number; translationY: number }) => {
      'worklet';
      if (programRebase.value) {
        programRebase.value = false;
        programBaseX.value = event.translationX;
        programBaseY.value = event.translationY;
        programTravelRows.value = 0;
        programTravelColumns.value = 0;
        programEmittedRows.value = 0;
        programEmittedColumns.value = 0;
      }
      const zoom = scale.value > 0 ? scale.value : 1;
      const rowPitch = lineHeight * zoom;
      const columnPitch = cellWidth * zoom;
      programTravelRows.value =
        rowPitch > 0 ? Math.trunc((event.translationY - programBaseY.value) / rowPitch) : 0;
      programTravelColumns.value =
        columnPitch > 0 ? Math.trunc((event.translationX - programBaseX.value) / columnPitch) : 0;
      const cell = programCellAt(event.x, event.y);
      programCellRow.value = cell.row;
      programCellColumn.value = cell.column;
    },
    [
      cellWidth,
      lineHeight,
      programBaseX,
      programBaseY,
      programCellAt,
      programCellColumn,
      programCellRow,
      programEmittedColumns,
      programEmittedRows,
      programRebase,
      programTravelColumns,
      programTravelRows,
      scale,
    ]
  );

  /**
   * Everything the finger has crossed since the last frame, in one write.
   *
   * A frame callback rather than the gesture callback itself, for the reason
   * the transform commit above is one: touch arrives faster than the display,
   * and a PTY handed a wheel event per touch sample is a program redrawing
   * long after the finger has stopped. Registered and unregistered from the JS
   * thread only -- `setActive` from a worklet corrupts reanimated's registry;
   * the note on `gestureCommitFrame` has the measurement.
   */
  const touchInputFrame = useFrameCallback(() => {
    'worklet';
    if (!programDragActive.value) return;
    const rows = programTravelRows.value - programEmittedRows.value;
    const columns = programTravelColumns.value - programEmittedColumns.value;
    if (rows === 0 && columns === 0) return;
    programEmittedRows.value = programTravelRows.value;
    programEmittedColumns.value = programTravelColumns.value;
    scheduleOnRN(emitProgramDrag, {
      row: programCellRow.value,
      column: programCellColumn.value,
      rows,
      columns,
      held: programDragHeld.value,
    });
  }, false);
  const [programDragging, setProgramDragging] = useState(false);
  useAnimatedReaction(
    () => programDragActive.value,
    (active, wasActive) => {
      if (active !== wasActive) scheduleOnRN(setProgramDragging, active);
    }
  );
  useEffect(() => {
    touchInputFrame.setActive(programDragging);
    return () => touchInputFrame.setActive(false);
  }, [programDragging, touchInputFrame]);

  /**
   * The end of a drag the program owned.
   *
   * The tail matters: the callback above stops on the frame the finger leaves,
   * and whatever cells were crossed after its last run would otherwise be
   * dropped -- which on a short flick is the whole gesture. A held drag also
   * owes the far side its release, and owes it exactly once however many
   * recognisers finalize.
   */
  const endProgramDrag = useCallback(() => {
    'worklet';
    if (!programDragActive.value) return;
    const rows = programTravelRows.value - programEmittedRows.value;
    const columns = programTravelColumns.value - programEmittedColumns.value;
    programEmittedRows.value = programTravelRows.value;
    programEmittedColumns.value = programTravelColumns.value;
    if (rows !== 0 || columns !== 0) {
      scheduleOnRN(emitProgramDrag, {
        row: programCellRow.value,
        column: programCellColumn.value,
        rows,
        columns,
        held: programDragHeld.value,
      });
    }
    if (programDragHeld.value) {
      scheduleOnRN(emitProgramRelease, {
        row: programCellRow.value,
        column: programCellColumn.value,
      });
    }
    programDragHeld.value = false;
    programDragActive.value = false;
  }, [
    emitProgramDrag,
    emitProgramRelease,
    programCellColumn,
    programCellRow,
    programDragActive,
    programDragHeld,
    programEmittedColumns,
    programEmittedRows,
    programTravelColumns,
    programTravelRows,
  ]);

  const panGesture = Gesture.Pan()
    .hitSlop({ left: -32 })
    .minDistance(2)
    .onBegin(() => {
      // The gate closes on touch-down, not on activation. A pan does not become
      // a pan until the thumb has travelled its minimum distance, and the tens
      // of milliseconds between the touch landing and the thumb moving is the
      // head start the JS thread needs to have held the frame before the first
      // pixel of movement. Nothing else happens here: a touch that turns out to
      // be a tap costs the pane one held refresh, released by onFinalize.
      //
      // Not in the two program layers. The freeze exists so a frame swap cannot
      // land under a moving finger, and it is exactly wrong here: in those
      // layers the drag IS what is changing the frame, and holding the picture
      // would mean the reader drags through vim and sees nothing move until
      // they lift. A two-finger drag in those layers is the scrollback again
      // and takes the freeze back below.
      if (terminalTouchLayer(touchModeBits.value) === 'scrollback') gesturing.value = true;
    })
    .onStart((event) => {
      // Selecting owns the finger. The transform is not touched at all -- not
      // even to land the follow ease, which would slide the page under a
      // reader who is dragging across the line they mean to copy.
      if (terminalDragIntent(selecting.value, event.numberOfPointers) === 'extend-selection') {
        selectionPointerX.value = event.x;
        selectionPointerY.value = event.y;
        selectionDragActive.value = true;
        scheduleOnRN(startSelectionDrag);
        gesturing.value = true;
        return;
      }
      // The program's finger. Nothing about the transform is touched -- not
      // the running decay, which a reader who flicked and then dragged still
      // wants to watch coast out, and not the follow ease. `gestureStartX/Y`
      // are still recorded, because a second finger landing mid-drag hands the
      // gesture back to the pan and it has to have somewhere to start from.
      if (terminalTouchDragTarget(touchModeBits.value, event.numberOfPointers) === 'program') {
        gestureStartX.value = translateX.value;
        gestureStartY.value = translateY.value;
        panAxis.value = AXIS_UNDECIDED;
        beginProgramDrag(event);
        return;
      }
      cancelAnimation(translateX);
      cancelAnimation(translateY);
      // A follower is almost never standing still: it is a fraction of the way
      // through the ease onto the bottom that the last line started. Stopping
      // that ease where the touch happened to land leaves the pane a row or two
      // short of where it was heading and holds it there for the whole gesture,
      // and the reader sees the page slide BACKWARDS at the very moment they put
      // a finger down -- measurably, one jerk of up to three rows on every
      // swipe. Finishing it costs nothing: the bottom is where the animation was
      // going anyway.
      if (followOutput.value) {
        translateY.value = terminalRestOffset(
          animatedVisibleHeight.value - contentHeight * scale.value,
          animatedTopInset.value,
          historyHeight * scale.value
        );
      }
      gestureStartX.value = translateX.value;
      gestureStartY.value = translateY.value;
      pullDistance.value = 0;
      panAxis.value = AXIS_UNDECIDED;
      gesturing.value = true;
    })
    .onUpdate((event) => {
      const intent = terminalDragIntent(selecting.value, event.numberOfPointers);
      // A second finger during a selection is a pinch or a tab swipe, and both
      // are running simultaneously with this one. Yanking the selection's far
      // end to wherever the centroid went is not a third answer.
      if (intent === 'ignore') {
        selectionDragActive.value = false;
        return;
      }
      if (intent === 'extend-selection') {
        selectionPointerX.value = event.x;
        selectionPointerY.value = event.y;
        selectionDragActive.value = true;
        const cell = cellAtViewportPoint(
          event.x,
          event.y,
          {
            cellWidth,
            lineHeight,
            scale: scale.value,
            translateX: translateX.value,
            translateY: translateY.value + pullDistance.value,
            horizontalPadding,
            verticalPadding,
          },
          gridRows,
          gridColumns
        );
        // Only on a cell change. The finger moves at frame rate; the selection
        // changes at cell rate, which is an order of magnitude less often, and
        // that is how often the pane is asked to re-render.
        if (cell.row === focusRow.value && cell.column === focusColumn.value) return;
        focusRow.value = cell.row;
        focusColumn.value = cell.column;
        scheduleOnRN(applySelection, {
          anchor: { row: anchorRow.value, column: anchorColumn.value },
          focus: cell,
        });
        return;
      }
      if (terminalTouchDragTarget(touchModeBits.value, event.numberOfPointers) === 'program') {
        // A drag that began as a pan and is only now the program's -- the mode
        // flipped under the finger, which `vim` does the instant it starts.
        if (!programDragActive.value) beginProgramDrag(event);
        else trackProgramDrag(event);
        return;
      }
      if (programDragActive.value) {
        // A second finger landed. The scrollback takes the gesture back, and
        // has to take it back from where the content actually is: the pan is
        // driven by `event.translationX/Y`, which has been accumulating for the
        // whole of the program's part of this drag and would otherwise jump the
        // content by all of it on the very next frame.
        endProgramDrag();
        gestureStartX.value = translateX.value - event.translationX;
        gestureStartY.value = translateY.value - event.translationY;
        panAxis.value = AXIS_UNDECIDED;
        gesturing.value = true;
      }
      // See `terminalPullOvershoot`: how far past the top stop this drag is
      // asking to go, independent of where the gesture itself started.
      const minY = animatedVisibleHeight.value - contentHeight * scale.value;
      const topStop = terminalTopStop(minY, animatedTopInset.value);
      const overshoot = terminalPullOvershoot(gestureStartY.value, event.translationY, topStop);
      if (
        canLoadEarlier &&
        overshoot > 0 &&
        Math.abs(event.translationY) > Math.abs(event.translationX)
      ) {
        pullDistance.value = Math.min(68, overshoot * 0.44);
        return;
      }
      pullDistance.value = 0;

      // Reading a terminal is almost always vertical. Without an axis lock a
      // thumb travelling up the screen drifts a few pixels sideways and the
      // whole grid slides with it, which reads as the pane being knocked out of
      // alignment. Once a direction is established the gesture commits to it
      // for the rest of the drag.
      if (panAxis.value === AXIS_UNDECIDED) {
        const dx = Math.abs(event.translationX);
        const dy = Math.abs(event.translationY);
        if (Math.max(dx, dy) >= AXIS_LOCK_DISTANCE) {
          panAxis.value = dx > dy * AXIS_LOCK_BIAS ? AXIS_HORIZONTAL : AXIS_VERTICAL;
        }
      }

      const minX = terminalPanMinX(viewport.width, textWidth, scale.value);
      if (panAxis.value !== AXIS_VERTICAL) {
        translateX.value = Math.max(minX, Math.min(0, gestureStartX.value + event.translationX));
      }
      if (panAxis.value !== AXIS_HORIZONTAL) {
        translateY.value = clampScrollOffset(
          gestureStartY.value + event.translationY,
          minY,
          animatedTopInset.value,
          historyHeight * scale.value
        );
        // Following is a position, not a mode the touch cancels. Clearing it the
        // moment a finger landed meant a swipe that never left the bottom -- one
        // that is clamped there and moves nothing at all -- came back as a
        // reader parked in history: the frame the release applied was pushed
        // BACK by the rows the window had trimmed, and then the decay handed
        // follow straight back and it was hauled forward again. Two corrections
        // in opposite directions on one release, which is a jolt in each
        // direction for every swipe.
        //
        // The threshold is distance from the rest anchor, in both directions --
        // see `terminalFollowsOutput`, which is also where the bug the second
        // direction fixes is written down (card #828). For every pane that
        // prints the anchor IS the bottom, so this is unchanged there; on a
        // screen-owning pane the anchor floats above the bottom by however much
        // its live screen overflows the viewport, and asking only "at or below
        // the anchor" made that whole overflow read as following -- which is
        // the pane springing back under the reader's thumb.
        followOutput.value = terminalFollowsOutput(
          translateY.value,
          terminalRestOffset(minY, animatedTopInset.value, historyHeight * scale.value)
        );
      }
    })
    .onEnd((event) => {
      // No momentum for a program drag either, and for a sharper reason than
      // the selection's: a decay would keep posting wheel events into a PTY
      // for half a second after the finger left, and the program on the far
      // side would still be redrawing when the reader reached for the next
      // thing. The tail the frame callback had not yet sent goes out here.
      if (programDragActive.value) {
        endProgramDrag();
        return;
      }
      // No momentum for a selection: the far end is where the finger left it,
      // and a highlight that coasted on past would be a copy the reader did not
      // ask for.
      if (selecting.value) return;
      if (pullDistance.value > 0) {
        const shouldLoad = pullDistance.value >= 46;
        // `timing` is a worklet, which is what makes it safe to call from
        // inside this gesture callback -- see the note on it in `motion.ts`.
        pullDistance.value = withTiming(0, timing('short'));
        if (shouldLoad && onLoadEarlier && !loadingEarlier) {
          scheduleOnRN(onLoadEarlier);
        }
        return;
      }
      const minX = terminalPanMinX(viewport.width, textWidth, scale.value);
      const minY = animatedVisibleHeight.value - contentHeight * scale.value;
      // Momentum follows the axis the drag committed to, so a flick up cannot
      // coast sideways after the finger has left the screen.
      if (panAxis.value !== AXIS_VERTICAL) {
        coasting.value += 1;
        translateX.value = withDecay({ velocity: event.velocityX, clamp: [minX, 0] }, () => {
          coasting.value = Math.max(0, coasting.value - 1);
        });
      }
      if (panAxis.value !== AXIS_HORIZONTAL) {
        coasting.value += 1;
        translateY.value = withDecay(
          {
            velocity: event.velocityY,
            clamp: [
              terminalBottomStop(minY, animatedTopInset.value, historyHeight * scale.value),
              terminalTopStop(minY, animatedTopInset.value),
            ],
          },
          (finished) => {
            coasting.value = Math.max(0, coasting.value - 1);
            // Reanimated calls this on cancellation as well as completion --
            // `valueSetter` fires `callback(false)` before installing whatever
            // replaced this decay, whether that is a second flick's own decay
            // or a gesture that landed mid-coast. `minY` and `historyHeight`
            // above are plain numbers closed over at the moment THIS flick
            // ended, not shared values a worklet can re-read later, so by the
            // time a superseded decay's callback actually runs -- which,
            // unlike every per-frame gesture callback in this file, is never
            // rebound to a fresh render -- they can already describe a pane
            // that has since printed more output and moved on. Recomputing
            // `followOutput` from that stale pair and writing it unconditionally
            // is exactly the bug: a second, still-in-flight flick has already
            // set `followOutput` correctly from live data, and this write can
            // land after it and clobber it back. `finished` is precisely the
            // signal for whether that happened -- true only when this decay
            // ran to its own natural end, uninterrupted, which is the one case
            // where the values it closed over are still the values that made
            // it stop. `false` means something newer is already in charge of
            // the answer, and this callback's only job left is the coast count
            // above (measured live: three of these firing back to back with
            // `gesturing: true`, i.e. a second gesture already active, is what
            // exposed it).
            if (!finished) return;
            followOutput.value = terminalFollowsOutput(
              translateY.value,
              terminalRestOffset(minY, animatedTopInset.value, historyHeight * scale.value)
            );
          }
        );
      }
    })
    .onFinalize(() => {
      // Idempotent, and reached from here as well as from `onEnd` because a
      // cancelled drag -- a call arriving, the app going to the background --
      // still owes the far side the release of a button it was told was down.
      endProgramDrag();
      pullDistance.value = withTiming(0, timing('short'));
      panAxis.value = AXIS_UNDECIDED;
      gesturing.value = false;
      selectionDragActive.value = false;
      // Here rather than in `onEnd` so a cancelled drag floats the bar too: the
      // selection outlives the gesture that made it, and a reader whose gesture
      // was interrupted still has a highlight and still needs the Copy button.
      if (selecting.value) scheduleOnRN(endSelectionDrag);
    });

  const pinchGesture = Gesture.Pinch()
    .onBegin((event) => {
      cancelAnimation(translateX);
      cancelAnimation(translateY);
      // Same as the pan: land the follow ease before taking the transform over.
      if (followOutput.value) {
        translateY.value = terminalRestOffset(
          animatedVisibleHeight.value - contentHeight * scale.value,
          animatedTopInset.value,
          historyHeight * scale.value
        );
      }
      gestureStartScale.value = scale.value;
      gestureStartX.value = translateX.value;
      gestureStartY.value = translateY.value;
      focalX.value = event.focalX;
      focalY.value = event.focalY;
      // Watching, not zooming. Android begins this recogniser on the first
      // pointer of any drag, so `began` is where a plain scroll lives too --
      // and that is why the freeze is not taken here in the two program layers.
      // One finger on Android reaches this line, and freezing the picture for
      // it would hold vim's own redraw off the screen for the whole of a drag
      // that is meant to be driving it. A real pinch takes the freeze in
      // `onStart` below, which is the edge that only a zoom crosses.
      if (terminalTouchLayer(touchModeBits.value) === 'scrollback') gesturing.value = true;
      pinchPhase.value = 'began';
    })
    // The recogniser has decided the two fingers really are changing the span:
    // the only edge that means "a zoom is happening" -- still tracked for
    // `longPressArms` below, which must not let a long press win a race a
    // pinch already started.
    .onStart(() => {
      gesturing.value = true;
      pinchPhase.value = 'active';
    })
    .onUpdate((event) => {
      const nextScale = pinchedTerminalScale(gestureStartScale.value, event.scale);
      const ratio = nextScale / gestureStartScale.value;
      const nextX = focalX.value - (focalX.value - gestureStartX.value) * ratio;
      const nextY = focalY.value - (focalY.value - gestureStartY.value) * ratio;
      const minX = terminalPanMinX(viewport.width, textWidth, nextScale);
      const minY = animatedVisibleHeight.value - contentHeight * nextScale;
      scale.value = nextScale;
      translateX.value = Math.max(minX, Math.min(0, nextX));
      translateY.value = clampScrollOffset(
        nextY,
        minY,
        animatedTopInset.value,
        historyHeight * nextScale
      );
      // Same rule as the pan: a pinch that leaves the last line on screen is
      // still a reader watching the bottom, and zooming out used to park them.
      followOutput.value = terminalFollowsOutput(
        translateY.value,
        terminalRestOffset(minY, animatedTopInset.value, historyHeight * nextScale)
      );
    })
    .onFinalize(() => {
      gesturing.value = false;
      pinchPhase.value = 'idle';
    });

  // Both fingers of the gesture below: one object for the life of the pane,
  // mutated in place. Held in state rather than in a ref because it is read
  // inside callbacks handed to the gesture builder as this renders, which is
  // exactly the shape the refs lint rule forbids -- and it is genuinely not a
  // ref's job: nothing here is ever replaced, only written through.
  const [twoFingerTracking] = useState<TwoFingerTracking>(() => ({
    start: null,
    latest: null,
    abandoned: false,
  }));

  /**
   * The two-finger swipe that cycles the workspace's tabs.
   *
   * A pan of its own rather than a wrapper reading React Native's touches,
   * which never see this gesture at all (`useTabSwipe` has the measurements).
   * It is simultaneous with the canvas's own pan and pinch and never fights
   * them: two fingers still pan and still zoom while this is deciding, and if
   * the pair turns out to have been a pinch it does nothing, so the reader who
   * was zooming is not thrown onto another tab.
   *
   * Both fingers are read from `allTouches` rather than from the pan's
   * translation, because the quantity that separates the two gestures is the
   * one a centroid cannot see: how much the gap between the fingers changed.
   *
   * `runOnJS` because everything it does is JS work -- a comparison and a
   * callback at the end of the gesture, never per frame -- and nothing here
   * touches the transform.
   */
  const twoFingerSwipeGesture = Gesture.Pan()
    .runOnJS(true)
    .enabled(Boolean(onTwoFingerSwipe))
    .minPointers(2)
    .minDistance(TWO_FINGER_MIN_DISTANCE)
    .onTouchesDown((event) => {
      sampleTwoFingers(twoFingerTracking, event.allTouches);
    })
    .onTouchesMove((event) => {
      sampleTwoFingers(twoFingerTracking, event.allTouches);
    })
    .onEnd(() => {
      const { start, latest, abandoned } = twoFingerTracking;
      if (abandoned || !start || !latest) return;
      const gesture = classifyTwoFingerGesture(start, latest);
      // `pinch` and `none` are both silence. The canvas has already answered
      // the pinch by zooming, and it must not also change what is being zoomed.
      if (gesture === 'next' || gesture === 'previous') {
        if (tabSwipeClearsSelection(selecting.value, true)) clearSelection();
        onTwoFingerSwipe?.(gesture);
      }
    })
    .onFinalize(() => {
      resetTwoFingers(twoFingerTracking);
    });

  const singleTapGesture = Gesture.Tap()
    .runOnJS(true)
    .maxDistance(12)
    .maxDuration(600)
    .onEnd((event, success) => {
      if (!success) return;
      // A tap anywhere puts the selection down. It is the gesture every text
      // surface on both platforms uses for exactly this, and it has to come
      // before the link test: a tap that landed on a link inside the highlight
      // means "I am done", not "open this".
      if (selecting.value) {
        clearSelection();
        return;
      }
      // A program reporting the mouse gets the tap, and gets it before the link
      // test rather than after. The links this pane draws are found by pattern
      // in whatever text is on screen, and inside a full-screen program that
      // text is a file being edited: a tap on a path in a vim buffer means
      // "put the cursor here", never "open this". Nor does the keyboard fall,
      // for the same reason -- the program asked for the click.
      if (terminalTouchLayer(touchModeBits.value) === 'mouse') {
        emitProgramTap(programCellAt(event.x, event.y));
        return;
      }
      const link = linkAtViewportPoint(
        links,
        event.x,
        event.y,
        cellWidth,
        lineHeight,
        scale.value,
        translateX.value,
        translateY.value
      );
      if (link?.kind === 'file') {
        // No handler means nothing can open it, so the tap falls through to the
        // dismiss below rather than looking like a dead link.
        if (onFileLink) {
          onFileLink(link.uri);
          return;
        }
      } else if (link) {
        void openTerminalLink(link.uri);
        return;
      }
      // A tap that hit no link dismisses the keyboard, so the output can be read
      // without reaching for a separate control.
      Keyboard.dismiss();
    });

  const doubleTapGesture = Gesture.Tap()
    .runOnJS(true)
    .numberOfTaps(2)
    .maxDistance(16)
    .maxDuration(250)
    .maxDelay(250)
    .onEnd((event, success) => {
      if (!success) return;
      const cell = cellAtViewportPoint(
        event.x,
        event.y,
        {
          cellWidth,
          lineHeight,
          scale: scale.value,
          translateX: translateX.value,
          translateY: translateY.value,
          horizontalPadding,
          verticalPadding,
        },
        gridRows,
        gridColumns
      );
      selectLine(cell);
    });

  /**
   * The press that turns the pane from something you read into something you
   * pick text out of.
   *
   * `longPressArms` is the whole arbitration and its file has the argument; the
   * short version is that the recogniser's own `maxDistance` covers a press
   * that travelled, and this covers the three cases it cannot see -- a second
   * finger, a pan that has already committed to an axis, and a fling still
   * coasting under a finger that has only just landed.
   *
   * Not `runOnJS`: the anchor has to be written on the UI thread, because the
   * very next thing that happens is a drag reading it from there, and a hop to
   * JS and back is a hop the first few pixels of that drag would arrive during.
   */
  const longPressGesture = Gesture.LongPress()
    .numberOfPointers(1)
    .minDuration(TERMINAL_LONG_PRESS_MS)
    .maxDistance(TERMINAL_LONG_PRESS_SLOP)
    .shouldCancelWhenOutside(false)
    .onStart((event) => {
      if (
        !longPressArms({
          pointerCount: event.numberOfPointers,
          panning: panAxis.value !== AXIS_UNDECIDED,
          pinching: pinchPhase.value === 'active',
          coasting: coasting.value > 0,
        })
      ) {
        return;
      }
      // Under `?1002` this press is the program's, not a selection: see
      // `terminalTouchPressDrags`. The button goes down here and the pan, which
      // is simultaneous with this and has not committed to an axis while the
      // finger was still, carries the motion from wherever it goes next.
      if (terminalTouchPressDrags(touchModeBits.value)) {
        const target = programCellAt(event.x, event.y);
        programCellRow.value = target.row;
        programCellColumn.value = target.column;
        programDragHeld.value = true;
        programTravelRows.value = 0;
        programTravelColumns.value = 0;
        programEmittedRows.value = 0;
        programEmittedColumns.value = 0;
        // Active straight away, so a press that is lifted without ever moving
        // still owes -- and sends -- its release. The origin arrives with the
        // pan's next update; see `programRebase`.
        programRebase.value = true;
        programDragActive.value = true;
        scheduleOnRN(emitProgramPress, { row: target.row, column: target.column });
        return;
      }
      const cell = cellAtViewportPoint(
        event.x,
        event.y,
        {
          cellWidth,
          lineHeight,
          scale: scale.value,
          translateX: translateX.value,
          translateY: translateY.value + pullDistance.value,
          horizontalPadding,
          verticalPadding,
        },
        gridRows,
        gridColumns
      );
      selecting.value = true;
      anchorRow.value = cell.row;
      anchorColumn.value = cell.column;
      focusRow.value = cell.row;
      focusColumn.value = cell.column;
      // The word under the finger needs the frame's cells, which live on the JS
      // side. The cell above is a usable selection on its own, so the highlight
      // is up on this frame and the widening lands a tick later.
      scheduleOnRN(beginSelection, cell);
    })
    // A press that armed the program's button and was then lifted without ever
    // travelling far enough to activate the pan never reaches the pan's own
    // finalizer, and the button would stay down. Only what this press armed,
    // though: the recogniser also finalizes by FAILING, which is what an
    // ordinary wheel drag does to it a few pixels in, and ending that drag from
    // here would cut it in half.
    .onFinalize(() => {
      if (programDragHeld.value) endProgramDrag();
    });

  // One combined transform on a single group rather than a translate group
  // wrapping a scale group: two nested transforms composite independently, and
  // per-frame subpixel differences between them showed as a faint double image
  // (ghosting) while pinching. Order matches the old nesting: translate, then
  // scale.
  // Translation snaps to whole device pixels. At a fractional offset every
  // glyph rasterizes at a different subpixel phase, and when the offset is
  // CHANGING -- a pan, or the 90ms follow-bottom ease while output streams --
  // the phase churns per frame and the text visibly swims. Integer device-pixel
  // steps keep each glyph's rasterization phase constant at any resting scale.
  // Scale is deliberately not snapped: quantizing a pinch reads as stutter.
  const devicePixelRatio = PixelRatio.get();
  /*
    The transform the canvas is actually drawn at, which is not always the one
    the gesture is at.

    Every write to this value costs a redraw, and a redraw is the expensive
    thing here -- not the drawing. Measured on an emulator against a live
    gateway pane, interleaved so host load falls on both arms equally: a pan
    over the full terminal and the same pan with the entire scene replaced by
    one eight-pixel rectangle cost the same, 92.3ms against 90.9ms a frame, and
    rendered the same number of frames. The content is not what is being paid
    for. What is paid for runs once per change of this value whatever it draws:
    the reanimated property commit, re-recording the scene, and the redraw it
    asks for -- a full-surface clear, a draw and a blocking buffer swap, on
    Android on the main thread.

    So during a gesture the value is committed at half rate. The finger still
    samples at the display's rate and every clamp, decay and hit test still sees
    every value -- this is the last step before the pixels and nothing upstream
    of it changes. What it buys is that the redraw is asked for half as often,
    which is the only quantity that was ever making this slow.

    Outside a gesture nothing is dropped. An eased scroll or a follow-bottom
    catch-up is short, already smooth, and rare enough that halving it would be
    a visible cost for no gain.
  */
  const committedTranslateX = useSharedValue(0);
  const committedTranslateY = useSharedValue(0);
  const committedScale = useSharedValue(1);
  /** 1 once the frame callback below has taken over pacing for this gesture. */
  const commitPaced = useSharedValue(0);
  /**
   * The gesture's commit, run once per display frame instead of once per touch.
   *
   * Touch arrives faster than the display can show it, and every write pays the
   * whole cost: the property commit, a re-record of the scene, and a redraw
   * request that ends in a full-surface clear, a draw and a blocking buffer
   * swap on the main thread. Measured here on a 500ms pan: the transform was
   * written 40 times and the app presented 4 frames. Thirty-six of those writes
   * did all of that work for pixels nobody ever saw.
   *
   * A frame callback is the display's own clock, so it cannot write more than
   * once per frame however fast the digitizer samples, and it writes the newest
   * value rather than an averaged or a delayed one. It also paces itself to
   * whatever rate the device is actually achieving. On hardware quick enough to
   * present every frame this changes nothing that reaches the screen.
   *
   * What it does NOT do is smooth anything or hold anything back: every clamp,
   * decay and hit test upstream still sees every touch. This is the last step
   * before the pixels and nothing above it is aware of it.
   */
  const gestureCommitFrame = useFrameCallback(() => {
    'worklet';
    commitPaced.value = 1;
    committedTranslateX.value = translateX.value;
    committedTranslateY.value = translateY.value + pullDistance.value;
    committedScale.value = scale.value;
  }, false);
  useAnimatedReaction(
    () => ({
      x: translateX.value,
      y: translateY.value + pullDistance.value,
      s: scale.value,
      moving: gesturing.value || coasting.value > 0,
    }),
    (live) => {
      // Paced only once the callback is actually running. Registering it is a
      // hop to the JS thread and back (see the effect below), and the frames in
      // that gap still have to reach the screen -- a gesture that began with a
      // hitch would be a poor trade for the frames it saved.
      if (live.moving && commitPaced.value === 1) return;
      committedTranslateX.value = live.x;
      committedTranslateY.value = live.y;
      committedScale.value = live.s;
    }
  );
  const [gestureMoving, setGestureMoving] = useState(false);
  useAnimatedReaction(
    () => gesturing.value || coasting.value > 0,
    (moving, wasMoving) => {
      if (moving === wasMoving) return;
      if (moving) {
        commitPaced.value = 0;
      } else {
        // The callback stops on the frame the gesture ends, and the finger's
        // last position lands after it. Written straight through so a release
        // cannot leave the pane a frame short of where it was let go.
        committedTranslateX.value = translateX.value;
        committedTranslateY.value = translateY.value + pullDistance.value;
        committedScale.value = scale.value;
      }
      scheduleOnRN(setGestureMoving, moving);
    }
  );
  // Registered and unregistered from the JS thread, which is the only thread
  // that may: `setActive` mutates reanimated's callback registry, and calling it
  // from a worklet corrupts it (measured -- it throws inside
  // `manageStateFrameCallback` and takes the screen down with it).
  useEffect(() => {
    gestureCommitFrame.setActive(gestureMoving);
    return () => gestureCommitFrame.setActive(false);
  }, [gestureCommitFrame, gestureMoving]);
  const contentTransform = useDerivedValue(() => {
    const snap = (value: number) => Math.round(value * devicePixelRatio) / devicePixelRatio;
    return [
      { translateX: snap(committedTranslateX.value) },
      { translateY: snap(committedTranslateY.value) },
      { scale: committedScale.value },
    ];
  });
  /**
   * How much of the hint's resting weight is still owed: 1 on arrival, 0 once
   * it has been seen.
   *
   * Keyed on the pane as well as on there being anything to pull, because both
   * are the same event from the reader's side -- this is a new pane with more
   * output above it -- and because `canLoadEarlier` is only true once the
   * scrollback metrics have arrived, which is after the pane is on screen. A
   * timer started at mount would have spent itself before the pill existed.
   *
   * A pane with nothing above it never renders the pill at all, and this never
   * runs for it.
   */
  const historyHintIntro = useSharedValue(1);
  useEffect(() => {
    if (!canLoadEarlier) return;
    cancelAnimation(historyHintIntro);
    historyHintIntro.value = 1;
    historyHintIntro.value = withDelay(
      TERMINAL_HISTORY_HINT_INTRO_MS,
      withTiming(0, timing('medium'))
    );
  }, [canLoadEarlier, historyHintIntro, terminalId]);

  // The intro flash above fires once, on arrival at the *pane* -- and a pane
  // with hundreds of rows of scrollback takes several seconds to scroll
  // through, so by the time a reader's own scrolling actually reaches the
  // top of the loaded window, that flash is long over and the hint has
  // already faded to nothing. They arrive at the one place the offer matters
  // to find no sign one was ever made, and pulling further -- the only
  // remaining way to discover the capability -- is not something arriving at
  // a wall of text suggests trying (card #784).
  //
  // Re-arming the same flash on a rising edge into "resting at the top stop"
  // answers that: the offer is restated exactly when the reader is standing
  // where it applies, not only at a moment they have not scrolled anywhere
  // yet. `wasAtTop` starts `undefined`, not `false`, so mounting already
  // resting at the top (a pane too short to scroll) can also light it --
  // consistent with the arrival flash, and harmless where both fire together.
  useAnimatedReaction(
    () => {
      const minY = animatedVisibleHeight.value - contentHeight * scale.value;
      return translateY.value >= terminalTopStop(minY, animatedTopInset.value) - 1;
    },
    (isAtTop, wasAtTop) => {
      if (!isAtTop || wasAtTop || !canLoadEarlier) return;
      cancelAnimation(historyHintIntro);
      historyHintIntro.value = 1;
      historyHintIntro.value = withDelay(
        TERMINAL_HISTORY_HINT_INTRO_MS,
        withTiming(0, timing('medium'))
      );
    }
  );

  const pullIndicatorStyle = useAnimatedStyle(() => ({
    opacity: historyHintOpacity(pullDistance.value, loadingEarlier, historyHintIntro.value),
    transform: [{ translateY: Math.min(8, pullDistance.value * 0.16) }],
  }));
  // The tab swipe joins the pan, the pinch, and the long press in one flat
  // `Simultaneous` with the tap.
  //
  // Flat on purpose. Wrapping it round the outside instead --
  // `Simultaneous(swipe, Exclusive(tap, Simultaneous(pan, pinch)))` -- reads
  // the same and is not: a nested `Simultaneous` drops the simultaneity handed
  // down to it by its parent (`SimultaneousGesture.prepare` ignores
  // `this.simultaneousGestures`), so the pan and the pinch never learn about
  // the swipe. Measured: with that shape, a two-finger spread on the emulator
  // began the pinch and never updated it -- the size pill came up reading
  // "Default · 100%" and the text did not grow.
  //
  // Tap priority is wired directly with `requireExternalGestureToFail` below,
  // rather than with `Gesture.Exclusive(tap, ...)`, which is the tempting
  // shape and the wrong one: `ExclusiveGesture.prepare` hands its
  // `requireToFail` down to *every* member of a nested `Simultaneous`
  // uniformly, whether that member can ever be confused with a tap or not
  // (`gestureComposition.ts`). Pan and the long press genuinely can -- both
  // start as a single, near-stationary finger -- so they earn the wait. The
  // pinch and the two-finger swipe cannot; they need a second real pointer,
  // which a tap never has. Under `Exclusive` they waited anyway, and lost:
  // tap fails on distance almost immediately for an unhurried drag, but its
  // failure only reliably lands on a *further* touch-move to re-evaluate
  // against, and a quick, decisive pinch -- exactly what a fast flick
  // produces, synthetic or real -- can finish before that re-evaluation
  // arrives. The whole flat group then sat in BEGAN and tore down at
  // `onFinalize` without the pinch ever reaching ACTIVE: measured live with
  // `agent-device gesture pinch`, which reported success while `onStart` and
  // `onUpdate` never fired, only `onBegin` then `onFinalize`, and confirmed by
  // running the pinch alone (activates instantly) and by running it alongside
  // just the pan (also fine) -- it was specifically the tap's `requireToFail`
  // reaching into the pinch that stalled it. A pinch held open long enough
  // (900ms, well past tap's own 600ms `maxDuration`) did eventually activate,
  // which is what gave the mechanism away.
  //
  // The long press still costs about 100ms waiting on the tap -- the tap does
  // not fail until its own 600ms `maxDuration` is up, so the press arms then
  // rather than at 500. That is the right way round -- a link tap must never
  // wait on a long press -- and the haptic is what tells the reader it landed.
  panGesture.requireExternalGestureToFail(doubleTapGesture);
  panGesture.requireExternalGestureToFail(singleTapGesture);
  longPressGesture.requireExternalGestureToFail(doubleTapGesture);
  longPressGesture.requireExternalGestureToFail(singleTapGesture);
  const tapGesture = Gesture.Exclusive(doubleTapGesture, singleTapGesture);
  const gesture = Gesture.Simultaneous(
    tapGesture,
    panGesture,
    pinchGesture,
    twoFingerSwipeGesture,
    longPressGesture
  );

  /**
   * The measured box, committed once it has held still -- see
   * `VIEWPORT_SETTLE_MS` for why it is not committed as it moves.
   *
   * The first measurement is the exception and lands at once: there is nothing
   * for it to be in flight from, and the grid has to have a size before it can
   * draw anything at all.
   */
  function handleLayout(event: LayoutChangeEvent) {
    const { width, height } = event.nativeEvent.layout;
    const next = { width: Math.round(width), height: Math.round(height) };
    const commit = () =>
      setViewport((current) =>
        current.width === next.width && current.height === next.height ? current : next
      );
    if (viewportSettleRef.current) clearTimeout(viewportSettleRef.current);
    if (!viewportMeasuredRef.current) {
      viewportMeasuredRef.current = true;
      commit();
      return;
    }
    viewportSettleRef.current = setTimeout(() => {
      viewportSettleRef.current = null;
      commit();
    }, VIEWPORT_SETTLE_MS);
  }

  // One snap per send, not one per frame. The layout values in the dependency
  // list re-run this effect on every streamed frame -- the trailing blank rows
  // of a tail read fluctuate, so `contentHeight` ticks while an agent prints
  // -- and re-running the body meant every frame hauled a reader who had
  // scrolled into history back to the bottom (and handed `followOutput` back,
  // so the catch-up ease kept them there). The ref pins the effect's action to
  // the nonce actually advancing: the send is the event, the rest of the
  // dependencies are merely the numbers the snap is computed from.
  const stickBottomHandled = useRef(stickBottomNonce);
  useEffect(() => {
    if (stickBottomNonce <= 0 || stickBottomNonce === stickBottomHandled.current) return;
    stickBottomHandled.current = stickBottomNonce;
    followOutput.value = true;
    translateY.value = withTiming(
      terminalRestOffset(
        animatedVisibleHeight.value - contentHeight * scale.value,
        animatedTopInset.value,
        historyHeight * scale.value
      ),
      timing('short')
    );
  }, [
    animatedTopInset,
    animatedVisibleHeight,
    contentHeight,
    followOutput,
    historyHeight,
    scale,
    stickBottomNonce,
    translateY,
  ]);

  /**
   * The highlight, in the content's own coordinates.
   *
   * Drawn as its own Skia nodes above the recorded blocks, never into them. A
   * block's key is its rows and its layout and nothing else (see
   * `terminalChunkLayoutKey`), which is what lets a streaming pane re-draw a
   * display list one row higher instead of recording it again -- and a selection
   * baked into a recording would make every block the highlight touches a block
   * that has to be recorded per drag frame and thrown away on release. The
   * rectangles cost a handful of nodes and the cache never hears about them.
   */
  const highlightRects = useMemo(() => {
    if (!selection) return [];
    return selectionRects(selectionSpans(frame.lines, selection, frame.columns), {
      cellWidth,
      lineHeight,
      horizontalPadding,
      verticalPadding,
    });
  }, [cellWidth, frame.columns, frame.lines, lineHeight, selection]);

  const selectionFill = useMemo(
    () => withOpacity(paneTheme.selection, TERMINAL_SELECTION_OPACITY),
    [paneTheme.selection]
  );

  const copySelection = useCallback(() => {
    if (!selection) return;
    const text = selectionText(frame.lines, selection, frame.columns);
    if (text === '') {
      clearSelection();
      return;
    }
    void Clipboard.setStringAsync(text)
      .then(() => {
        void feedback('success');
        showToast({ variant: 'success', message: t`Copied to clipboard` });
      })
      .catch(() => {
        void feedback('error');
        showToast({ variant: 'danger', message: t`Could not copy that` });
      });
    // Not waited on: the reader is done with the selection the moment they
    // press Copy, and holding the highlight up until the OS answers reads as
    // the button not having worked.
    clearSelection();
  }, [clearSelection, frame.columns, frame.lines, selection, showToast, t]);

  const selectAll = useCallback(() => {
    const all = selectAllSelection(frame.lines);
    if (!all) return;
    selecting.value = true;
    anchorRow.value = all.anchor.row;
    anchorColumn.value = all.anchor.column;
    focusRow.value = all.focus.row;
    focusColumn.value = all.focus.column;
    setSelection(all);
    void feedback('selection');
  }, [anchorColumn, anchorRow, focusColumn, focusRow, frame.lines, selecting, setSelection]);

  // Copy is offered only when there is something to copy. A highlight that has
  // caught nothing but the padding to the right of a short line is easy to make
  // by accident, and a Copy that silently puts an empty string on the clipboard
  // is worse than no button.
  const selectionHasText = useMemo(() => {
    if (!selection) return false;
    return !selectionIsBlank(frame.lines, selection, frame.columns);
  }, [frame.columns, frame.lines, selection]);

  function jumpToLatest() {
    followOutput.value = true;
    translateY.value = withTiming(
      terminalRestOffset(
        animatedVisibleHeight.value - contentHeight * scale.value,
        animatedTopInset.value,
        historyHeight * scale.value
      ),
      timing('short')
    );
  }

  return (
    <View onLayout={handleLayout} style={[styles.shell, { backgroundColor: paneTheme.background }]}>
      <GestureDetector gesture={gesture}>
        <Canvas opaque style={styles.canvas}>
          <Fill color={paneTheme.background} />
          <Group transform={contentTransform}>
            {chunkDraws.map((chunk, index) => (
              // A block records its rows from its own first row down and is
              // placed by this transform, which is what lets a recording outlive
              // the rows underneath it scrolling: a streaming pane re-draws the
              // same display list one row higher instead of recording it again.
              // The transform is a constant, not an animated value -- the one
              // above it is the only thing moving, so there is no second live
              // transform for this one to disagree with per frame.
              //
              // The key is positional on purpose: these are interchangeable
              // siblings, and keying by content would collide the moment two
              // blocks held the same rows.
              <Group key={index} clip={chunk.clip} transform={chunk.transform}>
                <Picture picture={chunk.picture} />
              </Group>
            ))}
            {/*
              Above the text, not behind it: a terminal's own background runs
              cell-to-cell and a highlight painted underneath would be invisible
              on every row an agent gave a background colour to. Translucent, so
              the text it is describing stays readable through it -- the reader
              is checking what they grabbed.
            */}
            {highlightRects.map((highlight, index) => (
              <Rect
                key={index}
                x={highlight.x}
                y={highlight.y}
                width={highlight.width}
                height={highlight.height}
                color={selectionFill}
              />
            ))}
            {frame.cursor.visible && hasOutput ? (
              // A slim beam caret rather than a full-cell underline: the
              // underline read as a stray horizontal bar sitting under the
              // last line.
              //
              // `output` as well, because a pane that has not answered yet
              // parses to one empty row with the cursor at its origin -- and
              // the grid is anchored to the bottom, so that origin is the
              // bottom-left corner of the screen. The caret for a screen that
              // does not exist yet drew as a blue tick in the corner of the
              // connecting spinner, under the logo, pointing at nothing.
              <Rect
                x={horizontalPadding + frame.cursor.column * cellWidth}
                y={verticalPadding + frame.cursor.row * lineHeight + 2}
                width={2}
                height={lineHeight - 4}
                color={paneTheme.cursor}
              />
            ) : null}
          </Group>
        </Canvas>
      </GestureDetector>
      {canLoadEarlier || loadingEarlier ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.historyIndicator,
            {
              top: historyIndicatorTopInset,
              backgroundColor: theme.colors.surfaceRaised,
              borderColor: theme.colors.border,
            },
            pullIndicatorStyle,
          ]}>
          {loadingEarlier ? <ActivityIndicator size={12} color={theme.colors.primary} /> : null}
          <Text style={[styles.historyIndicatorText, { color: theme.colors.textMuted }]}>
            {loadingEarlier ? t`Loading earlier output…` : t`Pull for earlier output`}
          </Text>
        </Animated.View>
      ) : null}
      {/*
        The selection's own controls, floated once the finger is off the glass.
        Bottom-centre and within a thumb's reach, in the same place -- and only
        ever one at a time -- as the Latest button below, which stands down
        while a selection is up.
      */}
      {selection && !selectionDragging ? (
        <View
          style={[
            styles.selectionBar,
            {
              bottom: 14 + bottomInset,
              backgroundColor: theme.colors.surfaceRaised,
              borderColor: theme.colors.border,
            },
          ]}>
          <Button
            variant="ghost"
            disabled={!selectionHasText}
            onPress={copySelection}
            style={styles.selectionAction}
            testID="terminal-selection-copy">
            {t`Copy`}
          </Button>
          <Button
            variant="ghost"
            onPress={selectAll}
            style={styles.selectionAction}
            testID="terminal-selection-all">
            {t`Select all`}
          </Button>
          <Button
            variant="ghost"
            onPress={clearSelection}
            style={styles.selectionAction}
            testID="terminal-selection-cancel">
            {t`Cancel`}
          </Button>
        </View>
      ) : null}
      {latestPillVisible({ following, selecting: selection !== null, ownsScreen }) ? (
        // One of the most frequently seen controls in the app, and until now the
        // only one that appeared and vanished between two frames. It comes up
        // when the reader leaves the tail of a live stream, which is a moment
        // they are already reading through, so it arrives rather than being
        // suddenly there.
        //
        // Whether it may be here at all is `latestPillVisible`, and it is a
        // function in `dock-presentation` rather than the three `&&`s that used
        // to be on this line: the third of them -- that an editor has no
        // "latest" to jump to -- is a rule about the app, not about this view,
        // and a rule about the app belongs somewhere a test can read it.
        <Animated.View
          entering={zoomIn('micro')}
          exiting={zoomOut('micro')}
          style={[styles.latestAnchor, latestButtonStyle]}>
          <PressableScale
            accessibilityLabel={t`Jump to latest output`}
            onPress={jumpToLatest}
            style={[
              styles.latestButton,
              {
                backgroundColor: theme.colors.surfaceRaised,
                borderColor: theme.colors.border,
              },
            ]}>
            <Text style={[styles.latestButtonText, { color: theme.colors.text }]}>
              ↓ <Trans>Latest</Trans>
            </Text>
          </PressableScale>
        </Animated.View>
      ) : null}
      {/*
        Loading is centred and wordless: "Waiting for output" pinned to the
        bottom read as a message from the pane rather than as the app still
        connecting, which is what it actually meant.

        It fades out rather than being cut: this is the last thing between
        opening a pane and reading it, so it happens on every single pane open,
        and the first frame of output landing on top of a full-size logo is the
        one transition every user of this app sees most.
      */}
      {!nerdFont && fontError ? (
        <View
          pointerEvents="none"
          style={[styles.empty, { backgroundColor: paneTheme.background }]}>
          <Text style={[styles.emptyText, { color: theme.colors.textSubtle }]}>{fontError}</Text>
        </View>
      ) : !nerdFont || !hasOutput ? (
        <Animated.View
          pointerEvents="none"
          exiting={fadeOut('short')}
          style={[styles.loading, { backgroundColor: paneTheme.background }]}>
          <LogoLoader accessibilityLabel={t`Loading terminal`} size={64} />
        </Animated.View>
      ) : null}
    </View>
  );
}

type TwoFingerTracking = {
  /** Both fingers when the second one landed. */
  start: TwoFingerFrame | null;
  /** Both fingers at the most recent moment there were exactly two. */
  latest: TwoFingerFrame | null;
  /** Set by a third finger, and not cleared until the hand comes off. */
  abandoned: boolean;
};

/**
 * Records both fingers, whenever there are exactly two of them on the glass.
 *
 * Three fingers abandon the whole contact rather than the current frame:
 * lifting back down to two would otherwise measure a "swipe" from wherever the
 * third finger's departure left the pair.
 */
function sampleTwoFingers(
  tracking: TwoFingerTracking,
  touches: readonly { x: number; y: number }[]
) {
  if (touches.length > 2) {
    tracking.abandoned = true;
    return;
  }
  const frame = twoFingerFrame(touches);
  if (!frame) return;
  if (!tracking.start) tracking.start = frame;
  tracking.latest = frame;
}

/** Back to a hand that is not on the glass, once the gesture is over. */
function resetTwoFingers(tracking: TwoFingerTracking) {
  tracking.start = null;
  tracking.latest = null;
  tracking.abandoned = false;
}

type TerminalChunkDraw = {
  picture: SkPicture;
  transform: { translateY: number }[];
  clip: SkRect | undefined;
};

/**
 * A frame's blocks, plus what the commit needs to know about them: which keys it
 * drew (everything else the cache holds is superseded) and the head recording
 * the next plan should be measured against.
 */
type TerminalChunkFrame = {
  draws: TerminalChunkDraw[];
  keys: string[];
  head: TerminalHeadRecording | undefined;
};

const noChunkFrame: TerminalChunkFrame = { draws: [], keys: [], head: undefined };

/**
 * Stable ids for values whose identity, not their contents, decides whether a
 * recorded block is still valid: the palette (a fresh object per theme change)
 * and the loaded font. Comparing a whole palette on every refresh costs more
 * than tagging the object once.
 */
const renderingIdentities = new WeakMap<object, number>();
let nextRenderingIdentity = 1;

function renderingIdentity(value: object | null): number {
  if (!value) return 0;
  let identity = renderingIdentities.get(value);
  if (identity === undefined) {
    identity = nextRenderingIdentity;
    nextRenderingIdentity += 1;
    renderingIdentities.set(value, identity);
  }
  return identity;
}

/**
 * Splits the frame's links across the planned blocks.
 *
 * Blocks no longer start at a fixed multiple of anything, so this walks the plan
 * alongside the links, which `terminalFrameLinks` already emits in row order.
 */
function bucketLinksByChunk(links: TerminalLink[], plans: TerminalChunkPlan[]): TerminalLink[][] {
  const buckets: TerminalLink[][] = plans.map(() => []);
  let chunk = 0;
  for (const link of links) {
    while (chunk < plans.length && link.row >= plans[chunk].endRow) chunk += 1;
    if (chunk >= plans.length) break;
    if (link.row >= plans[chunk].startRow) buckets[chunk].push(link);
  }
  return buckets;
}

/**
 * Records rows `[startRow, endRow)` into their own display list.
 *
 * Rows are drawn at `(row - startRow) * lineHeight`, i.e. from the block's own
 * first row down, and the caller adds `verticalPadding + startRow * lineHeight`
 * back in the draw transform. Recording at the absolute content y instead -- what
 * this did before blocks became re-usable across scrolls -- pinned a recording to
 * the offset it was made at, which is precisely the thing a streaming pane
 * changes on every frame.
 *
 * Every row inside the block is still a whole multiple of `lineHeight` from the
 * block's origin, so boundaries land exactly on a row boundary and neither
 * overlap nor open a seam: the line height is a one-decimal fraction, and the
 * block origin is one multiplication rather than an accumulation, so it cannot
 * drift against the rows inside it.
 */
function recordTerminalChunk({
  lines,
  startRow,
  endRow,
  links,
  width,
  cellWidth,
  fontSize,
  lineHeight,
  fontManager,
  nerdFont,
  terminalTheme,
}: {
  lines: TerminalLine[];
  startRow: number;
  endRow: number;
  links: TerminalLink[];
  width: number;
  cellWidth: number;
  fontSize: number;
  lineHeight: number;
  fontManager: SkTypefaceFontProvider | null;
  nerdFont: SkFont | null;
  terminalTheme: TerminalTheme;
}): SkPicture {
  const recorder = Skia.PictureRecorder();
  const height = (endRow - startRow) * lineHeight;
  // The cull rect must be this block's own slice of the content and nothing
  // wider: drawPicture quick-rejects a block against the clip with a single
  // bounds test, which is what keeps off-screen blocks free per frame. The bleed
  // covers ink that legitimately leaves the line box -- descenders, synthesised
  // bold strokes, sheared italics -- since a recorder is free to cull anything
  // outside the rect it was given.
  const bleed = lineHeight;
  const canvas = recorder.beginRecording(rect(0, -bleed, width, height + bleed * 2));
  const nerdFontMetrics = nerdFont?.getMetrics();
  const nerdBaseline = nerdFontMetrics
    ? (lineHeight - (nerdFontMetrics.descent - nerdFontMetrics.ascent)) / 2 - nerdFontMetrics.ascent
    : 0;

  for (let row = startRow; row < endRow; row += 1) {
    const y = (row - startRow) * lineHeight;
    for (const run of lines[row].runs) {
      const colors = resolveColors(run.style, terminalTheme);
      if (colors.background !== terminalTheme.background) {
        const paint = getRectPaint(colors.background);
        canvas.drawRect(
          rect(
            horizontalPadding + run.startColumn * cellWidth,
            y,
            Math.max(cellWidth, (run.endColumn - run.startColumn) * cellWidth),
            lineHeight
          ),
          paint
        );
      }

      drawRunCells({
        canvas,
        run,
        colors,
        y,
        baseline: nerdBaseline,
        cellWidth,
        lineHeight,
        fontSize,
        nerdFont,
        fontManager,
      });
    }
  }

  const linkPaint = getRectPaint(terminalTheme.link);
  for (const link of links) {
    canvas.drawRect(
      rect(
        horizontalPadding + link.startColumn * cellWidth,
        (link.row - startRow + 1) * lineHeight - 1.5,
        Math.max(1, (link.endColumn - link.startColumn) * cellWidth),
        1
      ),
      linkPaint
    );
  }
  return recorder.finishRecordingAsPicture();
}

function linkAtViewportPoint(
  links: TerminalLink[],
  x: number,
  y: number,
  cellWidth: number,
  lineHeight: number,
  scale: number,
  translateX: number,
  translateY: number
): TerminalLink | null {
  const horizontalHitSlop = Math.max(3, cellWidth * scale * 0.5);
  const verticalHitSlop = Math.max(4, lineHeight * scale * 0.3);
  return (
    links.find((link) => {
      const left = translateX + (horizontalPadding + link.startColumn * cellWidth) * scale;
      const right = translateX + (horizontalPadding + link.endColumn * cellWidth) * scale;
      const top = translateY + (verticalPadding + link.row * lineHeight) * scale;
      const bottom = top + lineHeight * scale;
      return (
        x >= left - horizontalHitSlop &&
        x <= right + horizontalHitSlop &&
        y >= top - verticalHitSlop &&
        y <= bottom + verticalHitSlop
      );
    }) ?? null
  );
}

async function openTerminalLink(uri: string): Promise<void> {
  // Belt and braces: the link detector already restricts these to http(s).
  if (!isSafeExternalLink(uri)) return;
  try {
    await Linking.openURL(uri);
  } catch {
    // The terminal stays interactive if the device has no handler for the URL.
  }
}

function resolveColors(
  style: TerminalStyle,
  terminalTheme: TerminalTheme
): { foreground: string; background: string } {
  const foreground = style.foreground ?? terminalTheme.foreground;
  const background = style.background ?? terminalTheme.background;
  const resolved = style.inverse
    ? { foreground: background, background: foreground }
    : { foreground, background };
  if (!style.dim) return resolved;
  return { ...resolved, foreground: withOpacity(resolved.foreground, 0.62) };
}

function withOpacity(color: string, opacity: number): string {
  if (color.startsWith('#') && color.length === 7) {
    const red = Number.parseInt(color.slice(1, 3), 16);
    const green = Number.parseInt(color.slice(3, 5), 16);
    const blue = Number.parseInt(color.slice(5, 7), 16);
    return `rgba(${red}, ${green}, ${blue}, ${opacity})`;
  }
  const channels = color.match(/\d+/g);
  if (channels && channels.length >= 3) {
    return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${opacity})`;
  }
  return color;
}

/**
 * Draws one styled run a cell at a time.
 *
 * A terminal is a fixed grid: every character sits at `column * cellWidth`, and
 * nothing is allowed to shift its neighbours. Handing the text to a paragraph
 * shaper instead lets the font's own advance widths decide positions, so any
 * glyph whose advance differs from the cell -- box drawing, CJK, anything that
 * falls back to another font -- drifts and takes the rest of the line with it.
 *
 * Glyphs the terminal font can draw are batched into a single `drawGlyphs` call
 * with explicit per-cell offsets. Anything it cannot draw (CJK, emoji, circled
 * digits) falls back to a shaped paragraph, still pinned to its own cell and --
 * see `paintFallback` -- fitted to its own column span rather than trusted to
 * be the width the grid assigned it.
 */
function drawRunCells({
  canvas,
  run,
  colors,
  y,
  baseline,
  cellWidth,
  lineHeight,
  fontSize,
  nerdFont,
  fontManager,
}: {
  canvas: SkCanvas;
  run: TerminalRun;
  colors: { foreground: string; background: string };
  y: number;
  baseline: number;
  cellWidth: number;
  lineHeight: number;
  fontSize: number;
  nerdFont: SkFont | null;
  fontManager: SkTypefaceFontProvider | null;
}) {
  const color = run.style.hidden ? colors.background : colors.foreground;
  const fill = getSolidPaint(color);
  // No bold face ships with the app, so bold is synthesised by stroking the
  // glyph outline -- the same trick terminals use for a missing weight.
  // Stroke width scales with the font, so the cache key has to as well.
  const stroke = run.style.bold ? getStrokePaint(color, fontSize) : undefined;

  const batched: { id: number; offset: number }[] = [];
  const fallbacks: { text: string; column: number; width: number }[] = [];
  let column = run.startColumn;

  for (const grapheme of splitGraphemes(run.text)) {
    // The width is the *printed* character's, because that is the width the
    // emulator laid the row out with. The substitute below is width-preserving
    // by construction, so it lands in the same cells either way.
    const width = graphemeWidth(grapheme);
    if (width === 0) continue;
    if (grapheme !== ' ') {
      const drawn = substituteRenderedGrapheme(grapheme);
      const metrics = glyphMetrics(drawn, fontSize, nerdFont, cellWidth);
      const glyphId = metrics.id;
      if (glyphId !== 0) {
        // Centre within the span so double-width glyphs sit in their two cells.
        const advance = metrics.advance;
        const span = width * cellWidth;
        batched.push({
          id: glyphId,
          offset: (column - run.startColumn) * cellWidth + (span - advance) / 2,
        });
      } else {
        fallbacks.push({ text: drawn, column, width });
      }
    }
    column += width;
  }

  const originX = horizontalPadding + run.startColumn * cellWidth;
  const originY = y + baseline;
  // Synthetic italic: shear about the baseline, matching a real oblique face.
  if (run.style.italic) {
    canvas.save();
    canvas.translate(originX, originY);
    canvas.skew(-0.21, 0);
    canvas.translate(-originX, -originY);
  }

  if (batched.length > 0 && nerdFont) {
    const ids = batched.map((glyph) => glyph.id);
    const positions = batched.map((glyph) => Skia.Point(glyph.offset, 0));
    canvas.drawGlyphs(ids, positions, originX, originY, nerdFont, fill);
    if (stroke) canvas.drawGlyphs(ids, positions, originX, originY, nerdFont, stroke);
  }

  for (const item of fallbacks) {
    const x = horizontalPadding + item.column * cellWidth;
    // Without a font provider the paragraph shapes against the platform's
    // fallback font, which advances and lays out differently from the shipped
    // typeface. Those shapes are wrong the moment the provider loads, so they
    // are painted for this frame only and never cached.
    if (!fontManager) {
      const shaped = buildFallbackParagraph(
        item.text,
        item.width,
        color,
        run.style,
        fontSize,
        lineHeight,
        cellWidth,
        null
      );
      paintFallback(canvas, shaped, x, y, item.width * cellWidth);
      shaped.paragraph.dispose();
      continue;
    }
    const key = `${item.text}|${color}|${run.style.bold ? 'b' : ''}${run.style.italic ? 'i' : ''}|${fontSize}|${lineHeight}`;
    let shaped = fallbackParagraphCache.get(key);
    if (!shaped) {
      shaped = buildFallbackParagraph(
        item.text,
        item.width,
        color,
        run.style,
        fontSize,
        lineHeight,
        cellWidth,
        fontManager
      );
      cacheFallbackParagraph(key, shaped);
    }
    paintFallback(canvas, shaped, x, y, item.width * cellWidth);
  }

  if (run.style.italic) canvas.restore();

  // Underline and strikethrough are cell-aligned rules, not font decorations,
  // so they stay continuous across a run whatever the glyphs did.
  const spanWidth = Math.max(cellWidth, (column - run.startColumn) * cellWidth);
  if (run.style.underline) {
    canvas.drawRect(rect(originX, y + lineHeight - 2, spanWidth, 1), getRectPaint(color));
  }
  if (run.style.strikethrough) {
    canvas.drawRect(rect(originX, y + lineHeight * 0.55, spanWidth, 1), getRectPaint(color));
  }
}

/**
 * Paints keyed by colour, shared across every recorded picture.
 *
 * A picture copies each paint into its display list when it is recorded, so the
 * same instance is safe to hand to every frame. Every solid fill -- run
 * backgrounds, glyph fills, underlines, link rules -- is the same object for a
 * given colour, and the terminal palette is tiny, so this stays bounded without
 * an explicit cap.
 */
const solidPaintCache = new Map<string, SkPaint>();

function getSolidPaint(color: string): SkPaint {
  let paint = solidPaintCache.get(color);
  if (!paint) {
    paint = Skia.Paint();
    paint.setColor(Skia.Color(color));
    solidPaintCache.set(color, paint);
  }
  return paint;
}

/**
 * Paints for cell-aligned solid rectangles: run backgrounds, underline and
 * strikethrough rules, link underlines.
 *
 * Anti-aliasing must stay OFF for these. Two abutting rects drawn with AA at a
 * fractional offset each cover the shared boundary pixel at partial alpha, and
 * partial over partial never sums back to opaque -- the dark canvas shows
 * through as a hairline. A pan or pinch puts every cell edge on a fraction, so
 * the seams appear as a grid flickering with the sub-pixel phase of the
 * gesture. With AA off both edges round to the same device pixel and the grid
 * cannot open up. Glyphs keep their own anti-aliasing via SkFont edging; it is
 * unrelated to these geometry paints.
 */
const rectPaintCache = new Map<string, SkPaint>();

function getRectPaint(color: string): SkPaint {
  let paint = rectPaintCache.get(color);
  if (!paint) {
    paint = Skia.Paint();
    paint.setColor(Skia.Color(color));
    paint.setAntiAlias(false);
    rectPaintCache.set(color, paint);
  }
  return paint;
}

const strokePaintCache = new Map<string, SkPaint>();

function getStrokePaint(color: string, fontSize: number): SkPaint {
  const key = `${color}|${fontSize}`;
  let paint = strokePaintCache.get(key);
  if (!paint) {
    paint = Skia.Paint();
    paint.setColor(Skia.Color(color));
    paint.setStyle(PaintStyle.Stroke);
    paint.setStrokeWidth(Math.max(0.5, fontSize * 0.055));
    strokePaintCache.set(key, paint);
  }
  return paint;
}

/**
 * Shaped fallback paragraphs (CJK, emoji) cached across frames.
 *
 * Building one runs ParagraphBuilder.Make -> build -> layout, each a JSI host
 * call allocating native memory. Redoing that for every wide glyph on every
 * refresh is the renderer's main churn. The key spans everything that changes a
 * glyph's shape or advance -- text, colour, weight, slant, size, line height --
 * because a paragraph laid out for one of those cannot be reused for another.
 *
 * SkParagraph holds native memory the JS GC cannot see, so the cache is capped
 * and evicted paragraphs are disposed explicitly rather than left for Hermes.
 */
const FALLBACK_PARAGRAPH_CACHE_LIMIT = 1024;

/**
 * A shaped fallback glyph, with the width it actually came out.
 *
 * The width is cached alongside the paragraph rather than read per draw for the
 * same reason `glyphCache` exists: `getLongestLine` is a JSI host call, and the
 * fit has to be computed for every fallback glyph on every repaint. It is a
 * property of the shaping, and the cache key already spans everything that
 * changes the shaping, so measuring once per paragraph is measuring exactly as
 * often as it can change.
 */
type ShapedFallback = { paragraph: SkParagraph; naturalWidth: number };

const fallbackParagraphCache = new Map<string, ShapedFallback>();

function cacheFallbackParagraph(key: string, shaped: ShapedFallback): void {
  if (fallbackParagraphCache.size >= FALLBACK_PARAGRAPH_CACHE_LIMIT) {
    const oldest = fallbackParagraphCache.keys().next().value;
    if (oldest !== undefined) {
      fallbackParagraphCache.get(oldest)?.paragraph.dispose();
      fallbackParagraphCache.delete(oldest);
    }
  }
  fallbackParagraphCache.set(key, shaped);
}

/**
 * Draws one shaped fallback glyph inside the cells the grid gave it.
 *
 * `fitFallbackToSpan` decides the geometry and says why; this is the two Skia
 * calls that carry it out. The scaled branch is a canvas transform rather than
 * a re-layout at a smaller size because the paragraph is shared across frames
 * and across every row that draws the same character -- re-shaping per cell
 * span would turn the renderer's cheapest cache into its most expensive one.
 */
function paintFallback(
  canvas: SkCanvas,
  shaped: ShapedFallback,
  x: number,
  y: number,
  span: number
): void {
  const { offsetX, scaleX } = fitFallbackToSpan(shaped.naturalWidth, span);
  if (scaleX === 1) {
    shaped.paragraph.paint(canvas, x + offsetX, y);
    return;
  }
  canvas.save();
  // Scale about the cell's left edge: the glyph starts where its column starts
  // and is squeezed rightwards into the span, so the next column is untouched
  // whatever the fallback font's advance turned out to be.
  canvas.translate(x, 0);
  canvas.scale(scaleX, 1);
  shaped.paragraph.paint(canvas, 0, y);
  canvas.restore();
}

function buildFallbackParagraph(
  text: string,
  width: number,
  color: string,
  style: TerminalStyle,
  fontSize: number,
  lineHeight: number,
  cellWidth: number,
  fontManager: SkTypefaceFontProvider | null
): ShapedFallback {
  const paragraphStyle = {
    maxLines: 1,
    strutStyle: {
      strutEnabled: true,
      forceStrutHeight: true,
      fontFamilies: terminalFontFamilies,
      fontSize,
      heightMultiplier: lineHeight / fontSize,
    },
  };
  const builder = fontManager
    ? Skia.ParagraphBuilder.Make(paragraphStyle, fontManager)
    : Skia.ParagraphBuilder.Make(paragraphStyle);
  builder
    .pushStyle({
      color: Skia.Color(color),
      fontFamilies: terminalFontFamilies,
      fontSize,
      fontStyle: {
        weight: style.bold ? FontWeight.Bold : FontWeight.Normal,
        slant: style.italic ? FontSlant.Italic : FontSlant.Upright,
      },
      heightMultiplier: lineHeight / fontSize,
    })
    .addText(text)
    .pop();
  const paragraph = builder.build();
  // The SkParagraphBuilder typings declare dispose(), but JsiSkParagraphBuilder
  // (react-native-skia 2.6.2, cpp/api) does not export it at runtime -- a bare
  // call here throws on the first CJK/emoji glyph and kills the whole picture.
  // Optional call: a future version that implements it starts collecting.
  builder.dispose?.();
  const span = width * cellWidth;
  // Laid out to its own span, so nothing here can wrap or reflow. It does NOT
  // bound the ink: `layout` is a line-breaking constraint, and one grapheme has
  // nowhere to break, so a fallback font whose advance is wider than the span
  // still paints past it. Measuring what the shaping actually produced is the
  // only way to know, and `paintFallback` is what acts on it.
  paragraph.layout(span);
  // `getLongestLine` is the painted extent of the line, trailing whitespace
  // excluded -- exactly the width that can overlap the next cell.
  // `getMaxIntrinsicWidth` is the same number for a single unbreakable
  // grapheme, and is only a guard for a Skia build that reports zero here.
  const longest = paragraph.getLongestLine();
  const naturalWidth = longest > 0 ? longest : paragraph.getMaxIntrinsicWidth();
  return { paragraph, naturalWidth };
}

/**
 * Glyph id and advance for one grapheme, cached for the lifetime of the process.
 *
 * `getGlyphIDs` and `getGlyphWidths` are JSI host calls: each one crosses into
 * C++ and marshals an array both ways. Called per visible cell per repaint they
 * dominate the renderer -- a 240-line pane is tens of thousands of crossings
 * every refresh, which is most of what makes the phone warm. A terminal draws
 * from a small alphabet, so after the first frame this is a map hit.
 *
 * Keyed by size as well as grapheme because the advance is in pixels. The
 * typeface never changes: one font ships with the app.
 *
 * The advance stored here is the linear one, because the font handed in has
 * linear metrics on from the moment it is loaded. It has to match the rule
 * `measureCellWidth` used: the centring term below is the difference between the
 * cell and the advance, so measuring the two under different rounding would turn
 * a term that should be a fixed sub-pixel nudge into a per-glyph shift.
 */
const glyphCache = new Map<string, { id: number; advance: number }>();

function glyphMetrics(
  grapheme: string,
  fontSize: number,
  font: SkFont | null,
  cellWidth: number
): { id: number; advance: number } {
  const key = `${fontSize}|${grapheme}`;
  const cached = glyphCache.get(key);
  if (cached) return cached;
  const id = font?.getGlyphIDs(grapheme)[0] ?? 0;
  const advance = id === 0 ? cellWidth : (font?.getGlyphWidths([id])[0] ?? cellWidth);
  const metrics = { id, advance };
  glyphCache.set(key, metrics);
  return metrics;
}

/**
 * The width of one cell, in points.
 *
 * Two rules, and they are the whole of the grid's horizontal geometry:
 *
 * 1. **Measure the true advance.** `setLinearMetrics(true)` is what makes an
 *    SkFont report the font's actual advance instead of one hinted to a whole
 *    point. JetBrains Mono advances 0.6em, so the hinted value is wrong at every
 *    size the app offers -- 12pt measured 7.0 against a true 7.2, 14pt measured
 *    8.0 against a true 8.4, 16pt measured 10.0 against a true 9.6. The 14pt
 *    case is the bad one: the cell came out 0.4pt narrower than the glyphs drawn
 *    into it, so adjacent characters overlapped by up to a point. That is why
 *    this regressed when the default moved 12.5 -> 14 -- at 12.5 the same
 *    rounding happened to land 0.5pt *wide*, which merely looked airy, and the
 *    error changed sign rather than appearing from nowhere.
 *
 * 2. **Quantize once, to the device pixel.** Not to a point: a point is not a
 *    unit the screen has. Snapping the advance to `1/dpr` keeps the error under
 *    half a device pixel at any size, and -- because the result is an exact
 *    multiple of the device pixel -- makes `column * cellWidth` land on a whole
 *    device pixel for *every* column. That is what the cell-aligned rules and
 *    run backgrounds need: they paint with anti-aliasing off (see
 *    `getRectPaint`), and an off-grid edge is exactly the seam that rounds two
 *    neighbours onto the same pixel or opens a hairline between them.
 *
 * Both rules exist to keep one invariant: a cell's x is a multiplication, never
 * an accumulation, and the one rounding step happens here rather than per glyph,
 * so column 200 is as exact as column 1 and error cannot build across a line.
 */
export function measureCellWidth(
  fontSize: number,
  fontManager: SkTypefaceFontProvider | null,
  nerdFont: SkFont | null
): number {
  const fallbackFamily = process.env.EXPO_OS === 'ios' ? 'Menlo' : 'monospace';
  const font =
    nerdFont ??
    matchFont(
      {
        fontFamily: fontManager ? terminalFontFamily : fallbackFamily,
        fontSize,
        fontWeight: '400',
      },
      fontManager ?? undefined
    );
  // `nerdFont` already has this set; a font from `matchFont` does not, and it is
  // idempotent, so it is set here rather than only at the call site.
  font.setLinearMetrics(true);
  const glyphs = font.getGlyphIDs('M');
  const advance = font.getGlyphWidths(glyphs)[0] ?? fontSize * TERMINAL_ADVANCE_RATIO;
  return snapToDevicePixel(Math.max(7, advance), PixelRatio.get());
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    width: '100%',
    minHeight: 280,
    overflow: 'hidden',
  },
  canvas: {
    flex: 1,
    width: '100%',
  },
  loading: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    justifyContent: 'flex-end',
    paddingLeft: 12,
    paddingBottom: 12,
  },
  emptyText: {
    fontFamily: terminalFontFamily,
    fontSize: 13,
  },
  historyIndicator: {
    position: 'absolute',
    alignSelf: 'center',
    minHeight: 28,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    boxShadow: '0 4px 14px rgba(0, 0, 0, 0.16)',
  },
  historyIndicatorText: {
    fontFamily: terminalFontFamily,
    fontSize: 11,
  },
  selectionBar: {
    position: 'absolute',
    alignSelf: 'center',
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 4,
    boxShadow: '0 6px 18px rgba(0, 0, 0, 0.22)',
  },
  selectionAction: {
    flexShrink: 1,
    // The row has to hold three labels in either language inside a phone's
    // width, and `Copy`/`Select all`/`Cancel` are `複製`/`全選`/`取消` in the
    // other one, so the padding is the bar's rather than each button's.
    paddingHorizontal: 10,
  },
  // The pill's place on the screen, separated from the pill so that the
  // entrance can scale the button without fighting the animated bottom inset
  // holding it above the dock.
  latestAnchor: {
    position: 'absolute',
    right: 14,
  },
  latestButton: {
    minHeight: 38,
    paddingHorizontal: 14,
    borderRadius: 19,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 4px 14px rgba(0, 0, 0, 0.16)',
  },
  latestButtonText: {
    fontFamily: terminalFontFamily,
    fontSize: 11,
    fontWeight: '700',
  },
});
