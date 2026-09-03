import { type PressableProps, Pressable, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { feedback, type FeedbackKind } from '@/lib/feedback';
import { PRESS, timing } from '@/lib/motion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type PressableScaleProps = Omit<PressableProps, 'style'> & {
  feedback?: FeedbackKind | false;
  pressedScale?: number;
  style?: StyleProp<ViewStyle>;
};

export function PressableScale({
  children,
  feedback: feedbackKind = 'selection',
  onPressIn,
  onPressOut,
  pressedScale = 0.985,
  style,
  ...props
}: PressableScaleProps) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressable
      {...props}
      onPressIn={(event) => {
        if (!props.disabled && feedbackKind) void feedback(feedbackKind);
        // `timing` carries the system ease-out and, more importantly, the
        // reduce-motion check: with the accessibility setting on, the scale
        // lands instantly instead of being animated at all.
        scale.value = withTiming(pressedScale, timing(PRESS.in));
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        scale.value = withTiming(1, timing(PRESS.out));
        onPressOut?.(event);
      }}
      style={[style, animatedStyle]}>
      {children}
    </AnimatedPressable>
  );
}
