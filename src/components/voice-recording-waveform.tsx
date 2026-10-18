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
  withTiming,
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

type WaveformProps = {
  history: SharedValue<number[]>;
  processing?: boolean;
  compact?: boolean;
};

function GlowingWaveform({ history, processing = false }: WaveformProps) {
  const theme = useThemeTokens();
  const reduced = useReducedMotion();
  const size = useSharedValue({ width: 1, height: 56 });
  const clock = useSharedValue(0);
  const transition = useSharedValue(processing ? 1 : 0);
  useEffect(() => {
    transition.set(withTiming(processing ? 1 : 0, { duration: reduced ? 0 : 280 }));
  }, [processing, reduced, transition]);
  const lastPaint = useSharedValue(-1000);
  const frame = useFrameCallback(({ timeSinceFirstFrame, timeSincePreviousFrame }) => {
    // Reanimated resets elapsed time whenever a stopped callback is activated.
    if (timeSincePreviousFrame === null) lastPaint.set(-1000);
    if (timeSinceFirstFrame - lastPaint.get() < 1000 / 30) return;
    lastPaint.set(timeSinceFirstFrame);
    clock.set(timeSinceFirstFrame / 1000);
  }, false);
  useEffect(() => {
    const sync = (state: string) => frame.setActive(!reduced && state === 'active');
    sync(AppState.currentState ?? 'unknown');
    const subscription = AppState.addEventListener('change', sync);
    return () => {
      subscription.remove();
      frame.setActive(false);
    };
  }, [frame, reduced]);
  const color = Array.from(Skia.Color(theme.colors.primary));
  const tint = color.slice(0, 3);
  const tintOpacity = color[3] ?? 1;
  const highlight = tint.map((channel) => channel * 0.65 + 0.35);
  const uniforms = useDerivedValue(() => ({
    size: [size.get().width, size.get().height],
    time: reduced ? 0 : clock.get(),
    motion: reduced ? 0 : 1,
    processing: transition.get(),
    // The recorder smooths history once; another timing here would chase
    // every intermediate frame and make the waveform lag behind speech.
    amplitudes: history.get(),
    tint,
    highlight,
    tintOpacity,
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

/** Keep mounted across recording/processing so the same Canvas morphs in place. */
export function VoiceRecordingWaveform({
  history,
  processing = false,
  compact = false,
}: WaveformProps) {
  return (
    <View
      testID="voice-recording-meter"
      style={[styles.meter, { height: compact ? 24 : 56 }]}
      pointerEvents="none"
      accessible={false}>
      {effect ? (
        <GlowingWaveform history={history} processing={processing} />
      ) : processing ? (
        <QuietProcessingIndicator />
      ) : (
        indices.map((index) => <MeterBar key={index} index={index} history={history} />)
      )}
    </View>
  );
}

/**
 * The recorder's level on the stop control, for realtime transcription,
 * where the field belongs to the live transcript and the full-width
 * waveform would sit on top of it. A ring around the stop square breathes
 * with the newest sample of the same history the waveform reads; once the
 * recording is being finished it settles to a quiet, steady ring rather
 * than vanishing, the same hand-over the waveform makes.
 */
export function VoiceLevelRing({
  history,
  processing = false,
}: {
  history: SharedValue<number[]>;
  processing?: boolean;
}) {
  const theme = useThemeTokens();
  const reduced = useReducedMotion();
  const settled = useSharedValue(processing ? 1 : 0);
  useEffect(() => {
    settled.set(withTiming(processing ? 1 : 0, { duration: reduced ? 0 : 280 }));
  }, [processing, reduced, settled]);
  const motion = useAnimatedStyle(() => {
    const samples = history.get();
    const amplitude = samples[samples.length - 1] ?? 0;
    const quiet = settled.get();
    const live = reduced ? 0.5 : amplitude;
    return {
      opacity: (0.3 + live * 0.7) * (1 - quiet) + 0.6 * quiet,
      transform: [{ scale: (0.88 + live * 0.28) * (1 - quiet) + quiet }],
    };
  });
  return (
    <Animated.View
      pointerEvents="none"
      accessible={false}
      style={[styles.levelRing, { borderColor: theme.colors.primary }, motion]}
    />
  );
}

function QuietProcessingIndicator() {
  const theme = useThemeTokens();
  return <View style={[styles.quietRing, { borderColor: theme.colors.primary }]} />;
}

const styles = StyleSheet.create({
  fill: { flex: 1, height: '100%' },
  meter: {
    width: '100%',
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    overflow: 'hidden',
  },
  quietRing: { width: 16, height: 16, borderWidth: 2, borderRadius: 8, opacity: 0.6 },
  levelRing: {
    position: 'absolute',
    width: 34,
    height: 34,
    borderWidth: 2,
    borderRadius: 17,
  },
  bar: { flex: 1, maxWidth: 4, height: 20, borderRadius: 2 },
});
