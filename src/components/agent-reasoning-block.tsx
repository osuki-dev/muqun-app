import { useEffect, useState, memo } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { useLingui } from '@lingui/react/macro';
import { Sparkles, ChevronDown } from 'lucide-react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { fadeIn, fadeOut, timing } from '@/lib/motion';
import { withAlpha } from '@/lib/color';

export interface AgentReasoningBlockProps {
  text: string;
  durationMs?: number;
  defaultExpanded?: boolean;
}

export const AgentReasoningBlock = memo(function AgentReasoningBlock({
  text,
  durationMs,
  defaultExpanded = false,
}: AgentReasoningBlockProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const [expanded, setExpanded] = useState(defaultExpanded);

  const chevronProgress = useSharedValue(expanded ? 1 : 0);
  useEffect(() => {
    chevronProgress.value = withTiming(expanded ? 1 : 0, timing('micro'));
  }, [expanded, chevronProgress]);
  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${chevronProgress.value * 90}deg` }],
  }));

  const durationStr = durationMs ? `${(durationMs / 1000).toFixed(1)}s` : null;

  return (
    <View style={styles.container}>
      <Pressable
        testID="agent-reasoning-accordion"
        accessibilityLabel={expanded ? t`Collapse reasoning` : t`Expand reasoning`}
        hitSlop={6}
        onPress={() => setExpanded((prev) => !prev)}
        style={({ pressed }) => [
          styles.headerPill,
          { backgroundColor: withAlpha(theme.colors.primary, 0.08) },
          pressed && { opacity: 0.7 },
        ]}>
        <Sparkles size={12} color={theme.colors.primary} />
        <Text variant="caption" weight="medium" color={theme.colors.primary} style={styles.title}>
          {durationStr ? t`Thought · ${durationStr}` : t`Thought`}
        </Text>
        <Animated.View style={chevronStyle}>
          <ChevronDown size={12} color={theme.colors.primary} style={styles.chevron} />
        </Animated.View>
      </Pressable>

      {expanded ? (
        <Animated.View
          entering={fadeIn('micro')}
          exiting={fadeOut('micro')}
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
