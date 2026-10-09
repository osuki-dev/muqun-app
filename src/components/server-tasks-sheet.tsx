import { LegendList } from '@legendapp/list/react-native';
import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { LayoutAnimationConfig } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  SheetScene,
  SheetSceneFooter,
  SheetSceneGroupHeading,
  SheetSceneRow,
  sheetSceneStyles,
} from '@/components/sheet-scene';
import { TaskRow } from '@/components/task-row';
import { Text } from '@/components/text';
import type { ServerTasks } from '@/hooks/use-server-tasks';
import { buildTaskTree, groupTaskTree } from '@/lib/home-computer-cards';
import type { TaskView } from '@/lib/task-ledger';
import { useAgents } from '@/stores/agents';

type Item =
  | { type: 'heading'; key: string; title: string; first: boolean }
  | { type: 'task'; key: string; task: TaskView; nested: boolean }
  | { type: 'empty'; key: string };

const itemKey = (item: Item) => item.key;
const itemType = (item: Item) => item.type;

/**
 * A computer's tasks as a plain list: roots grouped by their most urgent
 * work, the work each started indented one level under it, newest first.
 * Socket frames keep it live. Rows are Home's own (`TaskRow`): tap opens the
 * session or pane, long press lists the actions. Not recycled: a row holds
 * its open action menu.
 */
export function ServerTasksSheet({
  serverId,
  serverLabel,
  state,
  rootTaskId,
  onOpen,
}: {
  serverId: string | null;
  serverLabel: string;
  state: ServerTasks;
  /** List only this task and the work it started, when the list holds it. */
  rootTaskId?: string;
  /** Open the session or pane the task runs in. */
  onOpen: (task: TaskView) => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const insets = useSafeAreaInsets();
  const discovery = useAgents((agents) => (serverId ? agents.index.servers[serverId] : undefined));
  // Ages are relative to now: a tick keeps a sheet left open from saying
  // "just now" for a task that changed minutes ago.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const tree = buildTaskTree(state.tasks);
  const rooted = rootTaskId ? tree.filter((row) => row.task.taskId === rootTaskId) : [];
  const shownTree = rooted.length > 0 ? rooted : tree;
  const childrenOf = new Map(shownTree.map((row) => [row.task.taskId, row.children]));
  // A root goes where its most urgent work is: a waiting sub-task puts its
  // root under Needs you, open sub-work keeps a finished root In progress.
  const groups = groupTaskTree(shownTree);
  const items: Item[] = [];
  const sections: [string, string, TaskView[]][] = [
    ['attention', t`Needs you`, groups.attention],
    ['active', t`In progress`, groups.active],
    ['finished', t`Finished`, groups.finished],
  ];
  for (const [key, title, tasks] of sections) {
    if (tasks.length === 0) continue;
    items.push({ type: 'heading', key: `heading-${key}`, title, first: items.length === 0 });
    for (const task of tasks) {
      items.push({ type: 'task', key: task.taskId, task, nested: false });
      for (const child of childrenOf.get(task.taskId) ?? []) {
        items.push({ type: 'task', key: child.taskId, task: child, nested: true });
      }
    }
  }
  const firstLoad = state.loading && state.tasks.length === 0;
  if (items.length === 0 && !firstLoad) items.push({ type: 'empty', key: 'empty' });

  const detailLine = state.error ? (
    <Text variant="caption" color={theme.colors.danger} numberOfLines={2}>
      {t`Could not load tasks`}
    </Text>
  ) : !state.live ? (
    <Text testID="server-tasks-not-live" variant="caption" color={theme.colors.textSubtle}>
      {t`Updates when you reopen`}
    </Text>
  ) : undefined;

  return (
    <SheetScene testID="server-tasks" title={t`Tasks`} caption={serverLabel} detail={detailLine}>
      {firstLoad ? (
        <View style={styles.centre}>
          <ActivityIndicator size="small" color={theme.colors.primary} />
        </View>
      ) : (
        <LegendList
          nestedScrollEnabled
          testID="server-tasks-list"
          data={items}
          keyExtractor={itemKey}
          getItemType={itemType}
          estimatedItemSize={64}
          style={sheetSceneStyles.scroller}
          contentContainerStyle={sheetSceneStyles.scrollerContent}
          renderItem={({ item }) =>
            item.type === 'heading' ? (
              <SheetSceneGroupHeading title={item.title} first={item.first} />
            ) : item.type === 'task' ? (
              // Per row, because the list mounts rows as they scroll into
              // view: one there when the sheet opened, or one scrolled to,
              // does not replay its arrival (fade, pulse, icon). A state
              // change inside a mounted row still animates.
              <LayoutAnimationConfig skipEntering>
                <TaskRow
                  task={item.task}
                  serverId={serverId ?? ''}
                  nested={item.nested}
                  nowMs={nowMs}
                  discovery={discovery}
                  onOpen={onOpen}
                />
              </LayoutAnimationConfig>
            ) : (
              <SheetSceneRow testID="server-tasks-empty" title={t`No tasks yet`} />
            )
          }
          ListFooterComponent={<SheetSceneFooter bottomInset={insets.bottom} />}
        />
      )}
    </SheetScene>
  );
}

const styles = StyleSheet.create({
  centre: { paddingVertical: 40, alignItems: 'center', justifyContent: 'center' },
});
