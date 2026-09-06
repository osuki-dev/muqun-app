import { useCallback, useRef, type ReactNode } from 'react';
import {
  StyleSheet,
  View,
  type AccessibilityActionEvent,
  type AccessibilityState,
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
  floatingHandleBounds,
  nextHandleCorner,
  reseatFloatingHandle,
  snapFloatingHandle,
  type HandleBounds,
} from '@/lib/floating-handle';
import { settleTo, zoomIn, zoomOut } from '@/lib/motion';

/**
 * The app's one floating button: the round glass control that follows the
 * finger in both axes and parks against the nearer rail when it lifts.
 *
 * Two screens have one -- the editor pane's keyboard handle and the simulator
 * preview's control button -- and they are the same object: the thing left
 * over a full-screen surface that the reader moves for exactly one reason,
 * because it is standing on what they are looking at. So this is one
 * component rather than two drag implementations that agree today. Where it
 * comes to rest is `lib/floating-handle`; how it gets there is `settleTo`, the
 * app's one spring, critically damped so it absorbs a throw without bouncing.
 * A drag is not the only way: the button carries a move action that walks the
 * four corners, for a reader who cannot make the gesture.
 *
 * ## Why it is a layer rather than a button
 *
 * The bounds a drag is clamped to are the size of the surface the button
 * floats over, and that surface is measured here, on an absolutely positioned
 * `box-none` layer that fills the host. The layer stays mounted while the
 * button is `hidden` -- the editor hides it while its keyboard is out -- so
 * the measurement and the remembered rail survive; React Native only reports
 * a layout when one changes, and a fresh layer would wait for the next
 * rotation to learn how big it is.
 *
 * ## What the offsets mean
 *
 * The button is anchored at the bottom right of the layer, `HANDLE_RESTING_GAP`
 * above the bottom inset and `HANDLE_GAP` in from the right. `offsetX` and
 * `offsetY` are translations off that anchor: zero is the anchor, `x` is
 * negative on the left rail, `y` is negative upwards. They are owned by the
 * caller so a position can outlive this component -- a trip out of the editor
 * and back, a preview closed and reopened -- and the caller decides how long
 * that memory is.
 */

/** Inset of the button from the rail it is parked against. */
export const HANDLE_GAP = 14;
/** The button's diameter: over the 44pt hit target the platforms ask for. */
export const HANDLE_SIZE = 46;
/**
 * How far above the bottom inset the button rests before it is moved.
 *
 * Two rows of a terminal at the default text size, which is where the editor
 * needs it -- nvim's status line and its command line are the bottom two rows
 * -- and a comfortable thumb's reach above a home indicator everywhere else.
 */
export const HANDLE_RESTING_GAP = 40;
/** Movement before the drag takes the touch off the button underneath it. */
const DRAG_SLOP = 6;

/** Where the button is, in the layer's own coordinates. */
export interface HandleFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The button's rectangle for an offset, given the layer it floats over.
 *
 * Exported for a host that anchors something to the button -- the simulator
 * preview hangs its menu off it -- so the anchor is worked out from the same
 * corner and the same gaps the button is drawn with, rather than a second
 * copy of them.
 */
export function floatingHandleFrame(
  track: { width: number; height: number },
  offset: { x: number; y: number },
  bottomInset = 0
): HandleFrame {
  return {
    x: track.width - HANDLE_GAP - HANDLE_SIZE + offset.x,
    y: track.height - bottomInset - HANDLE_RESTING_GAP - HANDLE_SIZE + offset.y,
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
  };
}

export interface FloatingHandleProps {
  /** The remembered translation off the anchor; see the note above. */
  offsetX: SharedValue<number>;
  offsetY: SharedValue<number>;
  /** Clearance at the top of the layer: a header, a camera cutout. */
  topInset?: number;
  /** Clearance at the bottom: the safe area, and anything standing in it. */
  bottomInset?: number;
  /** Keep the layer and its measurement, draw no button. */
  hidden?: boolean;
  onPress: () => void;
  accessibilityLabel: string;
  accessibilityHint?: string;
  /** What the button has open, for a reader who cannot see the menu it opened. */
  accessibilityState?: AccessibilityState;
  /** The move action's name, in the caller's locale. */
  moveLabel: string;
  testID?: string;
  /** The glyph on the button. */
  children: ReactNode;
}

