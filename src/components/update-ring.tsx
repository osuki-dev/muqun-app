import { Text, useThemeTokens } from '@osuki-dev/ui';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Canvas, Circle, Group, Path, Skia } from 'react-native-skia';
import {
  ReduceMotion,
  useDerivedValue,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { useAppActive } from '@/hooks/use-app-active';
import { BREATH_PERIOD, DURATION, timing, TRAVEL_PERIOD } from '@/lib/motion';

/** Waiting on the reader, transferring (0 = not measured yet), or staged. */
export type UpdateRingState = 'waiting' | 'progress' | 'done';

const SIZE = 40;
const CENTER = SIZE / 2;
const RADIUS = 16;
/** The travelling arc's share of the ring while progress is unmeasured. */
const ARC = 0.22;
const TURN = Math.PI * 2;
// Skia's circle starts at three o'clock; the group turns it to twelve.
const ring = Skia.PathBuilder.Make().addCircle(CENTER, CENTER, RADIUS).detach();
const check = Skia.PathBuilder.Make().moveTo(14, 20.5).lineTo(18.2, 24.6).lineTo(26.2, 16).detach();
const calm = (duration: number) => timing(duration, { reduceMotion: ReduceMotion.Never });

/**
 * The update dialog's mark: a thin ring in the theme's accent.
 *
 * Waiting, it breathes once every `BREATH_PERIOD`; transferring, it is the
 * progress (a travelling arc until the SDK reports any); staged, it closes and
 * a check draws itself. Every change is a shared value the canvas reads, so
 * nothing here renders per frame, and the only clock is a 30 fps frame
 * callback that runs while it breathes or travels, never under Reduce Motion,
 * in the background or after unmount.
 */
export function UpdateRing({ state, progress }: { state: UpdateRingState; progress: number }) {
  const theme = useThemeTokens();
  const reduced = useReducedMotion();
  const appActive = useAppActive();
  const indeterminate = state === 'progress' && progress <= 0;

  const end = useSharedValue(reduced ? 1 : 0);
  const spin = useSharedValue(0);
  const glow = useSharedValue(1);
  const width = useSharedValue(1.6);
  const checkEnd = useSharedValue(0);
  const checkOpacity = useSharedValue(0);
  const breathing = useSharedValue(state === 'waiting');
  const lastPaint = useSharedValue(-1000);

  const frame = useFrameCallback(({ timeSinceFirstFrame, timeSincePreviousFrame }) => {
    if (timeSincePreviousFrame === null) lastPaint.set(timeSinceFirstFrame);
    const step = timeSinceFirstFrame - lastPaint.get();
    if (step < 1000 / 30 && timeSincePreviousFrame !== null) return;
    lastPaint.set(timeSinceFirstFrame);
    if (breathing.get()) {
      const breath = Math.sin((timeSinceFirstFrame / BREATH_PERIOD) * TURN);
      glow.set(0.8 + 0.15 * breath);
      width.set(1.6 + 0.2 * breath);
    } else {
      spin.set((spin.get() + (step / TRAVEL_PERIOD) * TURN) % TURN);
    }
  }, false);

  const running = appActive && !reduced && (state === 'waiting' || indeterminate);
  useEffect(() => {
    breathing.set(state === 'waiting');
    frame.setActive(running);
    return () => frame.setActive(false);
  }, [breathing, frame, running, state]);

  useEffect(() => {
    if (state !== 'waiting') {
      glow.set(withTiming(1, calm(DURATION.short)));
      width.set(withTiming(1.8, calm(DURATION.short)));
    }
    if (!indeterminate && spin.get() !== 0) {
      // Finish the turn the arc is on, so measured progress starts at twelve.
      spin.set(withTiming(TURN, calm(DURATION.short), () => spin.set(0)));
    }
    const target = state === 'progress' ? (indeterminate ? ARC : progress) : 1;
    end.set(withTiming(target, calm(state === 'waiting' ? DURATION.long : DURATION.medium)));
    if (state === 'done') {
      checkOpacity.set(withTiming(1, calm(DURATION.short)));
      checkEnd.set(
        reduced ? 1 : withDelay(DURATION.short, withTiming(1, calm(DURATION.medium + 100)))
      );
    } else {
      checkOpacity.set(withTiming(0, calm(DURATION.micro)));
      checkEnd.set(withTiming(0, calm(DURATION.micro)));
    }
  }, [checkEnd, checkOpacity, end, glow, indeterminate, progress, reduced, spin, state, width]);

  const turn = useDerivedValue(() => [{ rotate: spin.get() - Math.PI / 2 }]);
  const accent = theme.colors.primary;
  const percentage = Math.floor(Math.max(0, Math.min(1, progress)) * 100);
  return (
    <View style={styles.container} pointerEvents="none">
      <Canvas style={StyleSheet.absoluteFill}>
        <Circle cx={CENTER} cy={CENTER} r={RADIUS - 3} color={accent} opacity={0.08} />
        <Circle
          cx={CENTER}
          cy={CENTER}
          r={RADIUS}
          color={accent}
          opacity={0.18}
          style="stroke"
          strokeWidth={1.4}
        />
        <Group transform={turn} origin={{ x: CENTER, y: CENTER }}>
          <Path
            path={ring}
            color={accent}
            opacity={glow}
            style="stroke"
            strokeWidth={width}
            strokeCap="round"
            start={0}
            end={end}
          />
        </Group>
        <Path
          path={check}
          color={accent}
          opacity={checkOpacity}
          style="stroke"
          strokeWidth={2}
          strokeCap="round"
          strokeJoin="round"
          start={0}
          end={checkEnd}
        />
      </Canvas>
      {state === 'progress' && !indeterminate && Number.isFinite(percentage) ? (
        <View
          style={styles.label}
          accessible={false}
          importantForAccessibility="no-hide-descendants">
          <Text
            testID="update-progress-percent"
            color={accent}
            weight="medium"
            numberOfLines={1}
            maxFontSizeMultiplier={1.2}
            style={styles.percentage}>
            {percentage}%
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: SIZE, height: SIZE },
  label: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  percentage: {
    fontSize: 10,
    lineHeight: 14,
    fontVariant: ['tabular-nums'],
    includeFontPadding: false,
  },
});
