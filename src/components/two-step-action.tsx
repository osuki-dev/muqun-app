import { memo, useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { StyleSheet, View } from 'react-native';
import { useThemeTokens } from '@osuki-dev/ui';
import { Text } from '@/components/text';
import Animated, {
  Easing,
  ReduceMotion,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { PressableScale } from '@/components/pressable-scale';
import { AGENT_TYPE } from '@/constants/agent-type';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { feedback } from '@/lib/feedback';
import { CONFIRM_WINDOW_MS, fadeIn, timing } from '@/lib/motion';

/**
 * An action that asks twice, where it stands.
 *
 * The first tap does not do the thing. It *arms* it: the row fills with the
 * danger tint, the label changes to the words that will do it, one sentence
 * says what is lost, and a line drains across the bottom for
 * `CONFIRM_WINDOW_MS`. A second tap inside that window does the thing. Letting
 * the line run out, or touching anything else that disarms it, puts the row
 * back as it was.
 *
 * It replaces the native alert. An alert is a second surface for a one-word
 * question: it dims the sheet the reader was working in, it is drawn in the
 * platform's face and colours rather than the pack's, and on a list of twenty
 * sessions it makes clearing five of them ten modal round trips. Asking in the
 * row keeps the question attached to the thing it is about, in the reader's own
 * font and theme, and keeps the second tap exactly where the first one was --
 * which is safe precisely *because* the label under the finger has changed and
 * the window is short.
 *
 * The timer that disarms is a real timer, not the end of the animation: with
 * reduced motion the line does not travel, and the window must still close.
 *
 * Nothing here exits with an animation. An exiting view leaves the layout while
 * it fades, and under a row that means over the next row -- see
 * `theme-import-progress.tsx` for the bug that taught this.
 */
export interface TwoStepActionProps {
  /** What the row says at rest: "Delete". */
  label: string;
  /** What it says once armed, and what the second tap does: "Tap again to delete". */
  confirmLabel: string;
  /** One sentence on what is lost. Shown only while armed. */
  detail?: string;
  /** A lucide glyph, sized and coloured here. */
  Icon?: ComponentType<{ size?: number; color?: string }>;
  onConfirm: () => void;
  /** Told when the row arms or disarms, so a parent can disarm its siblings. */
  onArmedChange?: (armed: boolean) => void;
  /** When supplied, the parent owns whether this action is armed. */
  armed?: boolean;
  disabled?: boolean;
  /** A compact icon action that expands only for its second, destructive tap. */
  presentation?: 'default' | 'compact';
  /** The spoken name can be more specific than the visible label. */
  accessibilityLabel?: string;
  confirmAccessibilityLabel?: string;
  testID?: string;
}

export const TwoStepAction = memo(function TwoStepAction({
  label,
  confirmLabel,
  detail,
  Icon,
  onConfirm,
  onArmedChange,
  armed: controlledArmed,
  disabled = false,
  presentation = 'default',
  accessibilityLabel,
  confirmAccessibilityLabel,
  testID,
}: TwoStepActionProps) {
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();
  const [uncontrolledArmed, setUncontrolledArmed] = useState(false);
  const armed = controlledArmed ?? uncontrolledArmed;
  const controlled = controlledArmed !== undefined;
  const arm = useSharedValue(0);
  const drain = useSharedValue(1);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onArmedChangeRef = useRef(onArmedChange);

  useEffect(() => {
    onArmedChangeRef.current = onArmedChange;
  }, [onArmedChange]);

  const setArmed = useCallback(
    (next: boolean) => {
      if (!controlled) setUncontrolledArmed(next);
      onArmedChangeRef.current?.(next);
    },
    [controlled]
  );

  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    cancelAnimation(drain);
    if (!armed || disabled) {
      arm.value = withTiming(0, timing('toggle'));
      if (armed && disabled) setArmed(false);
      return;
    }

    arm.value = withTiming(1, timing('toggle'));
    // Linear, and exempt from reduced motion's collapse only in the sense that
    // it has nothing to collapse to: a drained line is the window having shut,
    // and a line that jumped to empty at once would say the window had.
    drain.value = 1;
    drain.value = withTiming(0, {
      duration: CONFIRM_WINDOW_MS,
      easing: Easing.linear,
      reduceMotion: ReduceMotion.Never,
    });
    timer.current = setTimeout(() => setArmed(false), CONFIRM_WINDOW_MS);
    return () => clearTimeout(timer.current);
  }, [arm, armed, disabled, drain, setArmed]);

  const handlePress = useCallback(() => {
    if (disabled) return;
    if (armed) {
      void feedback('warning');
      setArmed(false);
      onConfirm();
      return;
    }
    void feedback('selection');
    setArmed(true);
  }, [armed, disabled, onConfirm, setArmed]);

  const fillStyle = useAnimatedStyle(() => ({ opacity: arm.value }));
  const restStyle = useAnimatedStyle(() => ({ opacity: 1 - arm.value }));
  const armedStyle = useAnimatedStyle(() => ({ opacity: arm.value }));
  const drainStyle = useAnimatedStyle(() => ({
    opacity: arm.value,
    transform: [{ scaleX: drain.value }],
  }));

  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={
        armed ? (confirmAccessibilityLabel ?? confirmLabel) : (accessibilityLabel ?? label)
      }
      accessibilityHint={armed ? detail : undefined}
      accessibilityState={{ disabled, expanded: armed }}
      disabled={disabled}
      onPress={handlePress}
      style={[styles.action, presentation === 'compact' ? styles.actionCompact : null]}>
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          styles.fill,
          { backgroundColor: surfaceBackground(theme.colors.dangerSubtle) },
          fillStyle,
        ]}
      />
      <View style={[styles.line, presentation === 'compact' ? styles.lineCompact : null]}>
        {Icon ? (
          <View style={styles.icon}>
            <Icon size={16} color={theme.colors.danger} />
          </View>
        ) : null}
        {/* Two labels on one spot, cross-faded, so the row never reflows
            sideways under the finger that is about to tap it again. The wider
            of the two sets the width; the other lies over it. */}
        {presentation === 'compact' && !armed ? null : (
          <View style={styles.labels} accessibilityLiveRegion="polite">
            <Animated.View style={armed ? styles.over : null}>
              <Animated.View style={restStyle}>
                <Text variant="bodySmall" color={theme.colors.danger} style={styles.label}>
                  {label}
                </Text>
              </Animated.View>
            </Animated.View>
            <Animated.View style={[armed ? null : styles.over, armedStyle]}>
              <Text variant="bodySmall" color={theme.colors.danger} style={styles.labelArmed}>
                {confirmLabel}
              </Text>
            </Animated.View>
          </View>
        )}
      </View>
      {armed && detail ? (
        <Animated.View entering={fadeIn('short')} style={styles.detail}>
          <Text variant="caption" color={theme.colors.textMuted}>
            {detail}
          </Text>
        </Animated.View>
      ) : null}
      <Animated.View
        pointerEvents="none"
        style={[styles.drain, { backgroundColor: theme.colors.danger }, drainStyle]}
      />
    </PressableScale>
  );
});

const styles = StyleSheet.create({
  action: {
    alignSelf: 'stretch',
    minHeight: 42,
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  actionCompact: {
    alignSelf: 'center',
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  fill: {
    borderRadius: 12,
    borderCurve: 'continuous',
  },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  lineCompact: { gap: 8 },
  icon: { width: 16, alignItems: 'center' },
  labels: { flexShrink: 1 },
  over: { position: 'absolute', top: 0, left: 0 },
  label: { fontSize: AGENT_TYPE.prose.size },
  labelArmed: { fontSize: AGENT_TYPE.prose.size },
  // Under the label, indented to it: the sentence belongs to the words above
  // it, not to the glyph.
  detail: { marginTop: 4, marginLeft: 28 },
  // The window, drawn. It drains towards the leading edge so the last of it
  // is under the glyph the reader's eye is already on.
  drain: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 2,
    transformOrigin: 'left center',
  },
});
