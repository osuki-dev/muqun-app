import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { Keyboard as KeyboardIcon } from 'lucide-react-native';
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
import {
  nextHandleCorner,
  reseatFloatingHandle,
  snapFloatingHandle,
  type HandleBounds,
} from '@/lib/floating-handle';
import { fadeIn, fadeOutDown, riseIn, settleTo, zoomIn, zoomOut } from '@/lib/motion';

/**
 * The controls an editor pane is left with, over the grid.
 *
 * ## Why nothing here is measured into the terminal
 *
 * The maintainer's brief, in one line: if nvim is open then this is a whole
 * nvim, and the keyboard and the input come over it and out again when tapped.
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
 * ## The two states are one control, and only one of them floats
 *
 * Collapsed it is a small round button. That button is the only chrome over
 * the file, so it is the thing the reader moves out of the way of the line
 * they are reading -- and it moves the way every floating control on a phone
 * moves: it follows the finger in both axes and parks against the left or the
 * right rail when the finger lifts (AssistiveTouch, a chat head, a
 * picture-in-picture window). Where it goes is `lib/floating-handle`; how it
 * gets there is `settleTo`, the app's one spring, critically damped so it
 * absorbs the throw without bouncing. A drag is not the only way: the button
 * carries a move action that walks the four corners, for a reader who cannot
 * make the gesture.
 *
 * Tapped, it becomes the keyboard -- and the keyboard does not float. It is a
 * keyboard, so it sits where a keyboard sits: across the bottom of the pane,
 * over the last rows, in the seat the ordinary dock has on every other pane.
 * There is nothing above it to grab, no chevrons and no second dismissal. It
 * was briefly given all three, and a header row of controls over an on-screen
 * keyboard reads as neither a keyboard nor a dock: the way out of it is the
 * keyboard's own toggle, which is where the reader has just been looking, and
 * the button comes back exactly where they left it.
 */

/**
 * How far above the bottom of the pane the button rests before it is moved.
 *
 * Two rows of a terminal at the default text size, not a decorative margin.
 * nvim's status line and its command line are the bottom two rows of the
 * screen, and they are what a reader is looking at while they type `:w` -- so
 * the one place the button must not start is on top of them.
 */
const RESTING_GAP = 40;
/** Inset of the button from the rail it is parked against. */
const HANDLE_GAP = 14;
const HANDLE_SIZE = 46;
/** Movement before the drag takes the touch off the button underneath it. */
const DRAG_SLOP = 6;

export interface EditorControlsProps {
  /** The keyboard is out, rather than the button that opens it. */
  expanded: boolean;
  onExpand: () => void;
  /**
   * Where the reader has parked the button, in points from its resting corner.
   *
   * Owned by the screen rather than by this component so that the position
   * outlives a trip out of the editor and back: leaving nvim unmounts this,
   * and a reader who moved the button should not have to move it again. `x` is
   * zero on the right rail and negative on the left; `y` is negative upwards.
   */
  offsetX: SharedValue<number>;
  offsetY: SharedValue<number>;
  /** Clearance at the top of the pane -- the header the button must not reach. */
  topInset?: number;
  /** Clearance at the bottom: the safe area, and anything standing in it. */
  bottomInset?: number;
  /**
   * The system keyboard's height as it animates, negative while it is up.
   *
   * The panel rides it rather than the terminal doing so, and that is a
   * deliberate choice rather than a convenience: shrinking the terminal for the
   * phone's keyboard is a grid resize, and a grid resize on an editor is a
   * `SIGWINCH` and a full repaint for the ten seconds it takes to paste a line
   * -- twice, once on the way up and once on the way down. What the reader
   * needs to see while typing is the field they are typing into, and the field
   * travels with this.
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
  offsetX,
  offsetY,
  topInset = 0,
  bottomInset = 0,
  keyboardOffset,
  children,
  disabled = false,
}: EditorControlsProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const chromeText = theme.colors.text;

  /** The pane's own size: the two numbers every bound below is derived from. */
  const trackWidth = useSharedValue(0);
  const trackHeight = useSharedValue(0);
  const resting = bottomInset + RESTING_GAP;

