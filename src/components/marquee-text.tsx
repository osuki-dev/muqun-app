import { memo, useEffect, useState, type ComponentProps } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Text } from '@osuki-dev/ui';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { MARQUEE_MOTION } from '@/lib/motion';

/**
 * One line, always -- and a line too long for its row travels instead of
 * wrapping or being cut.
 *
 * A row that wraps is a row twice as tall as its neighbours, and a list of
 * them stops being a list the eye can run down. A row that ellipsises throws
 * away the end of the title, which on this app is usually the part that tells
 * two sessions of the same agent apart. So the line is laid out at its natural
 * width inside a clipped box, and when it does not fit it rests on its start,
 * slides to its end, rests, and comes back.
 *
 * Only a line that overflows animates; one that fits is a plain `Text` in a
 * box and costs nothing. The travel is a transform on the UI thread, so a
 * screen of these does no layout and no React work while they move.
 *
 * With reduced motion the line does not travel. It falls back to the ellipsis,
 * which is the honest still version of the same thing.
 */
type TextProps = ComponentProps<typeof Text>;

export interface MarqueeTextProps extends Omit<TextProps, 'numberOfLines' | 'children'> {
  children: string;
}

export const MarqueeText = memo(function MarqueeText({
  children,
  style,
  ...text
}: MarqueeTextProps) {
  const reduceMotion = useReducedMotion();
  const [box, setBox] = useState(0);
  const [line, setLine] = useState(0);
  const offset = useSharedValue(0);

  // Half a point of slack: a line that overflows by a rounding error is a line
  // that fits, and one that twitched a hair every few seconds would be worse
  // than either alternative.
  const overflow = box > 0 && line > 0 ? Math.max(0, Math.ceil(line - box)) : 0;
  const travels = overflow > 1 && !reduceMotion;

  useEffect(() => {
    cancelAnimation(offset);
    offset.value = 0;
    if (!travels) return;
    const travelMs = (overflow / MARQUEE_MOTION.speed) * 1000;
    const glide = { duration: travelMs, easing: Easing.inOut(Easing.quad) };
    offset.value = withRepeat(
      withSequence(
        withDelay(MARQUEE_MOTION.holdStartMs, withTiming(-overflow, glide)),
        withDelay(MARQUEE_MOTION.holdEndMs, withTiming(0, glide))
      ),
      -1
    );
    return () => cancelAnimation(offset);
  }, [offset, overflow, travels]);

  const travel = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));

  const onBox = (event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width);
    setBox((current) => (current === next ? current : next));
  };
  const onLine = (event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width);
    setLine((current) => (current === next ? current : next));
  };

  if (reduceMotion) {
    return (
      <Text {...text} style={style} numberOfLines={1}>
        {children}
      </Text>
    );
  }

  return (
    <View style={styles.box} onLayout={onBox}>
      {/* A row, and a line that will not shrink: inside one, a `Text` takes its
          natural single-line width even when that is wider than the box, which
          is the measurement the whole component turns on. */}
      <Animated.View style={[styles.track, travel]}>
        <Text
          {...text}
          style={StyleSheet.flatten([style, styles.line])}
          numberOfLines={1}
          onLayout={onLine}>
          {children}
        </Text>
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  box: { alignSelf: 'stretch', overflow: 'hidden' },
  track: { flexDirection: 'row' },
  line: { flexShrink: 0 },
});
