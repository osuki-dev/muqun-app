import { type ComponentProps, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  KeyboardAwareScrollView,
  useReanimatedKeyboardAnimation,
} from 'react-native-keyboard-controller';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { homeScrollViewportBottom } from '@/lib/home-scroll-viewport';

/**
 * Clip scrolling foreground, not the wallpaper or the composer's overflowing art.
 * Keep the scroll view's height stable as the dock moves: resizing it would change
 * its scroll range and feed layout events back into hide-on-scroll on every frame.
 */
export function HomeScrollViewport({
  children,
  dockHeight,
  dockOffset,
  ...scrollProps
}: ComponentProps<typeof KeyboardAwareScrollView> & {
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

  return (
    <View
      testID="home-scroll-viewport"
      style={styles.viewport}
      onLayout={(event) => setHeight(event.nativeEvent.layout.height)}>
      <Animated.View style={[styles.clip, clipStyle]}>
        <View style={height > 0 ? { height } : styles.viewport}>
          <KeyboardAwareScrollView {...scrollProps}>{children}</KeyboardAwareScrollView>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  viewport: { flex: 1 },
  clip: { ...StyleSheet.absoluteFill, overflow: 'hidden' },
});
