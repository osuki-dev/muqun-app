import { useState, useMemo, memo } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  CheckSquare,
  CheckCircle2,
  Circle,
  Clock,
  ChevronDown,
  ChevronRight,
} from 'lucide-react-native';
import Animated from 'react-native-reanimated';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { useCompactMarkdownStyle } from '@/hooks/use-markdown-style';
import { BoundedMarkdown } from '@/components/bounded-markdown';
import { strikeMarkdown } from '@/lib/markdown-text';
import { withAlpha } from '@/lib/color';
import { fadeIn, fadeOut } from '@/lib/motion';
import type { TodoItem } from '@/lib/agent-session';
import { AGENT_TYPE } from '@/constants/agent-type';

export interface AgentTodoBlockProps {
  items: readonly TodoItem[];
  title?: string;
  defaultExpanded?: boolean;
}

export const AgentTodoBlock = memo(function AgentTodoBlock({
  items,
  title,
  defaultExpanded,
}: AgentTodoBlockProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();
  // Three readings of one style, not three styles: an item is the body ink, a
  // done one is muted and struck (`strikeMarkdown`, because `MarkdownStyle`
  // has no text decoration), and the one being worked on is the same ink in
  // the weight the list has always given it.
  const itemStyle = useCompactMarkdownStyle('body');
  const doneStyle = useCompactMarkdownStyle('muted');
  const currentStyle = useMemo(
    () => ({ ...itemStyle, paragraph: { ...itemStyle.paragraph, fontWeight: '600' } }),
    [itemStyle]
  );

  const total = items.length;
  const completedCount = useMemo(() => items.filter((it) => it.done).length, [items]);
  const allCompleted = total > 0 && completedCount === total;

  // Respect defaultExpanded or default to collapsed
  const [expanded, setExpanded] = useState(() => {
    if (defaultExpanded !== undefined) return defaultExpanded;
    return false;
  });

  if (total === 0) return null;

  const progressPct = total > 0 ? (completedCount / total) * 100 : 0;
  // First non-done item is considered "in progress"
  const firstPendingIdx = items.findIndex((it) => !it.done);

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: surfaceBackground(theme.colors.surface),
          borderColor: allCompleted ? withAlpha(theme.colors.primary, 0.27) : theme.colors.border,
          borderRadius: expanded ? 18 : 999,
        },
      ]}>
      <Pressable
        testID="agent-todo-accordion"
        accessibilityLabel={expanded ? t`Collapse tasks` : t`Expand tasks`}
        hitSlop={6}
        onPress={() => setExpanded((prev) => !prev)}
        style={({ pressed }) => [styles.header, pressed && { opacity: 0.7 }]}>
        <View style={styles.headerLeft}>
          <CheckSquare
            size={14}
            color={allCompleted ? theme.colors.success : theme.colors.primary}
          />
          <Text variant="caption" weight="semibold" color={theme.colors.text} style={styles.title}>
            {title ?? <Trans>Tasks</Trans>}
          </Text>
          <View
            style={[
              styles.countBadge,
              {
                backgroundColor: allCompleted
                  ? withAlpha(theme.colors.success, 0.11)
                  : withAlpha(theme.colors.primary, 0.09),
              },
            ]}>
            <Text
              variant="caption"
              weight="bold"
              color={allCompleted ? theme.colors.success : theme.colors.primary}
              style={styles.countText}>
              {`${completedCount}/${total}`}
            </Text>
          </View>
        </View>

        <View style={styles.headerRight}>
          {expanded ? (
            <ChevronDown size={14} color={theme.colors.textMuted} />
          ) : (
            <ChevronRight size={14} color={theme.colors.textMuted} />
          )}
        </View>
      </Pressable>

      {/* Progress Bar Line */}
      <View
        style={[styles.progressTrack, { backgroundColor: withAlpha(theme.colors.border, 0.4) }]}>
        <View
          style={[
            styles.progressBar,
            {
              width: `${progressPct}%`,
              backgroundColor: allCompleted ? theme.colors.success : theme.colors.primary,
            },
          ]}
        />
      </View>

      {expanded ? (
        <Animated.View entering={fadeIn()} exiting={fadeOut()} style={styles.body}>
          {items.map((item, idx) => {
            const isCompleted = item.done;
            const isInProgress = !isCompleted && idx === firstPendingIdx;

            return (
              <View key={item.text} style={styles.itemRow}>
                <View style={styles.itemIcon}>
                  {isCompleted ? (
                    <CheckCircle2 size={14} color={theme.colors.success} strokeWidth={2.2} />
                  ) : isInProgress ? (
                    <Clock size={14} color={theme.colors.primary} strokeWidth={2.2} />
                  ) : (
                    <Circle size={13} color={theme.colors.textMuted} strokeWidth={1.8} />
                  )}
                </View>

                {/* The model writes a checklist the way it writes everything
                    else -- `agent-tool-card.tsx`, a path, the odd emphasis --
                    so an item is markdown, at the card's own size. Nothing
                    here is pressable, so the native view swallows no tap. */}
                <View style={styles.itemText}>
                  <BoundedMarkdown
                    markdown={isCompleted ? strikeMarkdown(item.text) : item.text}
                    markdownStyle={
                      isCompleted ? doneStyle : isInProgress ? currentStyle : itemStyle
                    }
                    containerStyle={styles.itemBody}
                    openLinks={false}
                  />
                </View>
              </View>
            );
          })}
        </Animated.View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    borderRadius: 8,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    marginVertical: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  title: {
    fontSize: AGENT_TYPE.meta.size,
  },
  countBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
  },
  countText: {
    fontSize: AGENT_TYPE.micro.size,
  },
  headerRight: {
    padding: 2,
  },
  progressTrack: {
    height: 2,
    width: '100%',
  },
  progressBar: {
    height: '100%',
  },
  body: {
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 8,
    gap: 7,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  itemIcon: {
    marginTop: 1,
  },
  itemText: {
    flex: 1,
    minWidth: 0,
  },
  itemBody: {
    alignSelf: 'stretch',
    // The last paragraph's own margin would otherwise be a gap under every
    // item on top of the list's own.
    marginBottom: -6,
  },
});
