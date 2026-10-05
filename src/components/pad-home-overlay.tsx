import { Activity, type ReactNode, useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useAppearanceProfile } from '@/components/appearance-profile-provider';

/**
 * The Pad shell's Home, kept alive between visits.
 *
 * Mounted on first show and then only hidden: the wallpaper, the cover and
 * Continue's rows are decoded and measured once rather than on every toggle.
 * Hidden is `display: none` -- out of layout and out of the accessibility
 * tree -- inside a hidden React `Activity`: state and layout are kept, store
 * updates render at low priority, and the subtree's effects are cleaned up, so
 * Home's 30 s polling (Continue, agent discovery) stops while hidden and runs
 * again, at once, when Home is shown. Showing fades in over the profile's
 * reveal duration.
 */
export function PadHomeOverlay({ visible, children }: { visible: boolean; children: ReactNode }) {
  const [mounted, setMounted] = useState(visible);
  if (visible && !mounted) setMounted(true);

  const revealMs = useAppearanceProfile().motion.revealMs;
  const reduceMotion = useReducedMotion();
  const opacity = useSharedValue(visible ? 1 : 0);
  useEffect(() => {
    if (!visible) opacity.set(0);
    else opacity.set(reduceMotion ? 1 : withTiming(1, { duration: revealMs }));
  }, [opacity, reduceMotion, revealMs, visible]);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: opacity.get() }));

  if (!mounted) return null;
  return (
    <Animated.View
      testID="home-overview-overlay"
      style={[StyleSheet.absoluteFill, visible ? null : styles.hidden, fadeStyle]}>
      <Activity mode={visible ? 'visible' : 'hidden'}>{children}</Activity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  hidden: { display: 'none' },
});
