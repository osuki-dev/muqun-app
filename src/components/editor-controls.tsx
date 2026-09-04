import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { ChevronDown, ChevronUp, Keyboard as KeyboardIcon } from 'lucide-react-native';
import { useCallback, type ReactNode } from 'react';
import {
  StyleSheet,
  View,
  type AccessibilityActionEvent,
  type LayoutChangeEvent,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

import { GlassChrome } from '@/components/glass-chrome';
import { PressableScale } from '@/components/pressable-scale';
import { appChrome } from '@/constants/appearance';
import { withAlpha } from '@/lib/color';
import { fadeIn, fadeOutDown, riseIn, settleTo, zoomIn, zoomOut } from '@/lib/motion';

/**
 * The controls an editor pane is left with, floating over the grid.
 *
 * ## Why it floats
 *
 * The maintainer's brief, in one line: if nvim is open then this is a whole
 * nvim, and the keyboard and the input float over it and come out when tapped.
 *
 * A dock cannot do that. A dock is height, height comes out of the terminal,
 * and on an editor the height it comes out of is nvim's status line and its
 * command line -- the two rows a reader actually looks at while editing. Worse,
 * a dock that grows and shrinks re-lays out the terminal, and on the SSH screen
 * a terminal re-layout is a new grid, a `SIGWINCH` and a full repaint on the far
 * side. Reaching for `esc` should not resize the reader's window.
 *
 * So this reserves nothing. It is an absolutely positioned overlay inside the
 * pane, `box-none` everywhere but on its own controls, and showing or hiding it
 * cannot fire the terminal's `onLayout` because the terminal's box never
 * changes. That is the constraint the whole component exists to satisfy, and it
 * is why the panel is not simply the old dock with `position: absolute` on it:
 * the dock is measured into the terminal's bottom inset, and this deliberately
 * is not measured into anything.
 *
 * ## Why it moves
 *
 * The rest of the brief: what floats can be dragged, with some animation,
 * because sometimes it covers the content. A fixed overlay on an editor is a
 * bet about which rows the reader cares about, and the bet is lost the moment
 * they are editing the line the panel is standing on. So the
 * cluster is dragged vertically, and it settles where the throw was going --
 * `settleTo`, the app's one spring, critically damped so it absorbs the
 * velocity without bouncing (see `lib/motion.ts`).
 *
 * Dragging is not the only way. The panel carries a visible pair of chevrons
 * that step it by a quarter of the pane, and both sizes answer the standard
 * "move up"/"move down" accessibility actions, so the cluster is movable by
 * someone who cannot make the gesture -- and by someone who has not guessed
 * that it is draggable at all.
 *
 * ## The two sizes are one control
 *
 * Collapsed it is a handle in the bottom corner -- not the corner itself, and
 * not on the last row of the grid, so it is over an editor's own chrome as
 * little as possible while staying under a thumb. Tapped, it becomes a panel
 * carrying the app's keyboard, the editor keys and the way to the composer.
 * The position is shared between the two, so a reader who moved the handle out
 * of the way finds the panel where they left it.
 */

/**
 * How far above the bottom of the pane the cluster rests before it is moved.
 *
 * Two rows of a terminal at the default text size, not a decorative margin.
 * nvim's status line and its command line are the bottom two rows of the
 * screen, and they are what a reader is looking at while they type `:w` -- so
 * the one place the controls must not start is on top of them.
 */
const RESTING_GAP = 40;
/** Inset of the collapsed handle from the right-hand edge. */
const HANDLE_GAP = 14;
const HANDLE_SIZE = 46;
/** What one press of a chevron, or one accessibility action, is worth. */
const STEP_FRACTION = 0.25;
/** Movement before the drag takes the touch off the control underneath it. */
const DRAG_SLOP = 6;
/**
 * How much of the release velocity, in seconds, the throw is projected over.
 *
 * Not a duration -- it is the horizon the flick is aimed at, and the spring
 * decides how long getting there takes. Small on purpose: a cluster that flew
 * the length of a flick would leave the pane on any real gesture.
 */
const FLING_PROJECTION_S = 0.06;
/** How long the handle is held before the hold is a move rather than a tap. */
const LONG_PRESS_MS = 400;

export interface EditorControlsProps {
  /** The cluster is open: the panel rather than the handle. */
  expanded: boolean;
  onExpand: () => void;
  onCollapse: () => void;
  /**
   * Where the cluster has been dragged to, in points above its resting place.
   *
   * Owned by the screen rather than by this component so that the position
   * outlives a trip out of the editor and back: leaving nvim unmounts the
   * cluster, and a reader who moved it should not have to move it again.
   */
  offset: SharedValue<number>;
  /** Clearance at the top of the pane -- the header the cluster must not reach. */
  topInset?: number;
  /** Clearance at the bottom: the safe area, and anything standing in it. */
  bottomInset?: number;
  /**
   * The system keyboard's height as it animates, negative while it is up.
   *
   * The cluster rides it rather than the terminal doing so, and that is a
   * deliberate choice rather than a convenience: shrinking the terminal for the
   * phone's keyboard is a grid resize, and a grid resize on an editor is a
   * `SIGWINCH` and a full repaint for the ten seconds it takes to paste a line
   * -- twice, once on the way up and once on the way down. What the reader
   * needs to see while typing is the field they are typing into, and the field
   * travels with this. What the keyboard covers is the editor's own bottom
   * rows, and moving the cluster is how those are recovered.
   */
  keyboardOffset?: SharedValue<number>;
  /** The panel's body: the keyboard, the keys, the composer. */
  children?: ReactNode;
  /** Whether the pane can be typed into at all. */
  disabled?: boolean;
}

export function EditorControls({
  expanded,
  onExpand,
  onCollapse,
  offset,
  topInset = 0,
  bottomInset = 0,
  keyboardOffset,
  children,
  disabled = false,
}: EditorControlsProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const chromeText = theme.colors.text;
  const chromeGlass = withAlpha(theme.colors.text, appChrome.opacity.chromeControl);

  /** The pane's own height, and the cluster's -- the two numbers the clamp needs. */
  const trackHeight = useSharedValue(0);
  const clusterHeight = useSharedValue(0);
  const resting = bottomInset + RESTING_GAP;

  /**
   * How far up the cluster may go: the pane, less what it already occupies at
   * rest and the clearance it must leave at the top.
   *
   * Recomputed inside the worklets rather than stored, so that a panel opening
   * (which changes `clusterHeight` between two frames) can never be dragged
   * against a limit measured for the handle.
   */
  const travel = useCallback(() => {
    'worklet';
    return Math.max(0, trackHeight.value - clusterHeight.value - resting - topInset);
  }, [clusterHeight, resting, topInset, trackHeight]);

  const clusterStyle = useAnimatedStyle(() => ({
    // The drag and the keyboard are one translation, clamped together: a
    // cluster already dragged near the top of the pane must not be pushed off
    // it by the keyboard arriving underneath.
    transform: [{ translateY: Math.max(-travel(), offset.value + (keyboardOffset?.value ?? 0)) }],
  }));

  /**
   * Keeps the cluster inside the pane after it changes size or the pane does.
   *
   * Both measurements or nothing. React Native lays children out before their
   * parents, so the cluster reports its height while the pane's is still zero
   * -- and a clamp run against a zero-height pane says "no travel", which would
   * throw away a remembered position on the first frame of every arrival.
   */
  const reclamp = useCallback(() => {
    'worklet';
    if (trackHeight.value <= 0 || clusterHeight.value <= 0) return;
    const limit = -travel();
    if (offset.value < limit) settleTo(offset, limit);
    else if (offset.value > 0) settleTo(offset, 0);
  }, [clusterHeight, offset, trackHeight, travel]);

  function measureTrack(event: LayoutChangeEvent) {
    trackHeight.value = event.nativeEvent.layout.height;
    reclamp();
  }

  function measureCluster(event: LayoutChangeEvent) {
    clusterHeight.value = event.nativeEvent.layout.height;
    reclamp();
  }

  /** One chevron press, or one accessibility action. Negative is upward. */
  const step = useCallback(
    (direction: -1 | 1) => {
      const limit = -travel();
      const by = direction * Math.max(1, trackHeight.value * STEP_FRACTION);
      settleTo(offset, Math.min(0, Math.max(limit, offset.value + by)));
    },
    [offset, trackHeight, travel]
  );

  const moveUpLabel = t`Move the controls up`;
  const moveDownLabel = t`Move the controls down`;
  // Two vocabularies for the same pair, because the two sizes are different
  // kinds of control. The handle is a button -- activating it opens the panel
  // -- so moving it has to be a *custom* action hung off that button. The grip
  // does nothing when activated and everything when adjusted, which is what
  // `adjustable` means, and increment/decrement are the actions the platforms
  // already bind to a swipe up and a swipe down on one.
  const handleActions = [
    { name: 'moveUp', label: moveUpLabel },
    { name: 'moveDown', label: moveDownLabel },
  ];
  const gripActions = [
    { name: 'increment', label: moveUpLabel },
    { name: 'decrement', label: moveDownLabel },
  ];
  function onAccessibilityAction(event: AccessibilityActionEvent) {
    const action = event.nativeEvent.actionName;
    if (action === 'moveUp' || action === 'increment') step(-1);
    if (action === 'moveDown' || action === 'decrement') step(1);
  }

  // The drag itself. `activeOffsetY` is what lets the handle stay a button: the
  // pan does not claim the touch until the finger has actually travelled, so a
  // tap reaches the `Pressable` underneath and only a drag takes it away.
  const startOffset = useSharedValue(0);
  const drag = Gesture.Pan()
    .activeOffsetY([-DRAG_SLOP, DRAG_SLOP])
    .failOffsetX([-DRAG_SLOP * 3, DRAG_SLOP * 3])
    .onStart(() => {
      startOffset.value = offset.value;
    })
    .onUpdate((event) => {
      const limit = -travel();
      offset.value = Math.min(0, Math.max(limit, startOffset.value + event.translationY));
    })
    .onEnd((event) => {
      const limit = -travel();
      // Where the throw was going, not where the finger stopped: a flick that
      // ends mid-pane should carry, and `settleTo` is what carries it.
      const projected = offset.value + event.velocityY * FLING_PROJECTION_S;
      settleTo(offset, Math.min(0, Math.max(limit, projected)), event.velocityY);
    });

  /**
   * Hold the handle: it jumps to the far end of its travel, and again to come
   * back. The third way to move it, for a thumb already resting on it.
   *
   * The `Pressable`'s own long press rather than a gesture racing the pan:
   * React Native does not fire `onPress` on a release that has already been
   * reported as a long press, so the same touch cannot both move the cluster
   * and open it -- which is exactly what a `LongPress` gesture beside the
   * button would have done.
   */
  const toggleEnds = useCallback(() => {
    const limit = -travel();
    settleTo(offset, offset.value < limit / 2 ? 0 : limit);
  }, [offset, travel]);

  // The gesture wraps a plain `View` in both sizes rather than the animated or
  // glass one it contains: `GestureDetector` attaches to its child by ref, and
  // `GlassChrome` renders three different surfaces depending on the platform,
  // none of which forwards one.
  const handle = (
    // `box-none` on the row: it is the width of the pane and only the circle in
    // it is a control, so without this the whole line would eat taps aimed at
    // the editor behind it.
    <View pointerEvents="box-none" style={styles.handleRow}>
      <GestureDetector gesture={drag}>
        <View>
          <Animated.View entering={zoomIn('short')} exiting={zoomOut('micro')}>
            <GlassChrome style={styles.handle}>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={t`Show the editor keyboard`}
                accessibilityHint={t`Opens the keyboard, the editor keys and the composer over this editor. Drag to move.`}
                accessibilityActions={handleActions}
                onAccessibilityAction={onAccessibilityAction}
                feedback="selection"
                pressedScale={0.9}
                onPress={onExpand}
                onLongPress={toggleEnds}
                delayLongPress={LONG_PRESS_MS}
                style={styles.handleFace}>
                <KeyboardIcon size={20} color={chromeText} />
              </PressableScale>
            </GlassChrome>
          </Animated.View>
        </View>
      </GestureDetector>
    </View>
  );

  const panel = (
    <GlassChrome
      face="floating"
      entering={riseIn()}
      exiting={fadeOutDown('short')}
      style={styles.panel}>
      {/* The grip: what the drag is aimed at once the panel is open, so a
          finger looking for it never lands on a letter. The chevrons beside it
          are the same movement without the gesture, and the chevron down at the
          end is the way back to the bare editor. */}
      <GestureDetector gesture={drag}>
        <View style={styles.gripRow}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={moveUpLabel}
            feedback="selection"
            pressedScale={0.9}
            onPress={() => step(-1)}
            style={[styles.gripButton, { backgroundColor: chromeGlass }]}>
            <ChevronUp size={16} color={chromeText} />
          </PressableScale>
          {/* The bar between the chevrons is what the drag is aimed at, and it
              is its own accessibility element rather than a decoration inside
              an accessible row: making the *row* accessible would collapse the
              chevrons and the close button into it and leave a screen reader
              with one control where there are four. */}
          <View
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel={t`Move the editor controls`}
            accessibilityActions={gripActions}
            onAccessibilityAction={onAccessibilityAction}
            style={styles.gripBarWrap}>
            <View style={[styles.gripBar, { backgroundColor: chromeGlass }]} />
          </View>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={moveDownLabel}
            feedback="selection"
            pressedScale={0.9}
            onPress={() => step(1)}
            style={[styles.gripButton, { backgroundColor: chromeGlass }]}>
            <ChevronDown size={16} color={chromeText} />
          </PressableScale>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={t`Hide the editor controls`}
            feedback="selection"
            pressedScale={0.9}
            onPress={onCollapse}
            style={[styles.gripButton, { backgroundColor: chromeGlass }]}>
            <KeyboardIcon size={16} color={theme.colors.primary} />
          </PressableScale>
        </View>
      </GestureDetector>
      <View
        // The body is inert while the pane cannot take input -- a reconnecting
        // SSH shell, a pane the gateway has not answered for.
        pointerEvents={disabled ? 'none' : 'auto'}
        style={[styles.panelBody, disabled ? styles.panelBodyDisabled : null]}>
        {children}
      </View>
    </GlassChrome>
  );

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill} onLayout={measureTrack}>
      <Animated.View
        pointerEvents="box-none"
        onLayout={measureCluster}
        style={[styles.cluster, { bottom: resting }, clusterStyle]}>
        {expanded ? panel : handle}
      </Animated.View>
    </View>
  );
}

