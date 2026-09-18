import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { useAppActive } from '@/hooks/use-app-active';
import { STAGGER, timing } from '@/lib/motion';

/** How many squares the snake has, and how far apart their beats are. */
const SQUARES = 4;
const BEAT_MS = STAGGER.card * 4;

/**
 * The thinking mark: a short snake of squares. While the model is thinking a
 * pulse runs along the row, square by square, the way a cursor walks a line
 * of a terminal; when it is done the row stands still at rest.
 *
 * Only `active` animates. A settled Thought block, a finished tool card and
 * a footer that waits on the reader all mount this with `active={false}`, and
 * a still mark is the signal that nothing is happening -- the old spark
 * breathed forever, which read as work that never ended.
 *
 * An endless `withRepeat` is not stopped by unmounting the view it drives;
 * every one is cancelled on the way out, and none runs under reduce motion
 * or while the app is in the background.
 */
export function ThinkingIndicator({
  size = 13,
  color,
  active = true,
}: {
  size?: number;
  color: string;
  active?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const appActive = useAppActive();
  const run = active && appActive && !reduceMotion;
  const square = Math.max(3, Math.round(size / 4));
  const gap = Math.max(1, Math.round(square / 2));
  return (
    <View style={[styles.row, { gap }]} accessible={false}>
      {Array.from({ length: SQUARES }, (_, index) => (
        <Square key={index} index={index} size={square} color={color} run={run} />
      ))}
    </View>
  );
}

function Square({
  index,
  size,
  color,
  run,
}: {
  index: number;
  size: number;
  color: string;
  run: boolean;
}) {
  const glow = useSharedValue(run ? 0 : 1);
  useEffect(() => {
    if (!run) {
      cancelAnimation(glow);
      glow.value = withTiming(0.55, timing('micro'));
      return;
    }
    glow.value = withDelay(
      index * BEAT_MS,
      withRepeat(
        withSequence(
          withTiming(1, timing('short')),
          withTiming(0.2, timing('medium')),
          withTiming(0.2, timing('long'))
        ),
        -1
      )
    );
    return () => cancelAnimation(glow);
  }, [glow, index, run]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.2 + 0.8 * glow.value,
    transform: [{ scale: 0.8 + 0.2 * glow.value }],
  }));
  return (
    <Animated.View
      style={[
        style,
        { width: size, height: size, borderRadius: Math.max(1, size / 4), backgroundColor: color },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
});
