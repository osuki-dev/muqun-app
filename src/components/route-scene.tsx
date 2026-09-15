import { useEffect, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { timing } from '@/lib/motion';

/** A quiet depth reveal shared by root pages. Native navigation owns back and
 * cancellation; this layer never snapshots a terminal or mounts a second one.
 * Form sheets bypass this wrapper to retain their native measurement contract.
 */
export function RouteScene({ children }: { children: ReactNode }) {
  const progress = useSharedValue(0);
  // Focus also returns when a sheet closes. Only a newly mounted route enters.
  useEffect(() => {
    progress.value = withTiming(1, timing('medium'));
  }, [progress]);
  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { translateX: (1 - progress.value) * 16 },
      { scale: 0.985 + progress.value * 0.015 },
    ],
  }));
  return <Animated.View style={[styles.scene, style]}>{children}</Animated.View>;
}
const styles = StyleSheet.create({ scene: { flex: 1 } });