  /**
   * The rectangle of offsets the button may rest at.
   *
   * Recomputed inside the worklets rather than stored, so a rotation between
   * two frames can never be dragged against a limit measured for the old
   * screen.
   */
  const bounds = useCallback((): HandleBounds => {
    'worklet';
    return {
      minX: -Math.max(0, trackWidth.value - HANDLE_SIZE - HANDLE_GAP * 2),
      maxX: 0,
      minY: -Math.max(0, trackHeight.value - HANDLE_SIZE - resting - topInset),
      maxY: Math.max(0, RESTING_GAP - HANDLE_GAP),
    };
  }, [resting, topInset, trackHeight, trackWidth]);

  /**
   * The bounds the button was last settled against.
   *
   * Kept so that a pane which changes size knows which rail the remembered
   * offset *meant*, rather than re-deriving it from the new rectangle: on a
   * screen that got wider, an offset that was the left rail is nearer the
   * right one, and reseating by nearest alone walks the button across the pane
   * on every rotation.
   */
  const settledBounds = useSharedValue<HandleBounds | null>(null);

  const handleStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offsetX.value }, { translateY: offsetY.value }],
  }));

  /**
   * The keyboard's own travel, and the only thing that moves the panel.
   *
   * The safe area is subtracted because the phone's keyboard covers it: the
   * panel already pads for it, and translating by the raw height would leave
   * that padding as a band of terminal between the keys and the keyboard --
   * which is what the ordinary dock's own animated style has always avoided,
   * by exactly this arithmetic.
   */
  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -Math.max(0, -(keyboardOffset?.value ?? 0) - bottomInset) }],
  }));

  /**
   * Keeps a remembered position inside a pane that has changed size under it.
   *
   * Measured or nothing: React Native reports a zero-height box before it
   * reports a real one, and a reseat run against a zero-height pane says "no
   * travel", which would throw away a remembered position on the first frame
   * of every arrival.
   */
  function measureTrack(event: LayoutChangeEvent) {
    const { width, height } = event.nativeEvent.layout;
    trackWidth.value = width;
    trackHeight.value = height;
    if (width <= 0 || height <= 0) return;
    const next = bounds();
    const previous = settledBounds.value;
    const rest = previous
      ? reseatFloatingHandle({ x: offsetX.value, y: offsetY.value }, previous, next)
      : snapFloatingHandle({ x: offsetX.value, y: offsetY.value }, next);
    settledBounds.value = next;
    if (rest.x !== offsetX.value) settleTo(offsetX, rest.x);
    if (rest.y !== offsetY.value) settleTo(offsetY, rest.y);
  }

  /**
   * The move action: one corner on, clockwise from the top left.
   *
   * A custom action hung off the button rather than increment/decrement,
   * because activating the button opens the keyboard -- it is a button first,
   * and a thing that can be relocated second.
   */
  const moveLabel = t`Move the editor controls`;
  const handleActions = [{ name: 'move', label: moveLabel }];
  const moveToNextCorner = useCallback(() => {
    const next = bounds();
    const corner = nextHandleCorner({ x: offsetX.value, y: offsetY.value }, next);
    settledBounds.value = next;
    settleTo(offsetX, corner.x);
    settleTo(offsetY, corner.y);
  }, [bounds, offsetX, offsetY, settledBounds]);
  function onAccessibilityAction(event: AccessibilityActionEvent) {
    if (event.nativeEvent.actionName === 'move') moveToNextCorner();
  }

  // The drag itself. `minDistance` is what lets the button stay a button: the
  // pan does not claim the touch until the finger has actually travelled, so a
  // tap reaches the `Pressable` underneath and only a drag takes it away.
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const drag = Gesture.Pan()
    .minDistance(DRAG_SLOP)
    .onStart(() => {
      startX.value = offsetX.value;
      startY.value = offsetY.value;
    })
    .onUpdate((event) => {
      // Free in both axes while the finger is down: the button is under the
      // touch, not on a track beside it. Bounded by the pane and nothing else
      // -- a control dragged past the edge of the screen is a control the
      // reader cannot get back.
      const edge = bounds();
      offsetX.value = Math.min(edge.maxX, Math.max(edge.minX, startX.value + event.translationX));
      offsetY.value = Math.min(edge.maxY, Math.max(edge.minY, startY.value + event.translationY));
    })
    .onEnd((event) => {
      const next = bounds();
      const rest = snapFloatingHandle(
        { x: offsetX.value, y: offsetY.value, velocityX: event.velocityX },
        next
      );
      settledBounds.value = next;
      // The spring carries the throw's own velocity into the rail it was
      // heading for, so a flick lands rather than being taken away and put
      // down by the app.
      settleTo(offsetX, rest.x, event.velocityX);
      settleTo(offsetY, rest.y, event.velocityY);
    });

  // The gesture wraps a plain `View` rather than the animated or glass one it
  // contains: `GestureDetector` attaches to its child by ref, and `GlassChrome`
  // renders three different surfaces depending on the platform, none of which
  // forwards one.
  const handle = (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.handleAnchor, { bottom: resting, right: HANDLE_GAP }, handleStyle]}>
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
                style={styles.handleFace}>
                <KeyboardIcon size={20} color={chromeText} />
              </PressableScale>
            </GlassChrome>
          </Animated.View>
        </View>
      </GestureDetector>
    </Animated.View>
  );

  const panel = (
    <Animated.View pointerEvents="box-none" style={[styles.panelAnchor, panelStyle]}>
      <GlassChrome
        face="floating"
        entering={riseIn()}
        exiting={fadeOutDown('short')}
        style={[styles.panel, { paddingBottom: Math.max(bottomInset, 10) }]}>
        <View
          // The body is inert while the pane cannot take input -- a reconnecting
          // SSH shell, a pane the gateway has not answered for.
          pointerEvents={disabled ? 'none' : 'auto'}
          style={[styles.panelBody, disabled ? styles.panelBodyDisabled : null]}>
          {children}
        </View>
      </GlassChrome>
    </Animated.View>
  );

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill} onLayout={measureTrack}>
      {expanded ? panel : handle}
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
  /**
   * The button's resting corner. Everything the drag does is a translation off
   * this, so the remembered offset means the same thing on every screen size.
   */
  handleAnchor: {
    position: 'absolute',
    // Above the pane's own floating chrome -- the history spinner, the
    // quick-action pair -- which are the only other things over the grid.
    zIndex: 12,
    elevation: 12,
  },
  /**
   * Unchanged from the dock-era handle, and deliberately: measured against the
   * app's other floating chrome -- `GlassChrome`, `PressableScale`, the dock's
   * key-row toggles -- the size, the radius, the fill, the shadow and the
   * centred icon already agree with them. What was wrong with this control was
   * where it went, not what it looked like.
   */
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
  /** Where a keyboard goes: the full width of the pane, along the bottom of it. */
  panelAnchor: {
    position: 'absolute',
    zIndex: 12,
    elevation: 12,
    left: 0,
    right: 0,
    bottom: 0,
  },
  /** The ordinary dock's own shape, because this stands in the dock's seat. */
  panel: {
    paddingTop: 8,
    paddingHorizontal: 10,
    borderTopLeftRadius: appChrome.radius.composerDock,
    borderTopRightRadius: appChrome.radius.composerDock,
    borderCurve: 'continuous',
    boxShadow: appChrome.shadow.composerDock,
  },
  panelBody: {
    gap: 8,
  },
  panelBodyDisabled: {
    opacity: appChrome.opacity.disabled,
  },
});
