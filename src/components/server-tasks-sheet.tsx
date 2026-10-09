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
import { useMonoFontFamily } from '@/hooks/use-user-fonts';
import { taskKindWord, taskStateWord } from '@/i18n/labels';
import { settleAfter } from '@/lib/compiler-safe-control-flow';
import { summaryTail, taskAgeParts } from '@/lib/server-tasks-state';
import { getTask, isTerminalTaskState, type TaskEvent, type TaskView } from '@/lib/task-ledger';
import { acceptsCancel, acceptsConfirm, unpairView } from '@/lib/unpair-action';

type Item =
  | { type: 'heading'; key: string; title: string; first: boolean }
  | { type: 'task'; key: string; task: TaskView }
  | { type: 'empty'; key: string };

const itemKey = (item: Item) => item.key;
const itemType = (item: Item) => item.type;

/** "5m ago" said whole, so a translator can write their own sentence. */
function useTaskAge() {
  const { t } = useLingui();
  return (updatedMs: number, nowMs: number) => {
    const age = taskAgeParts(updatedMs, nowMs);
    if (age.unit === 'now') return t`just now`;
    if (age.unit === 'minute') return t`${age.value}m ago`;
    if (age.unit === 'hour') return t`${age.value}h ago`;
    return t`${age.value}d ago`;
  };
}

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
  onOpen,
}: {
  task: TaskView;
  nowMs: number;
  onOpen: (taskId: string) => void;
}) {
  const { _ } = useLinguiRuntime();
  const age = useTaskAge();
  const caption = [
    _(taskKindWord[task.kind]),
    _(taskStateWord[task.state]),
    age(task.updatedMs, nowMs),
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <SheetSceneRow
      testID={`server-tasks-row-${task.taskId}`}
      title={task.goal || task.taskId}
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
}

/**
 * The selected server's task ledger: grouped rows, and one task's detail in
 * place of them when a row is pressed.
 */
export function ServerTasksSheet({
  serverLabel,
  state,
}: {
  serverLabel: string;
  state: ServerTasks;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const insets = useSafeAreaInsets();
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
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

  const items: Item[] = [];
  const sections: [string, string, TaskView[]][] = [
    ['attention', t`Needs you`, state.groups.attention],
    ['active', t`In progress`, state.groups.active],
    ['finished', t`Finished`, state.groups.finished],
  ];
  for (const [key, title, tasks] of sections) {
    if (tasks.length === 0) continue;
    items.push({ type: 'heading', key: `heading-${key}`, title, first: items.length === 0 });
    for (const task of tasks) items.push({ type: 'task', key: task.taskId, task });
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
  onBack,
  onCancel,
}: {
  taskId: string;
  /** The task as the list has it, which socket frames keep current. */
  listed: TaskView | undefined;
  nowMs: number;
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
    void getTask(taskId)
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
  }, [taskId, updatedMs]);

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
      {isTerminalTaskState(task.state) ? null : (
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
});
