import { WorkTaskSection } from '@/components/work-task-scroll';
import { Pressable, View, type PressableProps } from 'react-native';
import { useWorkTaskFocus } from '@/hooks/use-work-task-focus';
import { useLingui } from '@lingui/react/macro';
import { Text } from '@osuki-dev/ui';
import { Button } from '@/components/themed-button';
import { LADDER } from '@/components/settings-chrome';
import type { WorkTaskRow } from '@/lib/work-summaries';
import { WorkTaskSummaryFacts } from './work-task-summary-facts';

/** The controller keeps this snapshot stable until the reader chooses to refresh it. */
export function WorkTaskList({
  tasks,
  selectedTaskId,
  focusTaskId,
  connected,
  available,
  loading,
  hasUpdates,
  onSelect,
  onCreate,
  onRefresh,
}: {
  tasks: readonly WorkTaskRow[];
  selectedTaskId: string | null;
  focusTaskId?: string | null;
  connected: boolean;
  available: boolean;
  loading?: boolean;
  hasUpdates?: boolean;
  onSelect: (taskId: string) => void;
  onCreate: () => void;
  onRefresh: () => void;
}) {
  const { t } = useLingui();
  return (
    <View testID="work-task-list" style={{ gap: LADDER.gap }}>
      <Text accessibilityRole="header" variant="heading">{t`Tasks`}</Text>
      <Button
        testID="task-create"
        disabled={!connected || !available || loading}
        onPress={onCreate}>{t`New task`}</Button>
      {!available ? (
        <Text
          testID="task-list-unavailable"
          variant="bodySmall">{t`This session cannot manage tasks yet. Update or reconnect its Gateway, then refresh.`}</Text>
      ) : null}
      {!connected ? (
        <Text variant="caption">{t`Offline. Showing previously loaded tasks.`}</Text>
      ) : null}
      <Button
        testID="task-list-refresh"
        variant="ghost"
        disabled={!connected || loading}
        onPress={onRefresh}>
        {hasUpdates ? t`Updates available · refresh` : t`Refresh tasks`}
      </Button>
      {!tasks.length ? (
        <Text testID="task-list-empty" variant="bodySmall">
          {loading
            ? t`Loading tasks…`
            : !available
              ? t`Tasks will appear here when this session supports task management.`
              : t`No tasks loaded. Start with a goal, such as updating a homepage and checking the mobile layout.`}
        </Text>
      ) : null}
      {tasks.map((task) => (
        <WorkTaskSection key={task.id} id={`task:${task.id}`}>
          <TaskRowButton
            identity={task.id}
            focus={focusTaskId === task.id}
            testID={`task-open-${task.id}`}
            accessibilityRole="button"
            accessibilityState={{ selected: task.id === selectedTaskId }}
            onPress={() => onSelect(task.id)}
            style={{ minHeight: 48, paddingVertical: LADDER.snug, gap: LADDER.tight }}>
            <Text variant="bodySmall">
              {task.id === selectedTaskId ? '✓ ' : ''}
              {task.title}
            </Text>
            <Text variant="caption" colorKey="textMuted">
              {task.repo_path}
            </Text>
            {task.paused ? <Text variant="caption">{t`New delegation paused`}</Text> : null}
            <WorkTaskSummaryFacts summary={task.summary} />
          </TaskRowButton>
        </WorkTaskSection>
      ))}
    </View>
  );
}

function TaskRowButton({
  focus,
  identity,
  ...props
}: PressableProps & { focus: boolean; identity: string }) {
  const ref = useWorkTaskFocus(focus, identity);
  return <Pressable {...props} ref={ref} />;
}