export function FloatingHandle({
  offsetX,
  offsetY,
  topInset = 0,
  bottomInset = 0,
  hidden = false,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  accessibilityState,
  moveLabel,
  testID,
  children,
}: FloatingHandleProps) {
  /**
   * The layer's own size: the two numbers every bound below is derived from.
   *
   * Held twice, on purpose. The shared values are what the drag reads on the
   * UI runtime, sixty times a second. The ref is what the JS side reads --
   * the reseat on a layout change, the accessibility move -- because a
   * worklet called from JS does not see a write to a shared value made a
   * moment earlier on the same thread: the first measure read the layer as
   * 0x0 that way and snapped a remembered position back to the corner.
   */
  const trackWidth = useSharedValue(0);
  const trackHeight = useSharedValue(0);
  const track = useRef({ width: 0, height: 0 });
  const resting = bottomInset + HANDLE_RESTING_GAP;

  /**
   * The rectangle of offsets the button may rest at, on the UI runtime.
   *
   * Recomputed inside the worklets rather than stored, so a rotation between
   * two frames can never be dragged against a limit measured for the old
   * screen. The arithmetic is `floatingHandleBounds`, shared with the JS side.
   */
  const bounds = useCallback((): HandleBounds => {
    'worklet';
    return floatingHandleBounds(
      { width: trackWidth.value, height: trackHeight.value },
      { size: HANDLE_SIZE, gap: HANDLE_GAP, restingGap: HANDLE_RESTING_GAP, resting, topInset }
    );
  }, [resting, topInset, trackHeight, trackWidth]);

  /** The same rectangle, from the JS side's copy of the measurement. */
  const boundsNow = useCallback(
    (): HandleBounds =>
      floatingHandleBounds(track.current, {
        size: HANDLE_SIZE,
        gap: HANDLE_GAP,
        restingGap: HANDLE_RESTING_GAP,
        resting,
        topInset,
      }),
    [resting, topInset]
  );

  /**
   * The bounds the button was last settled against.
   *
   * Kept so that a layer which changes size knows which rail the remembered
   * offset *meant*, rather than re-deriving it from the new rectangle: on a
   * screen that got wider, an offset that was the left rail is nearer the
   * right one, and reseating by nearest alone walks the button across the
   * screen on every rotation.
   */
  const settledBounds = useSharedValue<HandleBounds | null>(null);

  const handleStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offsetX.value }, { translateY: offsetY.value }],
  }));

  /**
   * Keeps a remembered position inside a layer that has changed size under it.
   *
   * Measured or nothing: React Native reports a zero-height box before it
   * reports a real one, and a reseat run against a zero-height layer says "no
   * travel", which would throw away a remembered position on the first frame
   * of every arrival.
   */
  function measureTrack(event: LayoutChangeEvent) {
    const { width, height } = event.nativeEvent.layout;
    trackWidth.value = width;
    trackHeight.value = height;
    track.current = { width, height };
    if (width <= 0 || height <= 0) return;
    const next = boundsNow();
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
   * because activating the button is what the button is for -- it is a button
   * first, and a thing that can be relocated second.
   */
  const handleActions = [{ name: 'move', label: moveLabel }];
  const moveToNextCorner = useCallback(() => {
    const next = boundsNow();
    const corner = nextHandleCorner({ x: offsetX.value, y: offsetY.value }, next);
    settledBounds.value = next;
    settleTo(offsetX, corner.x);
    settleTo(offsetY, corner.y);
  }, [boundsNow, offsetX, offsetY, settledBounds]);
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
      // touch, not on a track beside it. Bounded by the layer and nothing else
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

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill} onLayout={measureTrack}>
      {hidden ? null : (
        <Animated.View
          pointerEvents="box-none"
          style={[styles.anchor, { bottom: resting, right: HANDLE_GAP }, handleStyle]}>
          {/* The gesture wraps a plain `View` rather than the animated or glass
              one it contains: `GestureDetector` attaches to its child by ref,
              and `GlassChrome` renders three different surfaces depending on
              the platform, none of which forwards one. */}
          <GestureDetector gesture={drag}>
            <View>
              <Animated.View entering={zoomIn('short')} exiting={zoomOut('micro')}>
                <GlassChrome style={styles.handle}>
                  <PressableScale
                    accessibilityRole="button"
                    accessibilityLabel={accessibilityLabel}
                    accessibilityHint={accessibilityHint}
                    accessibilityState={accessibilityState}
                    accessibilityActions={handleActions}
                    onAccessibilityAction={onAccessibilityAction}
                    feedback="selection"
                    pressedScale={0.9}
                    testID={testID}
                    onPress={onPress}
                    style={styles.face}>
                    {children}
                  </PressableScale>
                </GlassChrome>
              </Animated.View>
            </View>
          </GestureDetector>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  /**
   * The button's resting corner. Everything the drag does is a translation off
   * this, so the remembered offset means the same thing on every screen size.
   */
  anchor: {
    position: 'absolute',
    // Above the host's own floating chrome -- the history spinner, the
    // quick-action pair, a menu -- which are the only other things over it.
    zIndex: 12,
    elevation: 12,
  },
  /**
   * Measured against the app's other floating chrome -- `GlassChrome`,
   * `PressableScale`, the dock's key-row toggles -- the size, the radius, the
   * fill, the shadow and the centred icon already agree with them.
   */
  handle: {
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    borderRadius: HANDLE_SIZE / 2,
    borderCurve: 'continuous',
    overflow: 'hidden',
    boxShadow: appChrome.shadow.floatingPill,
  },
  face: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
