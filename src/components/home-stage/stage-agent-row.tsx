import { useLingui } from '@lingui/react/macro';
import { useLingui as useLinguiRuntime } from '@lingui/react';
import { PressableScale, Text, useThemeMode, useThemeTokens } from '@osuki-dev/ui';
import { useEffect } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { useMinuteNow } from '@/hooks/use-minute-now';
import { useTaskAge } from '@/hooks/use-task-age';
import { agentStatusWord, connectionStatusDescription } from '@/i18n/labels';
import { withAlpha } from '@/lib/color';
import { HOME_DOCK_OUTER_INSET } from '@/lib/home-pad-geometry';
import { stageAgentRow, type StageAgentChip, type StagePanel } from '@/lib/home-stage-panels';
import { PULSE_PERIOD, timing } from '@/lib/motion';

/** The row's height, kept while it is empty so the art above it never moves. */
const ROW_HEIGHT = 30;

/**
 * The selected computer's agents, one chip each under the art: a dot in the
 * agent's state colour, its name, and what it is doing only when that is
 * not idle. A working dot breathes slowly and a waiting one pulses gently,
 * on the UI thread, only while Home is on screen (held still under Reduce
 * Motion). An offline computer's row is one muted "last seen" line. A tap
 * opens that agent.
 */
export function StageAgentRow({
  panel,
  paused,
  onOpenAgent,
}: {
  panel: StagePanel | undefined;
  /** Home is off screen or covered: nothing breathes. */
  paused: boolean;
  onOpenAgent: (chip: StageAgentChip) => void;
}) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const theme = useThemeTokens();
  const age = useTaskAge();
  const nowMs = useMinuteNow();
  const reducedMotion = useReducedMotion();
  const row = panel ? stageAgentRow(panel) : null;
  const chips = row?.kind === 'agents' ? row.chips : [];
  const breath = useBeat(
    !paused && !reducedMotion && chips.some((chip) => chip.mark === 'working'),
    PULSE_PERIOD,
    0.35
  );
  const beat = useBeat(
    !paused && !reducedMotion && chips.some((chip) => chip.mark === 'needs-you'),
    PULSE_PERIOD / 2,
    0.5
  );
  if (!panel || !row) return <View style={styles.row} />;
  if (row.kind === 'offline') {
    const seen = row.lastSeenMs;
    const text =
      seen !== undefined
        ? t`Offline · last seen ${age(seen, nowMs)}`
        : _(connectionStatusDescription[panel.connection]);
    return (
      <View testID="home-stage-agents" style={[styles.row, styles.offline]}>
        <View style={[styles.dot, { backgroundColor: theme.colors.textDisabled }]} />
        <Text variant="caption" color={theme.colors.textMuted} numberOfLines={1}>
          {text}
        </Text>
      </View>
    );
  }
  return (
    <ScrollView
      testID="home-stage-agents"
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.row}
      contentContainerStyle={styles.chips}>
      {chips.map((chip) => (
        <StageAgentChipView
          key={chip.key}
          chip={chip}
          pulse={chip.mark === 'working' ? breath : chip.mark === 'needs-you' ? beat : null}
          word={
            chip.word === 'needs-you'
              ? t`Needs you`
              : chip.word === 'working'
                ? _(agentStatusWord.working)
                : null
          }
          state={
            chip.mark === 'needs-you'
              ? t`Needs you`
              : chip.mark === 'working'
                ? _(agentStatusWord.working)
                : _(agentStatusWord.idle)
          }
          onPress={() => onOpenAgent(chip)}
        />
      ))}
    </ScrollView>
  );
}

/**
 * An opacity that swings between 1 and `low` over `period` while `on`, and
 * eases back to 1 when it stops.
 */
function useBeat(on: boolean, period: number, low: number): SharedValue<number> {
  const value = useSharedValue(1);
  useEffect(() => {
    if (!on) {
      cancelAnimation(value);
      value.set(withTiming(1, timing('short')));
      return;
    }
    value.set(withRepeat(withTiming(low, timing(period)), -1, true));
    return () => cancelAnimation(value);
  }, [on, period, low, value]);
  return value;
}

function StageAgentChipView({
  chip,
  pulse,
  word,
  state,
  onPress,
}: {
  chip: StageAgentChip;
  /** The dot's breathing or pulse, shared by the row's chips of one state; null holds it still. */
  pulse: SharedValue<number> | null;
  word: string | null;
  /** The state for the screen reader, idle included. */
  state: string;
  onPress: () => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const { resolvedMode } = useThemeMode();
  const tone =
    chip.mark === 'needs-you'
      ? theme.colors.warning
      : chip.mark === 'working'
        ? theme.colors.primary
        : theme.colors.textMuted;
  const dotStyle = useAnimatedStyle(() => ({ opacity: pulse ? pulse.get() : 1 }));
  return (
    <PressableScale
      testID={`home-stage-agent-${chip.key}`}
      accessibilityRole="button"
      accessibilityLabel={`${chip.name}, ${state}`}
      accessibilityHint={t`Opens this agent.`}
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: withAlpha(theme.colors.surface, resolvedMode === 'light' ? 0.78 : 0.66),
          borderColor:
            chip.mark === 'needs-you'
              ? withAlpha(theme.colors.warning, 0.55)
              : withAlpha(theme.colors.text, 0.1),
        },
      ]}>
      <Animated.View style={[styles.dot, { backgroundColor: tone }, dotStyle]} />
      <Text variant="caption" weight="semibold" numberOfLines={1}>
        {chip.name}
      </Text>
      {word ? (
        <Text
          variant="caption"
          color={chip.mark === 'needs-you' ? theme.colors.warning : theme.colors.textMuted}
          numberOfLines={1}>
          {word}
        </Text>
      ) : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: { height: ROW_HEIGHT, flexGrow: 0 },
  chips: { paddingHorizontal: HOME_DOCK_OUTER_INSET, gap: 6, alignItems: 'center' },
  offline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: HOME_DOCK_OUTER_INSET + 2,
    opacity: 0.85,
  },
  chip: {
    height: ROW_HEIGHT - 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    borderRadius: (ROW_HEIGHT - 2) / 2,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
});