/**
 * The panel's own fade, for the rows inside it that come and go -- the composer
 * arriving over the keys, the entry button leaving. Exported so the two
 * workspaces animate the same swap the same way without importing `motion`
 * twice over for it.
 */
export const editorPanelRow = {
  entering: fadeIn('micro'),
  exiting: fadeOutDown('short'),
};

const styles = StyleSheet.create({
  cluster: {
    position: 'absolute',
    left: 0,
    right: 0,
    // Above the pane's own floating chrome -- the "jump to latest" pill and the
    // history spinner -- which are the only other things over the grid.
    zIndex: 12,
    elevation: 12,
  },
  handleRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: HANDLE_GAP,
  },
  handle: {
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    borderRadius: HANDLE_SIZE / 2,
    borderCurve: 'continuous',
    overflow: 'hidden',
    boxShadow: appChrome.shadow.floatingPill,
  },
  handleFace: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  panel: {
    marginHorizontal: 8,
    paddingHorizontal: 8,
    paddingTop: 4,
    paddingBottom: 6,
    gap: 6,
    borderRadius: appChrome.radius.composerDock,
    borderCurve: 'continuous',
    overflow: 'hidden',
    boxShadow: appChrome.shadow.composerDock,
  },
  gripRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  gripButton: {
    width: 34,
    height: 30,
    borderRadius: 10,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** The grip is the whole space between the chevrons, not just the bar in it. */
  gripBarWrap: {
    flex: 1,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gripBar: {
    width: 44,
    height: 5,
    borderRadius: 2.5,
  },
  panelBody: {
    gap: 6,
  },
  panelBodyDisabled: {
    opacity: appChrome.opacity.disabled,
  },
});
