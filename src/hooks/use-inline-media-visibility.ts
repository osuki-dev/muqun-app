import { useContext, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import Animated, {
  measure,
  useAnimatedRef,
  useFrameCallback,
  useSharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { DiagramVisibility } from '@/components/diagram-visibility';

export function useInlineMediaVisibility() {
  const active = useContext(DiagramVisibility);
  const { height } = useWindowDimensions();
  const ref = useAnimatedRef<Animated.View>();
  const lastCheck = useSharedValue(0);
  const measuredVisible = useSharedValue(true);
  const [inViewport, setInViewport] = useState(true);
  useFrameCallback((frame) => {
    if (!active || frame.timeSinceFirstFrame - lastCheck.get() < 100) return;
    lastCheck.set(frame.timeSinceFirstFrame);
    const bounds = measure(ref);
    if (!bounds) return;
    const next = bounds.pageY + bounds.height > 0 && bounds.pageY < height;
    if (next !== measuredVisible.get()) {
      measuredVisible.set(next);
      scheduleOnRN(setInViewport, next);
    }
  });
  return { ref, visible: active && inViewport };
}
