import { LegendList } from '@legendapp/list/react-native';
import { useLingui as useLinguiRuntime } from '@lingui/react';
import { useLingui } from '@lingui/react/macro';
import { useThemeTokens, useToast } from '@osuki-dev/ui';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  TaskWhereMark,
  useRollupText,
  useTaskRowLine,
  useTaskWhereName,
} from '@/components/home-computer-cards';
import {
  SheetScene,
  SheetSceneFooter,
  SheetSceneGroupHeading,
  SheetSceneQuietAction,
  SheetSceneRow,
  sheetSceneStyles,
} from '@/components/sheet-scene';
import { Text } from '@/components/text';
import type { ServerTasks } from '@/hooks/use-server-tasks';
import { useTaskAge } from '@/hooks/use-task-age';
import { taskStateWord } from '@/i18n/labels';
import type { MirroredServerDiscovery } from '@/lib/agent-discovery';
import {
  buildTaskTree,
  dismissedKey,
  groupTaskTree,
  taskRowDestination,
  taskTitle,
} from '@/lib/home-computer-cards';
import { canMarkTaskDone, isTerminalTaskState, type TaskView } from '@/lib/task-ledger';
import { useAgents } from '@/stores/agents';
import { useHomeTaskCards } from '@/stores/home-task-cards';
import { useServerCapabilities } from '@/stores/server-capabilities';

type Item =
  | { type: 'heading'; key: string; title: string; first: boolean }
  | { type: 'task'; key: string; task: TaskView; nested: boolean }
  | { type: 'empty'; key: string };

const itemKey = (item: Item) => item.key;
const itemType = (item: Item) => item.type;

/**
 * One task: where it runs, its goal, its state and age, and for a finished
 * one the line it left. Tapping opens the session or pane it runs in. The one
 * quiet action is what the reader can say about it: Acknowledge a finished
 * task (it leaves Home's card), Mark done a paused one.
 *
 * Stateless apart from the stores, so a recycled cell is correct for
 * whichever task it is handed.
 */
function ServerTaskRow({
  task,
  serverId,
  nested,
  nowMs,
  discovery,
  capabilities,
  onOpen,
  onComplete,
}: {
  task: TaskView;
  serverId: string | null;
  nested: boolean;
  nowMs: number;
  discovery: MirroredServerDiscovery | undefined;
  capabilities: readonly string[] | undefined;
  onOpen: (task: TaskView) => void;
  onComplete: (task: TaskView) => void;
}) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const age = useTaskAge();
  const whereName = useTaskWhereName(discovery);
  const rollupText = useRollupText();
  const rowLine = useTaskRowLine(discovery);
  const acknowledged = useHomeTaskCards((cards) =>
    serverId ? cards.dismissed.includes(dismissedKey(serverId, task.taskId)) : true
  );
  const acknowledge = useHomeTaskCards((cards) => cards.acknowledge);
  const finished = isTerminalTaskState(task.state);
  // Where it runs and when it last moved, then what became of it -- the same
  // line Home's card says.
  const firstLine = [whereName(task), age(task.updatedMs, nowMs), rollupText(task)]
    .filter(Boolean)
    .join(' · ');
  const caption = `${firstLine}\n${rowLine(task, nowMs).text}`;
  const opens = taskRowDestination(task) !== null;
  const action = canMarkTaskDone(task, capabilities) ? (
    <SheetSceneQuietAction
      testID={`server-tasks-mark-done-${task.taskId}`}
      label={t`Mark done`}
      onPress={() => onComplete(task)}
    />
  ) : finished && !acknowledged && serverId ? (
    <SheetSceneQuietAction
      testID={`server-tasks-acknowledge-${task.taskId}`}
      label={t`Acknowledge`}
      onPress={() => acknowledge(serverId, task.taskId)}
    />
  ) : undefined;
  const row = (
    <SheetSceneRow
      testID={`server-tasks-row-${task.taskId}`}
      title={taskTitle(task)}
      caption={caption}
      accessibilityValue={{ text: `${_(taskStateWord[task.state])}, ${caption}` }}
      busy={task.state === 'working' || task.state === 'dispatching'}
      onPress={opens ? () => onOpen(task) : undefined}
      leading={<TaskWhereMark task={task} discovery={discovery} size={16} />}
      meta={action}
    />
  );
  return nested ? <View style={styles.nested}>{row}</View> : row;
}

/**
 * A computer's tasks as a plain list: roots grouped by their most urgent
 * work, the work each started indented one level under it, newest first.
 * Socket frames keep it live.
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
  const { showToast } = useToast();
  const discovery = useAgents((agents) => (serverId ? agents.index.servers[serverId] : undefined));
  const capabilities = useServerCapabilities((caps) =>
    serverId ? caps.byServer[serverId] : undefined
  );
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

  const complete = (task: TaskView) => {
    void state.complete(task).catch((failure: unknown) => {
      showToast({
        variant: 'danger',
        title: t`Could not mark the task done`,
        message: failure instanceof Error ? failure.message : String(failure),
      });
    });
  };

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
          recycleItems
          estimatedItemSize={64}
          style={sheetSceneStyles.scroller}
          contentContainerStyle={sheetSceneStyles.scrollerContent}
          renderItem={({ item }) =>
            item.type === 'heading' ? (
              <SheetSceneGroupHeading title={item.title} first={item.first} />
            ) : item.type === 'task' ? (
              <ServerTaskRow
                task={item.task}
                serverId={serverId}
                nested={item.nested}
                nowMs={nowMs}
                discovery={discovery}
                capabilities={capabilities}
                onOpen={onOpen}
                onComplete={complete}
              />
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
  nested: { paddingLeft: 24 },
});
