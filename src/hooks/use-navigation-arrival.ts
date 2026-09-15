import { useEffect } from 'react';
import {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { NAVIGATION_MOTION, timing } from '@/lib/motion';

/** The title settles once while the native stack reveals a stable page. */
export function useNavigationArrival() {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(1, timing(NAVIGATION_MOTION.headerMs));
    return () => cancelAnimation(progress);
  }, [progress]);
  return useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * NAVIGATION_MOTION.headerDistance }],
  }));
}
