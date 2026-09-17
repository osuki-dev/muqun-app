import { useEffect } from 'react';
import { Sparkles } from 'lucide-react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { timing } from '@/lib/motion';

/**
 * OpenCode-style thinking mark: the spark breathes — a slow scale and opacity
 * pulse, repeated for as long as the parent keeps it mounted. Loops on the UI
 * thread, honours reduced motion, and costs nothing while a message streams.
 */
export function ThinkingIndicator({ size = 13, color }: { size?: number; color: string }) {
  const pulse = useSharedValue(0);

  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(withTiming(1, timing('long')), withTiming(0, timing('long'))),
      -1
    );
  }, [pulse]);

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
