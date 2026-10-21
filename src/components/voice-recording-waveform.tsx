import { useThemeTokens } from '@osuki-dev/ui';
import { useEffect } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { Canvas, Fill, Shader, Skia } from 'react-native-skia';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { timing } from '@/lib/motion';
import { VOICE_METER_SAMPLES } from '@/lib/voice-meter-history';
import { VOICE_WAVEFORM_SKSL } from '@/lib/voice-waveform-shader';
import { useAppearanceProfile } from '@/components/appearance-profile-provider';

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
 * The stop control's ring: the recorder's level while recording, a slowly
 * turning arc while the recording is transcribed.
 *
 * The level is for realtime transcription, where the field belongs to the
 * live transcript and the full-width waveform would sit on top of it. It
 * breathes with a smoothed level -- the RMS of the newest few samples of the
 * history the waveform reads, eased toward on the UI thread -- rather than
 * jumping with each sample. `level={false}` keeps only the transcribing arc,
 * for a recorder whose waveform already shows the level.
 *
 * The arc cross-fades in over the level as `processing` turns on and stops
 * turning the moment it turns off. It never grows past the 44pt control.
 * Reduce Motion: no scaling and no rotation, only fades.
 */
export function VoiceLevelRing({
  history,
  processing = false,
  level = true,
}: {
  history: SharedValue<number[]>;
  processing?: boolean;
  level?: boolean;
}) {
  const theme = useThemeTokens();
  // Traced on the stop control, so it takes that control's corner: a circle
  // under a round profile, a rounded square under an angular one.
  const profile = useAppearanceProfile();
  const corner = Math.min(LEVEL_RING_SIZE / 2, profile.chrome.roundControl);
  const reduced = useReducedMotion();
  const settled = useSharedValue(processing ? 1 : 0);
  useEffect(() => {
    settled.set(withTiming(processing ? 1 : 0, timing('short')));
  }, [processing, settled]);
  const smoothed = useSharedValue(0);
  useAnimatedReaction(
    () => history.get(),
    (samples) => {
      const previous = smoothed.get();
      smoothed.set(previous + (recentLevel(samples) - previous) * LEVEL_EASE);
    }
  );
  const turn = useSharedValue(0);
  useEffect(() => {
    if (!processing || reduced) {
      cancelAnimation(turn);
      return;
    }
    turn.set(0);
    turn.set(withRepeat(withTiming(1, { duration: ARC_PERIOD_MS, easing: Easing.linear }), -1));
    return () => cancelAnimation(turn);
  }, [processing, reduced, turn]);
  const levelStyle = useAnimatedStyle(() => {
    const quiet = settled.get();
    const live = Math.min(1, smoothed.get());
    return {
      // Under the arc it stays as a faint track.
      opacity: (0.3 + live * 0.7) * (1 - quiet) + 0.18 * quiet,
      transform: [
        {
          scale: reduced
            ? 1
            : Math.min(LEVEL_RING_MAX_SCALE, (0.88 + live * 0.32) * (1 - quiet) + quiet),
        },
      ],
    };
  });
  const arcStyle = useAnimatedStyle(() => ({
    opacity: settled.get(),
    transform: [{ rotate: `${turn.get() * 360}deg` }],
  }));
  const shape = { borderRadius: corner, borderCurve: 'continuous' as const };
  return (
    <>
      {level ? (
        <Animated.View
          pointerEvents="none"
          accessible={false}
          style={[styles.levelRing, shape, { borderColor: theme.colors.primary }, levelStyle]}
        />
      ) : null}
      <Animated.View
        testID={processing ? 'voice-transcribing-arc' : undefined}
        pointerEvents="none"
        accessible={false}
        style={[
          styles.levelRing,
          shape,
          { borderColor: 'transparent', borderTopColor: theme.colors.primary },
          arcStyle,
        ]}
      />
    </>
  );
}

/** The RMS of the newest few samples: a level that follows speech, not each blip. */
function recentLevel(samples: number[]): number {
  'worklet';
  const from = Math.max(0, samples.length - LEVEL_WINDOW);
  let sum = 0;
  for (let index = from; index < samples.length; index += 1) sum += samples[index]! ** 2;
  return samples.length > from ? Math.sqrt(sum / (samples.length - from)) : 0;
}

function QuietProcessingIndicator() {
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();
  const corner = Math.min(QUIET_RING_SIZE / 2, profile.chrome.roundControl);
  return (
    <View
      style={[
        styles.quietRing,
        { borderColor: theme.colors.primary, borderRadius: corner, borderCurve: 'continuous' },
      ]}
    />
  );
}

const LEVEL_RING_SIZE = 34;
const LEVEL_RING_BORDER = 2;
/** The stop control the ring is traced on. */
const STOP_CONTROL_SIZE = 44;
/** The ring at its loudest still fits inside the control, border and all. */
const LEVEL_RING_MAX_SCALE = (STOP_CONTROL_SIZE - LEVEL_RING_BORDER) / LEVEL_RING_SIZE;
/** Samples the level is the RMS of, and how far each update eases toward it. */
const LEVEL_WINDOW = 4;
const LEVEL_EASE = 0.3;
/** One turn of the transcribing arc. */
const ARC_PERIOD_MS = 1400;
const QUIET_RING_SIZE = 16;

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
  quietRing: { width: QUIET_RING_SIZE, height: QUIET_RING_SIZE, borderWidth: 2, opacity: 0.6 },
  levelRing: {
    position: 'absolute',
    width: LEVEL_RING_SIZE,
    height: LEVEL_RING_SIZE,
    borderWidth: LEVEL_RING_BORDER,
  },
  bar: { flex: 1, maxWidth: 4, height: 20, borderRadius: 2 },
});
