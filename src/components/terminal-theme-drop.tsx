import { useThemeTokens } from '@osuki-dev/ui';
import { Text } from '@/components/text';
import { useLingui } from '@lingui/react/macro';
import { Palette, X } from 'lucide-react-native';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useReducedMotion,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { Button } from '@/components/themed-button';
import { PressableScale } from '@/components/pressable-scale';
import { GlassChrome } from '@/components/glass-chrome';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { appChrome } from '@/constants/appearance';
import { fadeOut, INSTANT, timing } from '@/lib/motion';
import { useAppActive } from '@/hooks/use-app-active';

/** What the terminal is holding: a file arriving, or a theme waiting to be looked at. */
export type TerminalThemeDropState =
  | { phase: 'downloading'; name: string; received: number; total: number | null }
  | { phase: 'ready'; name: string; themeName: string; applying: boolean }
  | { phase: 'failed'; name: string; message: string };

/**
 * A theme package arriving in the terminal, and leaving from it.
 *
 * It sits where the "jump to latest" pill sits -- same right edge, just above it
 * -- because that corner is already where this screen puts things that are
 * about the output rather than part of it, and because a card that opened in
 * the middle would push away the reply the reader is in the middle of.
 *
 * Three states and one shape. The bar fills with real bytes when the server
 * declared a length and travels as an indeterminate sweep when it did not: a
 * progress bar that invents its position is worse than one that admits it does
 * not know. Arrival settles on a `short` timing and departure fades: this app's
 * motion is percussive and mechanical by policy, so a package landing does not
 * get a bounce to announce itself.
 */
export function TerminalThemeDrop({
  state,
  bottomInset,
  onApply,
  onDismiss,
}: {
  state: TerminalThemeDropState;
  /** Clears the dock, the same way the Latest pill clears it. */
  bottomInset: number;
  onApply: () => void;
  onDismiss: () => void;
}) {
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();
  const { t } = useLingui();
  const appActive = useAppActive();
  const reduceMotion = useReducedMotion();

  const ready = state.phase === 'ready';
  // Pulled out of the dependency array so it can be checked statically: the
  // sweep exists only while a download has no declared length.
  const indeterminate = state.phase === 'downloading' && state.total === null;
  const settle = useSharedValue(0);
  const sweep = useSharedValue(0);
  useEffect(() => {
    settle.value = withTiming(ready ? 1 : 0, timing('short'));
  }, [ready, settle]);
  useEffect(() => {
    // Only while the length is unknown. A determinate bar animates from the
    // bytes themselves, and two things moving the same bar would fight.
    if (!indeterminate || !appActive || reduceMotion) {
      cancelAnimation(sweep);
      sweep.value = 0;
      return;
    }
    sweep.value = 0;
    sweep.value = withRepeat(
      withSequence(withTiming(1, timing('long')), withTiming(0, INSTANT)),
      -1,
      false
    );
    return () => cancelAnimation(sweep);
  }, [appActive, indeterminate, reduceMotion, sweep]);

  const fraction = useDerivedValue(() =>
    state.phase === 'downloading' && state.total ? Math.min(1, state.received / state.total) : 0
  );
  const barStyle = useAnimatedStyle(() =>
    indeterminate
      ? { left: `${sweep.value * 70}%`, width: '30%' }
      : { left: '0%', width: `${fraction.value * 100}%` }
  );
  const liftStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - settle.value) * 6 }],
  }));

  return (
    <Animated.View
      exiting={fadeOut('short')}
      pointerEvents="box-none"
      style={[styles.anchor, { bottom: bottomInset + 14 + 38 + 10 }]}>
      <GlassChrome surface="actions" style={styles.card}>
        <Animated.View style={[styles.body, liftStyle]}>
          <View style={styles.row}>
            <Palette size={16} color={theme.colors.primary} />
            <Text variant="bodySmall" numberOfLines={1} style={styles.title}>
              {state.phase === 'ready' ? state.themeName : state.name}
            </Text>
            <PressableScale
              testID="terminal-theme-drop-dismiss"
              accessibilityRole="button"
              accessibilityLabel={t`Dismiss this theme`}
              hitSlop={8}
              onPress={onDismiss}>
              <X size={15} color={theme.colors.textMuted} />
            </PressableScale>
          </View>

          {state.phase === 'downloading' ? (
            <>
              <View
                style={[styles.track, { backgroundColor: surfaceBackground(theme.colors.border) }]}>
                <Animated.View
                  style={[styles.fill, { backgroundColor: theme.colors.primary }, barStyle]}
                />
              </View>
              <Text variant="caption" color={theme.colors.textMuted}>
                {state.total
                  ? t`Downloading · ${formatBytes(state.received)} of ${formatBytes(state.total)}`
                  : t`Downloading · ${formatBytes(state.received)}`}
              </Text>
            </>
          ) : state.phase === 'failed' ? (
            <Text variant="caption" color={theme.colors.danger}>
              {state.message}
            </Text>
          ) : (
            <>
              <Text variant="caption" color={theme.colors.textMuted}>
                {t`Ready to preview. Nothing is applied until you say so.`}
              </Text>
              <Button
                testID="terminal-theme-drop-apply"
                disabled={state.applying}
                onPress={onApply}>
                {state.applying ? t`Applying…` : t`Preview and apply`}
              </Button>
            </>
          )}
        </Animated.View>
      </GlassChrome>
    </Animated.View>
  );
}

/** Whole numbers below a megabyte; a decimal above, where one still reads. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const styles = StyleSheet.create({
  // The Latest pill's own right edge, so the two stack rather than sit apart.
  anchor: { position: 'absolute', right: 14, left: 14, zIndex: 10, elevation: 10 },
  card: {
    borderRadius: appChrome.radius.control,
    borderCurve: 'continuous',
    overflow: 'hidden',
    boxShadow: appChrome.shadow.popover,
    alignSelf: 'flex-end',
    maxWidth: 420,
    width: '100%',
  },
  body: { padding: 12, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1 },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { position: 'absolute', top: 0, bottom: 0, borderRadius: 2 },
});
