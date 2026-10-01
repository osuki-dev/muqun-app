import { type ReactNode, useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Freeze } from 'react-freeze';

import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { HomeRefreshPauseContext } from '@/hooks/use-home-refresh-pause';
import { createHomeRefreshPause } from '@/lib/home-refresh-schedule';

/**
 * The Pad shell's Home, kept alive between visits.
 *
 * Mounted on first show and then only hidden: the wallpaper, the cover and
 * Continue's rows are decoded and measured once rather than on every toggle.
 * Hidden is `display: none` -- out of layout and out of the accessibility
 * tree -- with the subtree frozen so a store update does not re-render a
 * screen nobody can see. Showing fades in over the profile's reveal duration.
 *
 * Freezing stops renders, not running effects, so Home's polling (Continue,
 * agent discovery) is paused through a signal provided from outside the
 * freeze; showing Home again refreshes both at once.
 */
export function PadHomeOverlay({ visible, children }: { visible: boolean; children: ReactNode }) {
  const [mounted, setMounted] = useState(visible);
  const [pause] = useState(() => createHomeRefreshPause(!visible));
  useEffect(() => {
    pause.set(!visible);
  }, [pause, visible]);
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
      <HomeRefreshPauseContext.Provider value={pause}>
        <Freeze freeze={!visible}>{children}</Freeze>
      </HomeRefreshPauseContext.Provider>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  hidden: { display: 'none' },
});
