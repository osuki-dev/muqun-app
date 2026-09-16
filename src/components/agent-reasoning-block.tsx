import { useState, memo } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { Trans } from '@lingui/react/macro';
import { Sparkles, ChevronDown, ChevronRight } from 'lucide-react-native';
import Animated from 'react-native-reanimated';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { fadeIn, fadeOut } from '@/lib/motion';

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
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();
  const [expanded, setExpanded] = useState(defaultExpanded);

  const durationStr = durationMs ? `${(durationMs / 1000).toFixed(1)}s` : null;

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: surfaceBackground(theme.colors.surface),
          borderColor: theme.colors.border,
        },
      ]}>
      <Pressable
        testID="agent-reasoning-accordion"
        accessibilityLabel={expanded ? 'Collapse reasoning' : 'Expand reasoning'}
        hitSlop={6}
        onPress={() => setExpanded((prev) => !prev)}
        style={({ pressed }) => [styles.header, pressed && { opacity: 0.7 }]}>
        <View style={styles.headerLeft}>
          <Sparkles size={14} color={theme.colors.primary} />
          <Text variant="caption" color={theme.colors.textMuted} style={styles.title}>
            <Trans>Reasoning</Trans>
          </Text>
          {durationStr ? (
            <View style={[styles.durationBadge, { backgroundColor: `${theme.colors.primary}18` }]}>
              <Text variant="caption" color={theme.colors.primary} style={styles.durationText}>
                {durationStr}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.headerRight}>
          {expanded ? (
            <ChevronDown size={14} color={theme.colors.textMuted} />
          ) : (
            <ChevronRight size={14} color={theme.colors.textMuted} />
          )}
        </View>
      </Pressable>

      {expanded ? (
        <Animated.View entering={fadeIn()} exiting={fadeOut()} style={styles.body}>
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
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    marginVertical: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 7,
    paddingHorizontal: 10,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  title: {
    fontWeight: '600',
    fontSize: 11.5,
  },
  durationBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  durationText: {
    fontSize: 10,
    fontWeight: '600',
  },
  headerRight: {
    padding: 2,
  },
  body: {
    paddingHorizontal: 10,
    paddingBottom: 8,
    paddingTop: 2,
  },
  reasoningText: {
    fontSize: 11.5,
    lineHeight: 16,
    fontStyle: 'italic',
  },
});
