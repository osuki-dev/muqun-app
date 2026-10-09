import { LegendList } from '@legendapp/list/react-native';
import { useLingui as useLinguiRuntime } from '@lingui/react';
import { useLingui } from '@lingui/react/macro';
import { useThemeTokens, useToast } from '@osuki-dev/ui';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import {
  SheetScene,
  SheetSceneAction,
  SheetSceneFooter,
  SheetSceneGroupHeading,
  SheetSceneQuietAction,
  SheetSceneRow,
  SHEET_LADDER,
  sheetSceneStyles,
} from '@/components/sheet-scene';
import { TaskStatusGlyph } from '@/components/task-status-glyph';
import { Text } from '@/components/text';
import type { ServerTasks } from '@/hooks/use-server-tasks';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { useTaskAge } from '@/hooks/use-task-age';
import { useMonoFontFamily } from '@/hooks/use-user-fonts';
import { taskKindWord, taskStateWord } from '@/i18n/labels';
import { settleAfter } from '@/lib/compiler-safe-control-flow';
import { taskRouteFor } from '@/hooks/use-server-tasks';
import { useRollupText } from '@/components/home-computer-cards';
import {
  buildTaskTree,
  dismissedKey,
  groupTaskTree,
  taskResultLine,
  taskTitle,
} from '@/lib/home-computer-cards';
import { summaryTail } from '@/lib/server-tasks-state';
import { useHomeTaskCards } from '@/stores/home-task-cards';
import { getTask, isTerminalTaskState, type TaskEvent, type TaskView } from '@/lib/task-ledger';
import { acceptsCancel, acceptsConfirm, unpairView } from '@/lib/unpair-action';

type Item =
  | { type: 'heading'; key: string; title: string; first: boolean }
  | { type: 'task'; key: string; task: TaskView }
  /** Work a task started, one level under it. */
  | { type: 'child'; key: string; task: TaskView }
  | { type: 'empty'; key: string };

const itemKey = (item: Item) => item.key;
const itemType = (item: Item) => item.type;

/** Exit code as a chip: quiet when zero, in the danger tone otherwise. */
function ExitChip({ code }: { code: number }) {
  const { t } = useLingui();
  const { colors } = useThemeTokens();
  const profile = useAppearanceProfile();
  const surfaceBackground = useSurfaceBackground();
  const failed = code !== 0;
  return (
    <View
      style={[
        styles.chip,
        {
          borderRadius: profile.chrome.control,
          backgroundColor: surfaceBackground(failed ? colors.dangerSubtle : colors.surfaceRaised),
        },
      ]}>
      <Text variant="caption" weight="semibold" color={failed ? colors.danger : colors.textMuted}>
        {t`exit ${code}`}
      </Text>
    </View>
  );
}

/** Stateless, so a recycled cell is correct for whichever task it is handed. */
function ServerTaskRow({
  task,
  nowMs,
  nested = false,
  onOpen,
}: {
  task: TaskView;
  nowMs: number;
  nested?: boolean;
  onOpen: (taskId: string) => void;
}) {
  const { _ } = useLinguiRuntime();
  const age = useTaskAge();
  const rollupText = useRollupText();
  const caption = [
    _(taskKindWord[task.kind]),
    _(taskStateWord[task.state]),
    age(task.updatedMs, nowMs),
    rollupText(task),
  ]
    .filter(Boolean)
    .join(' · ');
  const row = (
    <SheetSceneRow
      testID={`server-tasks-row-${task.taskId}`}
      title={taskTitle(task)}
      caption={caption}
      accessibilityValue={{ text: caption }}
      busy={task.state === 'working' || task.state === 'dispatching'}
      onPress={() => onOpen(task.taskId)}
      leading={
        <View collapsable={false} testID={`server-tasks-glyph-${task.taskId}-${task.state}`}>
          <TaskStatusGlyph state={task.state} />
        </View>
      }
      meta={
        task.kind === 'command' && task.exitCode !== undefined ? (
          <ExitChip code={task.exitCode} />
        ) : undefined
      }
    />
  );
  return nested ? <View style={styles.nested}>{row}</View> : row;
}

/**
 * The selected server's task ledger: grouped rows, and one task's detail in
 * place of them when a row is pressed.
 */
