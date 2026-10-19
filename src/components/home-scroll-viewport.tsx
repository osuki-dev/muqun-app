import { type ComponentProps, useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import {
  KeyboardAwareScrollView,
  useReanimatedKeyboardAnimation,
} from 'react-native-keyboard-controller';
import Animated, {
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useComposedEventHandler,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { useStableHandler } from '@/hooks/use-render-refs';
import { homeScrollViewportBottom } from '@/lib/home-scroll-viewport';

type ScrollEvent = NativeSyntheticEvent<NativeScrollEvent>;
type ScrollHandler = Parameters<typeof useComposedEventHandler>[0][number];

/** Quiet time after the last coasting frame that counts as the fling having stopped. */
const COAST_SETTLE_MS = 120;

/**
 * Clip scrolling foreground, not the wallpaper or the composer's overflowing art.
 * Keep the scroll view's height stable as the dock moves: resizing it would change
 * its scroll range and feed layout events back into hide-on-scroll on every frame.
 *
 * Momentum callbacks are derived here instead of being passed to the scroll view.
 * Passing either one makes Android send native momentum events, and React Native's
 * Android scroll view drops the end event when a touch lands while the fling is
 * settling (`cancelPostTouchScrolling`). JS `ScrollView` then believes it is still
 * decelerating and captures every touch start, so the page scrolls while no row,
 * tile or card inside it can be pressed until a later fling ends cleanly.
 */
export function HomeScrollViewport({
  children,
  dockHeight,
  dockOffset,
  onMomentumScrollBegin,
  onMomentumScrollEnd,
  onScroll,
  ...scrollProps
}: ComponentProps<typeof KeyboardAwareScrollView> & {
  /** Painted dock height; transparent decoration only contributes to scroll padding. */
  dockHeight: number;
  dockOffset?: SharedValue<number>;
}) {
  const [height, setHeight] = useState(0);
  const { height: keyboardOffset } = useReanimatedKeyboardAnimation();
  const clipStyle = useAnimatedStyle(() => ({
    bottom: homeScrollViewportBottom(
      dockHeight,
      dockOffset?.get() ?? 0,
      keyboardOffset.get(),
      height
    ),
  }));

  // Coasting: scroll frames that arrive with no finger down, from a fling or a
  // programmatic scroll. It begins on the first such frame and ends once they stop.
  const coasting = useRef(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endCoast = useStableHandler((y: number) => {
    settleTimer.current = null;
    if (!coasting.current) return;
    coasting.current = false;
    onMomentumScrollEnd?.(coastEvent(y));
  });
  const coast = useStableHandler((y: number) => {
    if (!coasting.current) {
      coasting.current = true;
      onMomentumScrollBegin?.(coastEvent(y));
    }
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => endCoast(y), COAST_SETTLE_MS);
  });
  const grab = useStableHandler((y: number) => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    endCoast(y);
  });
  useEffect(
    () => () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
    },
    []
  );
  const coastHandler = useAnimatedScrollHandler<{ dragging: boolean }>({
    onBeginDrag(event, context) {
      context.dragging = true;
      scheduleOnRN(grab, event.contentOffset.y);
    },
    onEndDrag(_event, context) {
      context.dragging = false;
    },
    onScroll(event, context) {
      if (!context.dragging) scheduleOnRN(coast, event.contentOffset.y);
    },
  });
  // Callers pass a Reanimated scroll handler, which the prop type does not describe.
  const scrollHandler = useComposedEventHandler([
    (onScroll ?? null) as unknown as ScrollHandler | null,
    coastHandler as unknown as ScrollHandler,
  ]);

  return (
    <View
      testID="home-scroll-viewport"
      style={styles.viewport}
      onLayout={(event) => setHeight(event.nativeEvent.layout.height)}>
      <Animated.View style={[styles.clip, clipStyle]}>
        <View style={height > 0 ? { height } : styles.viewport}>
          <KeyboardAwareScrollView
            {...scrollProps}
            onScroll={
              scrollHandler as unknown as ComponentProps<typeof KeyboardAwareScrollView>['onScroll']
            }>
            {children}
          </KeyboardAwareScrollView>
        </View>
      </Animated.View>
    </View>
  );
}

function coastEvent(y: number): ScrollEvent {
  return { nativeEvent: { contentOffset: { x: 0, y } } } as ScrollEvent;
}

const styles = StyleSheet.create({
  viewport: { flex: 1 },
  clip: { ...StyleSheet.absoluteFill, overflow: 'hidden' },
});
