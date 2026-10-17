import { useLingui } from '@lingui/react/macro';
import { useLingui as useLinguiRuntime } from '@lingui/react';
import { useThemeTokens, Text } from '@osuki-dev/ui';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BoundedMarkdown } from '@/components/bounded-markdown';
import {
  SheetScene,
  SheetSceneFooter,
  SheetSceneGroupHeading,
  SheetSceneQuietAction,
  sheetSceneStyles,
} from '@/components/sheet-scene';
import { useCompactMarkdownStyle } from '@/hooks/use-markdown-style';
import { resolveTask } from '@/hooks/use-server-tasks';
import { useMonoFontFamily } from '@/hooks/use-user-fonts';
import { taskStateWord } from '@/i18n/labels';
import { taskRowDestination, taskRowTitle } from '@/lib/home-computer-cards';
import type { TaskView } from '@/lib/task-ledger';

/** A saved command result, inside the existing task-history sheet. */
export function TaskResultSheet({
  serverId,
  taskId,
  initialTask,
  onBack,
  onOpenParent,
}: {
  serverId: string;
  taskId: string;
  initialTask?: TaskView;
  onBack: () => void;
  onOpenParent: (task: TaskView) => void;
}) {
  const { t } = useLingui();
  const { i18n } = useLinguiRuntime();
  const theme = useThemeTokens();
  const insets = useSafeAreaInsets();
  const markdownStyle = useCompactMarkdownStyle('body');
  const mono = useMonoFontFamily();
  // Freeze the opened result. Later ledger refreshes must not replace output
  // while it is being read, or remove a cached result absent from a list page.
  const [task, setTask] = useState(initialTask ?? null);
  const [loading, setLoading] = useState(!initialTask);
  const [parent, setParent] = useState<TaskView | null>(null);

  useEffect(() => {
    if (task) return;
    let current = true;
    void resolveTask(serverId, taskId)
      .catch(() => null)
      .then((answer) => {
        if (!current) return;
        setTask(answer);
        setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [serverId, taskId, task]);

  useEffect(() => {
    if (!task?.parentTaskId) return;
    let current = true;
    // Resolve the source conversation locally, never the command's peer pane.
    void resolveTask(serverId, task.parentTaskId)
      .catch(() => null)
      .then((answer) => {
        if (current) setParent(answer);
      });
    return () => {
      current = false;
    };
  }, [serverId, task]);

  const result = task && taskRowDestination(task).kind === 'result' ? task : null;
  const conversation =
    parent?.kind === 'delegation' && parent.binding.kind === 'agent_session' ? parent : null;
  const code = result?.exitCode;
  return (
    <SheetScene
      testID="task-result"
      title={t`Output`}
      caption={result ? taskRowTitle(result) : undefined}
      detail={
        result ? <Text variant="caption">{i18n._(taskStateWord[result.state])}</Text> : undefined
      }>
      <ScrollView
        nestedScrollEnabled
        style={sheetSceneStyles.scroller}
        contentContainerStyle={sheetSceneStyles.scrollerContent}>
        <SheetSceneQuietAction testID="task-result-tasks" label={t`Tasks`} onPress={onBack} />
        {loading ? (
          <ActivityIndicator size="small" color={theme.colors.primary} />
        ) : result ? (
          <>
            <SheetSceneGroupHeading title={t`Command`} />
            <BoundedMarkdown markdown={result.goal} markdownStyle={markdownStyle} />
            <SheetSceneGroupHeading title={t`Output`} />
            <Text
              testID="task-result-output"
              selectable
              style={[styles.output, { fontFamily: mono }]}>
              {result.summary || t`No output`}
            </Text>
            {code !== undefined ? (
              <Text testID="task-result-exit-code" variant="caption">
                {t`exit ${code}`}
              </Text>
            ) : null}
            {conversation ? (
              <SheetSceneQuietAction
                testID="task-result-conversation"
                label={t`Open parent`}
                onPress={() => onOpenParent(conversation)}
              />
            ) : null}
          </>
        ) : (
          <Text testID="task-result-unavailable" variant="bodySmall">{t`Unavailable`}</Text>
        )}
        <SheetSceneFooter bottomInset={insets.bottom} />
      </ScrollView>
    </SheetScene>
  );
}

const styles = StyleSheet.create({
  output: { fontSize: 14, lineHeight: 21, marginBottom: 14 },
});
