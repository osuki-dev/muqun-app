import { useEffect, useRef, useState, memo } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { useLingui } from '@lingui/react/macro';
import { ChevronDown } from 'lucide-react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { ThinkingIndicator } from '@/components/agent-thinking-indicator';
import { fadeIn, timing } from '@/lib/motion';
import { formatThoughtDuration } from '@/lib/agent-reasoning';
import { withAlpha } from '@/lib/color';

/** How often a live count updates. A tenth of a second reads as a stopwatch. */
const TICK_MS = 100;

export interface AgentReasoningBlockProps {
  text: string;
  /** The summed duration of the run, once every step has reported one. */
  durationMs?: number;
  /**
   * Whether the model is still thinking.
   *
   * The label counts up while this is true and settles on `durationMs` when it
   * clears -- the block never sits there as an empty pill, which is what a
   * reasoning part that has only just started used to draw.
   */
  pending?: boolean;
  defaultExpanded?: boolean;
  /** Called after the body mounts so a virtualised list can re-measure row heights. */
  onSizeChange?: () => void;
}

export const AgentReasoningBlock = memo(function AgentReasoningBlock({
  text,
  durationMs,
  pending = false,
  defaultExpanded = false,
  onSizeChange,
}: AgentReasoningBlockProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const [expanded, setExpanded] = useState(defaultExpanded);

  /**
   * The live count, while the model is still thinking.
   *
   * Started at mount rather than from a timestamp on the wire: a reasoning
   * part that has only just begun has no `time` of its own, and the reader is
   * watching this block from the moment it appears, so the moment it appeared
   * is the honest zero.
   */
  const startedAt = useRef<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    if (!pending) return;
    // Read the clock in the effect, never during render: a render that asks
    // the time is a render whose result changes on its own.
    const from = startedAt.current ?? Date.now();
    startedAt.current = from;
    const timer = setInterval(() => setElapsedMs(Date.now() - from), TICK_MS);
    return () => clearInterval(timer);
  }, [pending]);

  const chevronProgress = useSharedValue(expanded ? 1 : 0);
  useEffect(() => {
    chevronProgress.value = withTiming(expanded ? 1 : 0, timing('micro'));
  }, [expanded, chevronProgress]);
  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${chevronProgress.value * 90}deg` }],
  }));

  // Settled beats live: the moment the engine reports a real duration, that
  // is what the block says.
  const shown = durationMs !== undefined ? durationMs : pending ? elapsedMs : null;
  const durationStr = shown === null ? null : formatThoughtDuration(shown);
  const label = durationStr ? t`Thought · ${durationStr}` : t`Thought`;

  // The body mounts into a virtualised row whose cached height predates it;
  // tell the list to re-measure once the layout settled so the rows below are
  // never painted over the expanded body.
  useEffect(() => {
    if (!expanded) return;
    const timer = setTimeout(() => onSizeChange?.(), 80);
    return () => clearTimeout(timer);
  }, [expanded, onSizeChange]);

  return (
    <View style={styles.container}>
      <Pressable
        testID="agent-reasoning-accordion"
        accessibilityLabel={expanded ? t`Collapse reasoning` : t`Expand reasoning`}
        hitSlop={6}
        disabled={!text}
        onPress={() => setExpanded((prev) => !prev)}
        style={({ pressed }) => [
          styles.headerPill,
          { backgroundColor: withAlpha(theme.colors.primary, 0.08) },
          pressed && { opacity: 0.7 },
        ]}>
        {/* The same breathing mark the assistant thinks with, so a block that
            is still counting reads as work rather than as a stalled pill. */}
        <ThinkingIndicator size={12} color={theme.colors.primary} />
        {/* Keyed on the label so the settled duration fades in where the live
            count was, rather than replacing it between two frames. */}
        <Animated.View key={label} entering={fadeIn('micro')}>
          <Text variant="caption" weight="medium" color={theme.colors.primary} style={styles.title}>
            {label}
          </Text>
        </Animated.View>
        {text ? (
          <Animated.View style={chevronStyle}>
            <ChevronDown size={12} color={theme.colors.primary} style={styles.chevron} />
          </Animated.View>
        ) : null}
      </Pressable>

      {expanded && text ? (
        <Animated.View
          entering={fadeIn('micro')}
          style={[styles.body, { borderLeftColor: withAlpha(theme.colors.primary, 0.35) }]}>
          <Text
            selectable
            variant="caption"
            color={theme.colors.textMuted}
            style={styles.reasoningText}>
            {text}
          </Text>
        </Animated.View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    marginVertical: 4,
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  headerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderCurve: 'continuous',
    alignSelf: 'flex-start',
  },
  title: {
    fontSize: 11.5,
  },
  chevron: {
    opacity: 0.75,
  },
  body: {
    marginLeft: 10,
    marginTop: 6,
    marginBottom: 4,
    paddingLeft: 12,
    borderLeftWidth: 1.5,
  },
  reasoningText: {
    fontSize: 12,
    lineHeight: 18,
    fontStyle: 'italic',
  },
});
