import { useThemeTokens } from '@osuki-dev/ui';
import { useEffect } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { Canvas, Fill, Path, Shader, Skia } from 'react-native-skia';
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
  // Samples arrive a few times a second, each shifting the history one slot.
  // Between arrivals the ribbon slides on by the fraction of a slot that has
  // elapsed, so it flows instead of stepping; the interval is learnt from the
  // arrivals themselves. The newest level is eased every frame for the same
  // reason. Both run on the UI thread, at the display's own rate.
  const now = useSharedValue(0);
  const arrival = useSharedValue({ at: -1, interval: SAMPLE_INTERVAL_MS });
  const shift = useSharedValue(0);
  const target = useSharedValue(0);
  const level = useSharedValue(0);
  useAnimatedReaction(
    () => history.get(),
    (samples, previous) => {
      if (previous === null || samples === previous) return;
      const at = now.get();
      const last = arrival.get();
      const gap = at - last.at;
      arrival.set({
        at,
        interval:
          last.at < 0
            ? last.interval
            : Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, last.interval * 0.8 + gap * 0.2)),
      });
      target.set(samples[samples.length - 1] ?? 0);
    }
  );
  const frame = useFrameCallback(({ timeSinceFirstFrame, timeSincePreviousFrame }) => {
    // Reanimated resets elapsed time whenever a stopped callback is activated.
    if (timeSincePreviousFrame === null) arrival.set({ ...arrival.get(), at: -1 });
    now.set(timeSinceFirstFrame);
    clock.set(timeSinceFirstFrame / 1000);
    const last = arrival.get();
    shift.set(last.at < 0 ? 0 : Math.min(1, (timeSinceFirstFrame - last.at) / last.interval));
    const ease = 1 - Math.exp(-(timeSincePreviousFrame ?? 16) / LEVEL_EASE_MS);
    level.set(level.get() + (target.get() - level.get()) * ease);
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
    amplitudes: history.get(),
    shift: reduced ? 0 : shift.get(),
    level: reduced ? (history.get()[VOICE_METER_SAMPLES - 1] ?? 0) : level.get(),
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
 * The stop control's transcribing arc: a slowly turning stretch of the
 * control's outline while the recording is transcribed. The level itself is
 * the waveform's.
 *
 * The arc fades in as `processing` turns on and stops turning the moment it
 * turns off. It is a stroke along the outline, not a rotated top border: under
 * a squarer corner a rotated border is a straight bar swinging around the stop
 * square. Reduce Motion: no travel, only the fade.
 */
export function VoiceTranscribingArc({ processing = false }: { processing?: boolean }) {
  const theme = useThemeTokens();
  // Traced on the stop control, so it takes that control's corner: a circle
  // under a round profile, a rounded square under an angular one.
  const profile = useAppearanceProfile();
  const corner = Math.min(ARC_SIZE / 2, profile.chrome.roundControl);
  const reduced = useReducedMotion();
  const settled = useSharedValue(processing ? 1 : 0);
  useEffect(() => {
    settled.set(withTiming(processing ? 1 : 0, timing('short')));
  }, [processing, settled]);
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
  const arcStyle = useAnimatedStyle(() => ({ opacity: settled.get() }));
  // The arc is a stretch of the outline travelling around it. The outline is
  // traced twice, so a stretch that runs past the end of one lap continues on
  // the next instead of wrapping to a second path.
  const arcStart = useDerivedValue(() => turn.get() / 2);
  const arcEnd = useDerivedValue(() => (turn.get() + ARC_LENGTH) / 2);
  const inset = ARC_STROKE / 2;
  const outline = Skia.RRectXY(
    Skia.XYWHRect(inset, inset, ARC_SIZE - inset * 2, ARC_SIZE - inset * 2),
    Math.max(0, corner - inset),
    Math.max(0, corner - inset)
  );
  const arcPath = Skia.PathBuilder.Make().addRRect(outline).addRRect(outline).detach();
  return (
    <Animated.View
      testID={processing ? 'voice-transcribing-arc' : undefined}
      pointerEvents="none"
      accessible={false}
      style={[styles.arc, arcStyle]}>
      {/* A Skia surface only while there is an arc to draw: none for the
          whole of a recording, beside the waveform's own canvas. */}
      {processing ? (
        <Canvas style={StyleSheet.absoluteFill}>
          <Path
            path={arcPath}
            color={theme.colors.primary}
            style="stroke"
            strokeWidth={ARC_STROKE}
            strokeCap="round"
            start={arcStart}
            end={arcEnd}
          />
        </Canvas>
      ) : null}
    </Animated.View>
  );
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

const ARC_SIZE = 34;
const ARC_STROKE = 2;
/** The meter's nominal cadence and the range the learnt one is held to. */
const SAMPLE_INTERVAL_MS = 75;
const MIN_INTERVAL_MS = 40;
const MAX_INTERVAL_MS = 200;
/** How quickly the waveform's live edge follows the newest sample. */
const LEVEL_EASE_MS = 70;
/** One lap of the transcribing arc, and how much of the outline it covers. */
const ARC_PERIOD_MS = 1400;
const ARC_LENGTH = 0.25;
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
  arc: { position: 'absolute', width: ARC_SIZE, height: ARC_SIZE },
  bar: { flex: 1, maxWidth: 4, height: 20, borderRadius: 2 },
});
