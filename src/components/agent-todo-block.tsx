import { useState, useMemo, memo } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { Trans } from '@lingui/react/macro';
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
import { fadeIn, fadeOut } from '@/lib/motion';
import type { TodoItem } from '@/lib/agent-session';

export interface AgentTodoBlockProps {
  items: TodoItem[];
  title?: string;
  defaultExpanded?: boolean;
}

export const AgentTodoBlock = memo(function AgentTodoBlock({
  items,
  title,
  defaultExpanded,
}: AgentTodoBlockProps) {
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();

  const total = items.length;
  const completedCount = useMemo(() => items.filter((it) => it.done).length, [items]);
  const allCompleted = total > 0 && completedCount === total;

  // Auto-expand if not all completed, or respect defaultExpanded
  const [expanded, setExpanded] = useState(() => {
    if (defaultExpanded !== undefined) return defaultExpanded;
    return !allCompleted;
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
          borderColor: allCompleted ? `${theme.colors.primary}44` : theme.colors.border,
        },
      ]}>
      <Pressable
        testID="agent-todo-accordion"
        accessibilityLabel={expanded ? 'Collapse tasks' : 'Expand tasks'}
        hitSlop={6}
        onPress={() => setExpanded((prev) => !prev)}
        style={({ pressed }) => [styles.header, pressed && { opacity: 0.7 }]}>
        <View style={styles.headerLeft}>
          <CheckSquare
            size={14}
            color={allCompleted ? (theme.colors.success ?? '#22c55e') : theme.colors.primary}
          />
          <Text variant="caption" weight="semibold" color={theme.colors.text} style={styles.title}>
            {title ?? <Trans>Tasks</Trans>}
          </Text>
          <View
            style={[
              styles.countBadge,
              {
                backgroundColor: allCompleted
                  ? `${theme.colors.success ?? '#22c55e'}1c`
                  : `${theme.colors.primary}18`,
              },
            ]}>
            <Text
              variant="caption"
              weight="bold"
              color={allCompleted ? (theme.colors.success ?? '#22c55e') : theme.colors.primary}
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
      <View style={[styles.progressTrack, { backgroundColor: `${theme.colors.border}66` }]}>
        <View
          style={[
            styles.progressBar,
            {
              width: `${progressPct}%`,
              backgroundColor: allCompleted
                ? (theme.colors.success ?? '#22c55e')
                : theme.colors.primary,
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
              <View key={`${idx}-${item.text.slice(0, 20)}`} style={styles.itemRow}>
                <View style={styles.itemIcon}>
                  {isCompleted ? (
                    <CheckCircle2
                      size={14}
                      color={theme.colors.success ?? '#22c55e'}
                      strokeWidth={2.2}
                    />
                  ) : isInProgress ? (
                    <Clock size={14} color={theme.colors.primary} strokeWidth={2.2} />
                  ) : (
                    <Circle size={13} color={theme.colors.textMuted} strokeWidth={1.8} />
                  )}
                </View>

                <Text
                  selectable
                  variant="caption"
                  color={
                    isCompleted
                      ? theme.colors.textMuted
                      : isInProgress
                        ? theme.colors.text
                        : theme.colors.text
                  }
                  style={StyleSheet.flatten([
                    styles.itemText,
                    isCompleted && styles.itemDoneText,
                    isInProgress && styles.itemInProgressText,
                  ])}>
                  {item.text}
                </Text>
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
    fontSize: 12,
  },
  countBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
  },
  countText: {
    fontSize: 10.5,
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
    fontSize: 12,
    lineHeight: 17,
  },
  itemDoneText: {
    textDecorationLine: 'line-through',
    opacity: 0.7,
  },
  itemInProgressText: {
    fontWeight: '600',
  },
});
