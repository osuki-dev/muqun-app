import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { PULSE_PERIOD, STATE_POP_SCALE, timing } from '@/lib/motion';

/**
 * A status light where the shape carries the certainty and the colour only
 * carries the state.
 *
 * Filled means the app has evidence. Hollow means it has not asked. That
 * distinction is the whole reason this is a component and not two lines of
 * inline style: the home screen has two different greys to tell apart -- "asked
 * and got nothing" and "never asked" -- and hue cannot be what tells them
 * apart, both because they would be the same grey and because a status must
 * never be legible by colour alone.
 *
 * The words always travel with it; see `reachabilityLabelText`.
 *
 * ## Why it moves
 *
 * Two animations, and each is a fact rather than a decoration:
 *
 *  * The dot swells once whenever the state behind it changes, because a light
 *    that changes colour between two frames while nobody is looking at it has
 *    not told anyone anything. This is also what a successful connection looks
 *    like: `NOT CONNECTED` to `ONLINE` is exactly that transition.
 *  * A `pulse` dot emits a slow ring, and only a server the app has just heard
 *    from gets one. It is the difference between a status that was true once
 *    and a status that is true now, which is the distinction the whole
 *    reachability model exists to protect.
 *
 * Both are off under reduce motion -- checked with the hook rather than with
 * `ReduceMotion.System`, because a repeating animation whose duration the
 * system has collapsed to zero is a busy loop, not a stilled one.
 */
export function StatusDot({
  color,
  filled,
  size = 7,
  pulse = false,
}: {
  color: string;
  /** False draws a ring: the app has no evidence either way. */
  filled: boolean;
  size?: number;
  /** Emits a slow ring. Reserved for "answering right now". */
  pulse?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const pop = useSharedValue(1);
  const ripple = useSharedValue(0);

  // Keyed on the two things that make this a different status, so a re-render
  // that changes neither -- a parent list re-sorting, a clock tick -- does not
  // set the dot off again.
  useEffect(() => {
    if (reduceMotion) return;
    pop.value = withSequence(
      withTiming(STATE_POP_SCALE, timing('micro')),
      withTiming(1, timing('short'))
    );
  }, [color, filled, pop, reduceMotion]);

  useEffect(() => {
    if (!pulse || reduceMotion) {
      cancelAnimation(ripple);
      ripple.value = 0;
      return;
    }
    ripple.value = 0;
    ripple.value = withRepeat(withTiming(1, timing(PULSE_PERIOD)), -1, false);
    return () => cancelAnimation(ripple);
  }, [pulse, reduceMotion, ripple]);

  const dotStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  const rippleStyle = useAnimatedStyle(() => ({
    opacity: (1 - ripple.value) * RIPPLE_PEAK_OPACITY,
    transform: [{ scale: 1 + ripple.value * (RIPPLE_MAX_SCALE - 1) }],
  }));

  return (
    <View
      // Decorative on purpose: the label beside it is what a screen reader
      // reads, so announcing the dot as well would say everything twice.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size }}>
      {/* Before the dot, so the dot paints over it. A ring that crosses a
          filled dot on its way out cuts a notch through it, which is the one
          thing a status light must never look like it is doing. Left out
          entirely rather than kept at zero opacity: an unused ring is still a
          view the list lays out on every server. */}
      {pulse && !reduceMotion ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.ripple, { borderRadius: size, borderColor: color }, rippleStyle]}
        />
      ) : null}
      <Animated.View
        style={[
          styles.dot,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: filled ? color : 'transparent',
            borderColor: color,
            // A ring this small needs a full point of stroke to stay a ring; a
            // hairline reads as a smudge at 7px.
            borderWidth: filled ? 0 : 1.5,
          },
          dotStyle,
        ]}
      />
    </View>
  );
}

/** How far the ring travels before it is gone. */
const RIPPLE_MAX_SCALE = 2.6;
/** Its brightest moment, which is at the very start. */
const RIPPLE_PEAK_OPACITY = 0.36;
/** How far outside the dot the ring begins. */
const RIPPLE_INSET = 2;

const styles = StyleSheet.create({
  dot: {
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Starts just outside the dot rather than on top of it, so the ring reads as
  // something the light is giving off.
  ripple: {
    position: 'absolute',
    left: -RIPPLE_INSET,
    right: -RIPPLE_INSET,
    top: -RIPPLE_INSET,
    bottom: -RIPPLE_INSET,
    borderWidth: 1,
    borderCurve: 'continuous',
  },
});
