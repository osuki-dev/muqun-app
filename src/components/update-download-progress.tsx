import { useThemeTokens } from '@osuki-dev/ui';
import { useEffect, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { Canvas, Fill, Shader, Skia } from 'react-native-skia';
import {
  useDerivedValue,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { timing } from '@/lib/motion';
import { measuredUpdateProgress, UPDATE_PROGRESS_SKSL } from '@/lib/update-progress-shader';

function compileEffect() {
  try {
    return Skia.RuntimeEffect.Make(UPDATE_PROGRESS_SKSL);
  } catch {
    return null;
  }
}
const effect = compileEffect();

function FlowingProgress({ progress }: { progress: number }) {
  const theme = useThemeTokens();
  const size = useSharedValue({ width: 1, height: 10 });
  const fraction = useSharedValue(progress);
  const clock = useSharedValue(0);
  const lastPaint = useSharedValue(-1000);
  useEffect(() => {
    fraction.set(withTiming(progress, timing('short')));
  }, [fraction, progress]);
  const frame = useFrameCallback(({ timeSinceFirstFrame, timeSincePreviousFrame }) => {
    if (timeSincePreviousFrame === null) lastPaint.set(-1000);
    if (timeSinceFirstFrame - lastPaint.get() < 1000 / 30) return;
    lastPaint.set(timeSinceFirstFrame);
    clock.set(timeSinceFirstFrame / 1000);
  }, false);
  useEffect(() => {
    frame.setActive(true);
    return () => frame.setActive(false);
  }, [frame]);
  const tint = Array.from(Skia.Color(theme.colors.primary)).slice(0, 3);
  const uniforms = useDerivedValue(() => ({
    size: [size.get().width, size.get().height],
    progress: fraction.get(),
    time: clock.get(),
    tint,
  }));
  return (
    <View
      style={StyleSheet.absoluteFill}
      onLayout={({ nativeEvent: { layout } }) =>
        size.set({ width: layout.width, height: layout.height })
      }>
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        <Fill>
          <Shader source={effect!} uniforms={uniforms} />
        </Fill>
      </Canvas>
    </View>
  );
}

/** No Canvas or frame callback survives ready, reduced motion or background. */
export function UpdateDownloadProgress({
  value,
  downloading,
}: {
  value: number;
  downloading: boolean;
}) {
  const theme = useThemeTokens();
  const reduced = useReducedMotion();
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) =>
      setActive(state === 'active')
    );
    return () => subscription.remove();
  }, []);
  const progress = measuredUpdateProgress(value);
  return (
    <View
      testID="update-download-progress"
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.floor(progress * 100) }}
      style={styles.track}>
      <View style={[styles.line, { backgroundColor: theme.colors.primarySubtle }]} />
      {downloading && active && !reduced && effect ? (
        <FlowingProgress progress={progress} />
      ) : (
        <View
          style={[
            styles.line,
            { width: `${progress * 100}%`, backgroundColor: theme.colors.primary },
          ]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 10, overflow: 'hidden' },
  line: { position: 'absolute', top: 4, left: 0, right: 0, height: 3, borderRadius: 2 },
});
