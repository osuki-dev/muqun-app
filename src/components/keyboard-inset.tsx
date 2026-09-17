import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';

/**
 * The strip of scrollable content the software keyboard is standing on.
 *
 * A sheet with a pinned search field and a list under it has a problem
 * `KeyboardAwareScrollView` does not solve: that component's job is to bring
 * the *focused input* into view, and here the input is above the scroller
 * already. What the keyboard covers is the bottom of the list, which nothing
 * scrolls to because as far as the scroller is concerned it is fully visible.
 * The model picker shipped that way: with the keyboard up, the last rows could
 * not be reached at all.
 *
 * So the scroller grows by exactly the keyboard's height, as the last thing in
 * its content. The reader can scroll the final row up above the keys, and when
 * the keyboard goes the strip collapses with it.
 *
 * Driven from `useReanimatedKeyboardAnimation`, whose `height` is the same
 * shared value the composer dock rides (negative as the keyboard rises), so
 * the inset tracks the keyboard frame by frame on the UI thread and costs no
 * React render. The same reason the dock uses it rather than a `Keyboard`
 * listener.
 */
export function KeyboardInset() {
  const { height } = useReanimatedKeyboardAnimation();
  const style = useAnimatedStyle(() => ({ height: Math.max(0, -height.value) }));
  return <Animated.View pointerEvents="none" style={style} />;
}
