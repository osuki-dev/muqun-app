import { useThemeTokens } from '@osuki-dev/ui';
import { useEffect } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { Canvas, Fill, Shader, Skia } from 'react-native-skia';
import Animated, {
  useAnimatedStyle,
  useDerivedValue,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { VOICE_METER_SAMPLES } from '@/lib/voice-meter-history';
import { VOICE_WAVEFORM_SKSL } from '@/lib/voice-waveform-shader';

function compileEffect() {
  try {
    return Skia.RuntimeEffect.Make(VOICE_WAVEFORM_SKSL);
  } catch {
    return null;
  }
}
const effect = compileEffect();
const indices = Array.from({ length: VOICE_METER_SAMPLES }, (_, index) => index);

function MeterBar({ history, index }: { history: SharedValue<number[]>; index: number }) {
  const theme = useThemeTokens();
  const reduced = useReducedMotion();
  const motion = useAnimatedStyle(() => {
    const amplitude = history.get()[index] ?? 0;
    return {
      opacity: 0.25 + amplitude * 0.75,
      transform: [{ scaleY: reduced ? 0.12 : 0.08 + amplitude * 0.92 }],
    };
  });
  return <Animated.View style={[styles.bar, { backgroundColor: theme.colors.primary }, motion]} />;
}

function GlowingWaveform({ history }: { history: SharedValue<number[]> }) {
  const theme = useThemeTokens();
  const reduced = useReducedMotion();
  const size = useSharedValue({ width: 1, height: 20 });
  const clock = useSharedValue(0);
  const lastPaint = useSharedValue(-1000);
  const frame = useFrameCallback(({ timeSinceFirstFrame }) => {
    if (timeSinceFirstFrame - lastPaint.get() < 1000 / 30) return;
    lastPaint.set(timeSinceFirstFrame);
    clock.set(timeSinceFirstFrame / 1000);
  }, false);
  useEffect(() => {
    const sync = (state: string) => frame.setActive(!reduced && state === 'active');
    sync(AppState.currentState);
    const subscription = AppState.addEventListener('change', sync);
    return () => {
      subscription.remove();
      frame.setActive(false);
    };
  }, [frame, reduced]);
  const tint = Array.from(Skia.Color(theme.colors.primary)).slice(0, 3);
  const highlight = tint.map((channel) => channel * 0.65 + 0.35);
  const uniforms = useDerivedValue(() => ({
    size: [size.get().width, size.get().height],
    time: reduced ? 0 : clock.get(),
    motion: reduced ? 0 : 1,
    amplitudes: history.get(),
    tint,
    highlight,
  }));
  return (
    <View
      style={styles.fill}
      onLayout={({ nativeEvent: { layout } }) =>
        size.set({ width: layout.width, height: layout.height })
      }>
      <Canvas testID="voice-recording-glow" style={StyleSheet.absoluteFill} pointerEvents="none">
        <Fill>
          <Shader source={effect!} uniforms={uniforms} />
        </Fill>
      </Canvas>
    </View>
  );
}

/** Mounted only for recording; no Canvas/frame callback exists in fallback or other states. */
export function VoiceRecordingWaveform({ history }: { history: SharedValue<number[]> }) {
  return (
    <View
      testID="voice-recording-meter"
      style={styles.meter}
      pointerEvents="none"
      accessible={false}>
      {effect ? (
        <GlowingWaveform history={history} />
      ) : (
        indices.map((index) => <MeterBar key={index} index={index} history={history} />)
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, height: '100%' },
  meter: {
    flex: 1,
    height: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 3,
    overflow: 'hidden',
  },
  bar: { flex: 1, maxWidth: 4, height: 20, borderRadius: 2 },
});
