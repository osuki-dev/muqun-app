import { useEffect } from 'react';
import { Sparkles } from 'lucide-react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { useAppActive } from '@/hooks/use-app-active';
import { timing } from '@/lib/motion';

/**
 * OpenCode-style thinking mark: the spark breathes — a slow scale and opacity
 * pulse, for as long as the parent keeps it mounted.
 *
 * The three lines that matter are the ones about stopping.
 *
 * An endless `withRepeat` is not stopped by unmounting the view it drives.
 * Every tool card in a transcript mounts one of these while it runs and drops
 * it when it finishes, and each dropped one went on animating a view whose
 * surface had gone -- `Reanimated: synchronouslyUpdateUIProps failed … Unable
 * to find SurfaceMountingManager`, 3,429 times in one dogfood session, one per
 * frame per abandoned mark. `cancelAnimation` on the way out is the whole fix.
 *
 * And, like every other repeating animation in this app, it is off under
 * reduce motion and while the app is in the background -- checked with the
 * hooks rather than with `ReduceMotion.System`, because a repeating animation
 * whose duration the system has collapsed to zero is a busy loop, not a
 * stilled one.
 */
export function ThinkingIndicator({ size = 13, color }: { size?: number; color: string }) {
  const reduceMotion = useReducedMotion();
  const appActive = useAppActive();
  const pulse = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion || !appActive) {
      cancelAnimation(pulse);
      pulse.value = 1;
      return;
    }
    pulse.value = withRepeat(
      withSequence(withTiming(1, timing('long')), withTiming(0, timing('long'))),
      -1
    );
    return () => cancelAnimation(pulse);
  }, [appActive, pulse, reduceMotion]);

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: 0.5 + 0.5 * pulse.value,
    transform: [{ scale: 0.82 + 0.22 * pulse.value }],
  }));

  return (
    <Animated.View style={pulseStyle}>
      <Sparkles size={size} color={color} />
    </Animated.View>
  );
}
