import { useEffect, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useThemeTokens } from '@osuki-dev/ui';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { timing } from '@/lib/motion';

/** A quiet depth reveal shared by root pages. Native navigation owns back and
 * cancellation; this layer never snapshots a terminal or mounts a second one.
 * Form sheets bypass this wrapper to retain their native measurement contract.
 */
export function RouteScene({ children }: { children: ReactNode }) {
  const { colors } = useThemeTokens();
  const progress = useSharedValue(0);
  // Focus also returns when a sheet closes. Only a newly mounted route enters.
  useEffect(() => {
    progress.value = withTiming(1, timing('medium'));
  }, [progress]);
  const style = useAnimatedStyle(() => ({
    // Native navigation owns the fade. A second fade exposed an empty floor,
    // while translating a smaller page left an uncovered strip at its edge.
    // Settle from slightly larger than the viewport so every frame covers it.
    transform: [{ scale: 1 + (1 - progress.value) * 0.015 }],
  }));
  return (
    <View style={[styles.viewport, { backgroundColor: colors.background }]}>
      <Animated.View style={[styles.scene, style]}>{children}</Animated.View>
    </View>
  );
}
const styles = StyleSheet.create({
  viewport: { flex: 1, overflow: 'hidden' },
  scene: { flex: 1 },
});