export function ServerTasksSheet({
  serverId,
  serverLabel,
  state,
  initialTaskId,
  rootTaskId,
}: {
  serverId: string | null;
  serverLabel: string;
  state: ServerTasks;
  /** Open on this task's detail; back still leads to the whole list. */
  initialTaskId?: string;
  /** List only this task and the work it started. */
  rootTaskId?: string;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const insets = useSafeAreaInsets();
  const [openTaskId, setOpenTaskId] = useState<string | null>(initialTaskId ?? null);
  // Ages are relative to now: a tick keeps a sheet left open from saying
  // "just now" for a task that changed minutes ago.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  // Hardware back from a task's detail returns to the list, not out of the sheet.
  const detailOpen = openTaskId !== null;
  useEffect(() => {
    if (!detailOpen) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setOpenTaskId(null);
      return true;
    });
    return () => subscription.remove();
  }, [detailOpen]);

  // Roots grouped by their own state, each with the work it started nested
  // one level under it, newest first.
  const tree = buildTaskTree(state.tasks);
  const shownTree = rootTaskId ? tree.filter((row) => row.task.taskId === rootTaskId) : tree;
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
      items.push({ type: 'task', key: task.taskId, task });
      for (const child of childrenOf.get(task.taskId) ?? []) {
        items.push({ type: 'child', key: child.taskId, task: child });
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

  const listedTask = openTaskId
    ? state.tasks.find((task) => task.taskId === openTaskId)
    : undefined;

  return (
    <SheetScene
      testID="server-tasks"
      title={t`Tasks`}
      caption={serverLabel}
      detail={detailLine}
      headingTrailing={
        <SheetSceneQuietAction
          testID="server-tasks-refresh"
          label={t`Refresh`}
          disabled={state.loading}
          onPress={() => void state.refresh()}
        />
      }>
      {openTaskId ? (
        <ServerTaskDetail
          taskId={openTaskId}
          listed={listedTask}
          nowMs={nowMs}
          serverId={serverId}
          onBack={() => setOpenTaskId(null)}
          onCancel={state.cancel}
        />
      ) : firstLoad ? (
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
              <ServerTaskRow task={item.task} nowMs={nowMs} onOpen={setOpenTaskId} />
            ) : item.type === 'child' ? (
              <ServerTaskRow task={item.task} nowMs={nowMs} nested onOpen={setOpenTaskId} />
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

function ServerTaskDetail({
  taskId,
  listed,
  nowMs,
  serverId,
  onBack,
  onCancel,
}: {
  taskId: string;
  /** The task as the list has it, which socket frames keep current. */
  listed: TaskView | undefined;
  nowMs: number;
  serverId: string | null;
  onBack: () => void;
  onCancel: (taskId: string) => Promise<void>;
}) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();
  const surfaceBackground = useSurfaceBackground();
  const insets = useSafeAreaInsets();
  const mono = useMonoFontFamily();
  const age = useTaskAge();
  const [detail, setDetail] = useState<{ task: TaskView; events: TaskEvent[] } | null>(null);
  // The first answer has come back, whatever it was: past this a task the list
  // no longer has and the gateway does not know settles instead of spinning.
  const [answered, setAnswered] = useState(false);
  const updatedMs = listed?.updatedMs;

  // Again whenever the task changes, so the history includes the change.
  useEffect(() => {
    let active = true;
    const route = serverId ? taskRouteFor(serverId) : null;
    void getTask(taskId, route?.kind === 'endpoint' ? route.endpoint : undefined)
      .then((answer) => {
        if (!active) return;
        setDetail(answer);
        setAnswered(true);
      })
      .catch(() => {
        if (active) setAnswered(true);
      });
    return () => {
      active = false;
    };
  }, [taskId, updatedMs, serverId]);
  const acknowledged = useHomeTaskCards((cards) =>
    serverId ? cards.dismissed.includes(dismissedKey(serverId, taskId)) : true
  );
  const acknowledge = useHomeTaskCards((cards) => cards.acknowledge);

  const task = listed ?? detail?.task;
  if (!task) {
    return (
      <View style={styles.centre}>
        {answered ? (
          <Text
            testID="server-tasks-detail-unavailable"
            variant="caption"
            color={theme.colors.textSubtle}>
            {t`Unavailable`}
          </Text>
        ) : (
          <ActivityIndicator size="small" color={theme.colors.primary} />
        )}
      </View>
    );
  }

  const binding =
    task.binding.kind === 'pane'
      ? t`Pane ${task.binding.paneId} in session ${task.binding.sessionId}`
      : task.binding.kind === 'agent_session'
        ? t`Agent ${task.binding.agentId}, session ${task.binding.asid}`
        : null;
  const events = [...(detail?.events ?? [])].sort((a, b) => b.seq - a.seq);
  const result = taskResultLine(task);

  return (
    <ScrollView
      testID="server-tasks-detail"
      nestedScrollEnabled
      style={sheetSceneStyles.scroller}
      contentContainerStyle={[sheetSceneStyles.scrollerContent, styles.detail]}
      showsVerticalScrollIndicator={false}>
      <View style={styles.stateLine}>
        <View collapsable={false} testID={`server-tasks-detail-state-${task.state}`}>
          <TaskStatusGlyph state={task.state} />
        </View>
        <Text variant="caption" weight="semibold" color={theme.colors.textMuted}>
          {[
            _(taskStateWord[task.state]),
            _(taskKindWord[task.kind]),
            age(task.updatedMs, nowMs),
          ].join(' · ')}
        </Text>
      </View>
      <Text selectable variant="body">
        {task.goal || task.taskId}
      </Text>
      {result && isTerminalTaskState(task.state) ? (
        <Text
          testID="server-tasks-result"
          selectable
          variant="bodySmall"
          color={task.state === 'failed' ? theme.colors.danger : theme.colors.textMuted}>
          {result.kind === 'summary' ? result.text : t`Exit code ${result.code}`}
        </Text>
      ) : null}
      {binding ? (
        <Text selectable variant="caption" color={theme.colors.textSubtle} numberOfLines={2}>
          {binding}
        </Text>
      ) : null}
      {task.kind === 'command' && task.exitCode !== undefined ? (
        <Text
          variant="caption"
          color={task.exitCode === 0 ? theme.colors.textMuted : theme.colors.danger}>
          {t`Exit code ${task.exitCode}`}
        </Text>
      ) : null}
      {task.summary ? (
        <View
          testID="server-tasks-summary"
          style={[
            styles.output,
            {
              borderRadius: profile.chrome.surface,
              backgroundColor: surfaceBackground(theme.colors.surface),
            },
          ]}>
          <Text
            selectable
            style={[styles.outputText, { color: theme.colors.text, fontFamily: mono }]}>
            {summaryTail(task.summary)}
          </Text>
        </View>
      ) : null}
      {isTerminalTaskState(task.state) ? (
        !acknowledged && serverId ? (
          <SheetSceneQuietAction
            testID="server-tasks-acknowledge"
            label={t`Acknowledge`}
            onPress={() => {
              acknowledge(serverId, task.taskId);
              onBack();
            }}
          />
        ) : null
      ) : (
        <CancelTaskAction key={task.taskId} onConfirm={() => onCancel(task.taskId)} />
      )}
      {events.length > 0 ? (
        <View>
          <SheetSceneGroupHeading title={t`History`} />
          {events.map((event) => (
            <SheetSceneRow
              key={event.seq}
              title={_(taskStateWord[event.to])}
              caption={[event.source, age(event.atMs, nowMs), event.note ?? '']
                .filter(Boolean)
                .join(' · ')}
              leading={<TaskStatusGlyph state={event.to} size={14} />}
            />
          ))}
        </View>
      ) : null}
      <SheetSceneQuietAction testID="server-tasks-back" label={t`All tasks`} onPress={onBack} />
      <SheetSceneFooter bottomInset={insets.bottom} />
    </ScrollView>
  );
}

/**
 * Two taps, like unpairing: the first arms, the second asks the gateway. The
 * answer may be a task that finished first, which the sheet then shows as it is.
 */
function CancelTaskAction({ onConfirm }: { onConfirm: () => Promise<void> }) {
  const { t } = useLingui();
  const { showToast } = useToast();
  const [armed, setArmed] = useState(false);
  const [pending, setPending] = useState(false);
  // The action unmounts once the task goes terminal; settling then is a no-op to avoid.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const view = unpairView({ armed, pending });

  async function confirm() {
    if (!acceptsConfirm({ armed, pending })) return;
    setPending(true);
    return settleAfter(
      async () => {
        try {
          await onConfirm();
        } catch (failure) {
          showToast({
            variant: 'danger',
            title: t`Could not cancel the task`,
            message: failure instanceof Error ? failure.message : String(failure),
          });
        }
      },
      () => {
        if (!mounted.current) return;
        setPending(false);
        setArmed(false);
      }
    );
  }

  return view.showArmedPair ? (
    <View style={styles.actions}>
      <SheetSceneAction
        testID="server-tasks-cancel"
        label={view.confirm.phase === 'working' ? t`Cancelling…` : t`Confirm cancel`}
        busy={view.confirm.busy}
        disabled={view.confirm.disabled}
        onPress={() => void confirm()}
      />
      <SheetSceneQuietAction
        testID="server-tasks-cancel-keep"
        label={t`Keep it running`}
        disabled={view.cancel.disabled}
        onPress={() => {
          if (acceptsCancel({ armed, pending })) setArmed(false);
        }}
      />
    </View>
  ) : (
    <View style={styles.actions}>
      <SheetSceneAction
        testID="server-tasks-cancel"
        label={t`Cancel task`}
        onPress={() => setArmed(true)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  centre: { paddingVertical: 40, alignItems: 'center', justifyContent: 'center' },
  chip: { paddingHorizontal: 8, paddingVertical: 2 },
  detail: { gap: SHEET_LADDER.gap },
  stateLine: { flexDirection: 'row', alignItems: 'center', gap: SHEET_LADDER.snug },
  output: { padding: 12 },
  outputText: { fontSize: 12, lineHeight: 17 },
  actions: { gap: SHEET_LADDER.tight, marginTop: SHEET_LADDER.tight },
  nested: { paddingLeft: 24 },
});
