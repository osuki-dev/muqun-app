import { useLingui as useLinguiRuntime } from '@lingui/react';
import { plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { useIsFocused } from 'expo-router';
import { useThemeTokens, useToast } from '@osuki-dev/ui';
import { ChevronRight, Server, SquareTerminal } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';

import { AgentMark } from '@/components/agent-mark';
import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { PressableScale } from '@/components/pressable-scale';
import { SheetSceneQuietAction } from '@/components/sheet-scene';
import { StatusDot } from '@/components/status-dot';
import { TaskStatusGlyph } from '@/components/task-status-glyph';
import { Text } from '@/components/text';
import { ThemeIcon } from '@/components/theme-icon';
import { useMarkTaskDone, useServerTasks } from '@/hooks/use-server-tasks';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { useTaskAge } from '@/hooks/use-task-age';
import { connectionStatusDescription, connectionStatusLabel, taskStateWord } from '@/i18n/labels';
import { findAgent, type MirroredServerDiscovery } from '@/lib/agent-discovery';
import type { GatewayRecord } from '@/lib/gateway-storage';
import { agentBrandName } from '@/lib/herdr-entity';
import {
  buildComputerCards,
  taskRollup,
  taskRowLine,
  taskTitle,
  type ComputerCard,
  type PendingDispatch,
} from '@/lib/home-computer-cards';
import {
  resolveConnectionStatus,
  type ActiveServerConnection,
  type ConnectionStatus,
} from '@/lib/server-reachability';
import { canMarkTaskDone, type TaskView } from '@/lib/task-ledger';
import { useAgents } from '@/stores/agents';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import { PENDING_DISPATCH_TTL_MS, useHomeTaskCards } from '@/stores/home-task-cards';
import { useServerCapabilities } from '@/stores/server-capabilities';
import { useServerChannels } from '@/stores/server-channels';
import { useServerReachability } from '@/stores/server-reachability';
import { useServerTasksStore } from '@/stores/server-tasks';

/**
 * Keeps the ledgers of these computers live while Home is up: a list read on
 * mount and on return to the foreground, and a task-only socket per computer
 * (`useServerTasks`). Unmounting releases each socket; it lingers briefly and
 * closes. Draws nothing.
 */
export function HomeTaskSync({ serverIds }: { serverIds: readonly string[] }) {
  return (
    <>
      {serverIds.map((serverId) => (
        <ServerTaskSync key={serverId} serverId={serverId} />
      ))}
    </>
  );
}

function ServerTaskSync({ serverId }: { serverId: string }) {
  useServerTasks(serverId);
  return null;
}

/** A root's roll-up, `2 sub-tasks (1 waiting)`, said with each locale's plurals. */
export function useRollupText() {
  const { t } = useLingui();
  return (task: TaskView): string => {
    const rollup = taskRollup(task);
    if (!rollup) return '';
    const total = rollup.total;
    const waiting = rollup.waiting;
    return waiting > 0
      ? t`${plural(total, { one: '# sub-task', other: '# sub-tasks' })} (${plural(waiting, { one: '# waiting', other: '# waiting' })})`
      : t`${plural(total, { one: '# sub-task', other: '# sub-tasks' })}`;
  };
}

/** `tree`: the reader asked for the work under it (the sub-task count), not the task's own session or pane. */
export type CardTaskTarget = { serverId: string; task: TaskView; tree?: boolean };

export type HomeComputerCardsModel = {
  cards: ComputerCard[];
  statusOf: (serverId: string) => ConnectionStatus;
  tickMs: number;
};

/**
 * The cards Home shows: only computers with work -- something open, or a
 * finished task not yet acknowledged from the last half hour. Home leaves
 * the whole section out when there are none.
 */
export function useHomeComputerCards({
  servers,
  activeConnection,
  nowMs,
}: {
  servers: readonly GatewayRecord[];
  activeConnection?: ActiveServerConnection;
  /** The focus tick Home resolves probe freshness against. */
  nowMs?: number;
}): HomeComputerCardsModel {
  const serverIds = servers.map((server) => server.serverId);
  const entries = useServerTasksStore(
    useShallow((state) => serverIds.map((serverId) => state.index[serverId]))
  );
  const probes = useServerReachability((state) => state.probes);
  const sockets = useServerChannels((state) => state.sockets);
  const streams = useServerChannels((state) => state.streams);
  const selectedId = useGatewayConnectionStore((state) => state.record?.serverId);
  const dismissedList = useHomeTaskCards((state) => state.dismissed);
  const pendingAll = useHomeTaskCards((state) => state.pending);
  // Ages are relative to now; a tick keeps "just now" from going stale. Only
  // while Home is on screen: under a pushed screen nobody reads the ages.
  const focused = useIsFocused();
  const [tickMs, setTickMs] = useState(() => Date.now());
  useEffect(() => {
    if (!focused) return;
    setTickMs(Date.now());
    const timer = setInterval(() => setTickMs(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [focused]);
  // A Sent row no task ever answered stops claiming the computer is busy.
  const pending = pendingAll.filter((item) => tickMs - item.atMs < PENDING_DISPATCH_TTL_MS);
  const statusOf = (serverId: string): ConnectionStatus =>
    resolveConnectionStatus({
      serverId,
      probe: probes[serverId],
      activeConnection,
      channels: { socket: sockets[serverId], stream: streams[serverId] },
      selected: serverId === selectedId,
      nowMs: nowMs ?? tickMs,
    });
  const index: Record<string, NonNullable<(typeof entries)[number]>> = {};
  serverIds.forEach((serverId, position) => {
    const entry = entries[position];
    if (entry) index[serverId] = entry;
  });
  const cards = buildComputerCards({
    servers,
    index,
    reachability: (serverId) => {
      const status = statusOf(serverId);
      return status === 'live' ? 'live' : status === 'offline' ? 'offline' : 'unknown';
    },
    dismissed: new Set(dismissedList),
    pending,
    nowMs: tickMs,
  });
  return { cards, statusOf, tickMs };
}

/**
 * The cards: what each computer with work is doing now, what it just
 * finished, and whether it needs the reader. Sorted needs-you → working →
 * paused → idle. The header picks the computer as the dock's target (long
 * press opens it); a task row opens where its work is (long press: its
 * detail); the footer opens the computer's whole task list.
 */
export function HomeComputerCards({
  model,
  servers,
  onSelectServer,
  onOpenServer,
  onOpenTask,
  onOpenTasks,
}: {
  model: HomeComputerCardsModel;
  servers: readonly GatewayRecord[];
  onSelectServer: (serverId: string) => void;
  onOpenServer: (serverId: string) => void;
  onOpenTask: (target: CardTaskTarget) => void;
  /** The computer's whole task list. */
  onOpenTasks: (serverId: string) => void;
}) {
  const { cards, statusOf, tickMs } = model;
  if (cards.length === 0) return null;
  return (
    <View testID="home-computer-cards" style={styles.cards}>
      {cards.map((card) => {
        const server = servers.find((item) => item.serverId === card.serverId);
        if (!server) return null;
        return (
          <ComputerCardView
            key={card.serverId}
            card={card}
            server={server}
            status={statusOf(card.serverId)}
            nowMs={tickMs}
            onSelect={() => onSelectServer(card.serverId)}
            onOpen={() => onOpenServer(card.serverId)}
            onOpenTask={(task, tree) =>
              onOpenTask({ serverId: card.serverId, task, ...(tree ? { tree } : {}) })
            }
            onOpenTasks={() => onOpenTasks(card.serverId)}
          />
        );
      })}
    </View>
  );
}

function ComputerCardView({
  card,
  server,
  status,
  nowMs,
  onSelect,
  onOpen,
  onOpenTask,
  onOpenTasks,
}: {
  card: ComputerCard;
  server: GatewayRecord;
  status: ConnectionStatus;
  nowMs: number;
  onSelect: () => void;
  onOpen: () => void;
  onOpenTask: (task: TaskView, tree?: boolean) => void;
  onOpenTasks: () => void;
}) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();
  const background = useSurfaceBackground();
  const discovery = useAgents((state) => state.index.servers[server.serverId]);
  const statusWord = _(connectionStatusLabel[status]);
  const statusColor =
    status === 'live'
      ? theme.colors.success
      : status === 'unauthorized'
        ? theme.colors.warning
        : theme.colors.textSubtle;
  const idle = card.now.length === 0 && card.pending.length === 0;
  const label = server.label;
  // The footer is the way into this computer's whole task list.
  const footer = t`All tasks`;
  return (
    <View
      testID={`home-card-${server.serverId}`}
      style={[
        styles.card,
        {
          backgroundColor: background(theme.colors.surface),
          borderColor: theme.colors.border,
          borderRadius: profile.chrome.surface,
        },
        card.activity === 'needs-you'
          ? { borderLeftColor: theme.colors.warning, borderLeftWidth: 4 }
          : null,
      ]}>
      <PressableScale
        testID={`home-card-header-${server.serverId}`}
        accessibilityRole="button"
        accessibilityLabel={`${server.label}, ${_(connectionStatusDescription[status])}`}
        accessibilityHint={t`Sends your next goal here. Long press to open it.`}
        accessibilityActions={[{ name: 'longpress', label: t`Open` }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'longpress') onOpen();
        }}
        onPress={onSelect}
        onLongPress={onOpen}
        style={styles.header}>
        <Server size={18} color={theme.colors.primary} />
        <View style={styles.headerCopy}>
          <Text variant="bodySmall" weight="semibold" numberOfLines={1}>
            {server.label}
          </Text>
          <View style={styles.statusLine}>
            <StatusDot
              color={statusColor}
              filled={status !== 'unknown' && status !== 'reconnecting'}
              // No ripple: up to four cards rippling forever keeps Home's UI
              // thread from ever going idle (uiautomator could not dump it)
              // and costs battery on the screen people leave open.
              pulse={false}
            />
            <Text variant="caption" color={statusColor} numberOfLines={1}>
              {statusWord}
            </Text>
          </View>
        </View>
      </PressableScale>

      {idle ? null : (
        <View style={styles.block}>
          <Text variant="caption" weight="semibold" color={theme.colors.textSubtle}>
            {t`Now`}
          </Text>
          {card.pending.map((item) => (
            <PendingRow key={item.id} item={item} computer={server.label} />
          ))}
          {card.now.map((row) => (
            <TaskRow
              key={row.task.taskId}
              task={row.task}
              subTasks={row.children}
              serverId={server.serverId}
              discovery={discovery}
              nowMs={nowMs}
              onOpen={(task) => onOpenTask(task)}
              onOpenTree={(task) => onOpenTask(task, true)}
            />
          ))}
          {card.nowTotal > card.now.length ? (
            <Text variant="caption" color={theme.colors.textMuted}>
              {t`+${card.nowTotal - card.now.length} more`}
            </Text>
          ) : null}
        </View>
      )}

      {card.finished.length > 0 ? (
        <View style={styles.block}>
          <Text variant="caption" weight="semibold" color={theme.colors.textSubtle}>
            {t`Just finished`}
          </Text>
          {card.finished.map((task) => (
            <TaskRow
              key={task.taskId}
              task={task}
              serverId={server.serverId}
              discovery={discovery}
              nowMs={nowMs}
              onOpen={(finished) => onOpenTask(finished)}
              onOpenTree={(finished) => onOpenTask(finished, true)}
            />
          ))}
        </View>
      ) : null}

      <PressableScale
        testID={`home-card-footer-${server.serverId}`}
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${footer}`}
        onPress={onOpenTasks}
        style={[styles.footer, { borderTopColor: theme.colors.border }]}>
        <Text
          variant="caption"
          color={theme.colors.textMuted}
          numberOfLines={1}
          style={styles.grow}>
          {footer}
        </Text>
        <ThemeIcon
          name="home.arrow"
          fallback={ChevronRight}
          size={14}
          color={theme.colors.primary}
        />
      </PressableScale>
    </View>
  );
}

/** A goal the dock sent, before the computer has said it has it. */
function PendingRow({ item, computer }: { item: PendingDispatch; computer: string }) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  return (
    <View testID="home-card-pending" accessibilityLiveRegion="polite" style={styles.taskRow}>
      <View style={styles.row}>
        <View style={styles.mark}>
          <TaskStatusGlyph state="dispatching" size={14} />
        </View>
        <Text variant="bodySmall" weight="semibold" numberOfLines={2} style={styles.grow}>
          {item.goal.split('\n')[0]}
        </Text>
      </View>
      <Text
        variant="caption"
        color={theme.colors.textMuted}
        numberOfLines={1}
        style={styles.result}>
        {t`Sent · waiting for ${computer}`}
      </Text>
    </View>
  );
}

/**
 * Where a task runs, as the Recent rows say it: a session's agent by its own
 * mark, a pane by the terminal glyph. Shared with the Tasks sheet.
 */
export function TaskWhereMark({
  task,
  discovery,
  size = 14,
}: {
  task: TaskView;
  discovery: MirroredServerDiscovery | undefined;
  size?: number;
}) {
  const theme = useThemeTokens();
  const binding = task.binding;
  if (binding.kind === 'agent_session') {
    const kind = findAgent(discovery?.agents?.agents, binding.agentId)?.kind ?? binding.agentId;
    return <AgentMark kind={kind} size={size} color={theme.colors.primary} />;
  }
  if (binding.kind === 'pane') {
    return <SquareTerminal size={size} color={theme.colors.textMuted} strokeWidth={2} />;
  }
  return <TaskStatusGlyph state={task.state} size={size} />;
}

/** The name beside the mark: the session's agent, the terminal agent, or `Terminal`. */
export function useTaskWhereName(discovery: MirroredServerDiscovery | undefined) {
  const { t } = useLingui();
  return (task: TaskView): string => {
    const binding = task.binding;
    if (binding.kind === 'agent_session') {
      return (
        findAgent(discovery?.agents?.agents, binding.agentId)?.name ??
        agentBrandName(binding.agentId)
      );
    }
    if (binding.kind === 'pane') {
      return binding.agentId ? agentBrandName(binding.agentId) : t`Terminal`;
    }
    return '';
  };
}

/**
 * A task row's second line, in words and a tone from the theme: what the
 * computer is doing with the goal now (`taskRowLine`). Shared with the Tasks
 * sheet.
 */
export function useTaskRowLine(discovery: MirroredServerDiscovery | undefined) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const theme = useThemeTokens();
  const age = useTaskAge();
  const whereName = useTaskWhereName(discovery);
  return (task: TaskView, nowMs: number): { text: string; color: string } => {
    const line = taskRowLine(task);
    const agent = whereName(task);
    const muted = theme.colors.textMuted;
    switch (line.kind) {
      case 'starting':
        return { text: agent ? t`Starting ${agent}…` : _(taskStateWord.dispatching), color: muted };
      case 'progress':
        return { text: line.text, color: muted };
      case 'elapsed':
        return {
          text: [agent, _(taskStateWord.working), age(task.updatedMs, nowMs)]
            .filter(Boolean)
            .join(' · '),
          color: muted,
        };
      case 'waiting':
        return {
          text: [_(taskStateWord.waiting), line.text].filter(Boolean).join(' · '),
          color: theme.colors.warning,
        };
      case 'paused':
        return {
          text: [_(taskStateWord.idle_unconfirmed), line.text].filter(Boolean).join(' · '),
          color: muted,
        };
      case 'result':
        return { text: line.text, color: muted };
      case 'exit': {
        const code = line.code;
        return {
          text: t`exit ${code}`,
          color: task.state === 'failed' ? theme.colors.danger : muted,
        };
      }
      case 'error':
        return { text: line.text, color: theme.colors.danger };
      case 'state':
        return {
          text: _(taskStateWord[task.state]),
          color: task.state === 'failed' ? theme.colors.danger : muted,
        };
    }
  };
}

/**
 * One task on a card, Now or Just finished: where it runs, the goal as typed,
 * its age, and the line saying what became of it. Tapping opens the session
 * or pane it runs in; the sub-task count opens the work under it; a paused
 * task the reader may confirm carries the quiet Mark done.
 */
function TaskRow({
  task,
  subTasks,
  serverId,
  discovery,
  nowMs,
  onOpen,
  onOpenTree,
}: {
  task: TaskView;
  /** Its open sub-tasks, one level under it. */
  subTasks?: readonly TaskView[];
  serverId: string;
  discovery: MirroredServerDiscovery | undefined;
  nowMs: number;
  onOpen: (task: TaskView) => void;
  onOpenTree: (task: TaskView) => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const { showToast } = useToast();
  const age = useTaskAge();
  const rowLine = useTaskRowLine(discovery);
  const rollupText = useRollupText()(task);
  const capabilities = useServerCapabilities((state) => state.byServer[serverId]);
  const markDone = useMarkTaskDone(serverId);
  const line = rowLine(task, nowMs);
  const title = taskTitle(task);
  return (
    <View>
      <PressableScale
        testID={`home-card-task-${task.taskId}`}
        accessibilityRole="button"
        accessibilityLabel={[title, line.text, age(task.updatedMs, nowMs), rollupText]
          .filter(Boolean)
          .join(', ')}
        onPress={() => onOpen(task)}
        style={styles.taskRow}>
        <View style={styles.row}>
          <View style={styles.mark}>
            <TaskWhereMark task={task} discovery={discovery} />
          </View>
          <Text variant="bodySmall" weight="semibold" numberOfLines={2} style={styles.grow}>
            {title}
          </Text>
          <Text variant="caption" color={theme.colors.textSubtle}>
            {age(task.updatedMs, nowMs)}
          </Text>
        </View>
        <Text
          testID={`home-card-line-${task.taskId}`}
          variant="caption"
          color={line.color}
          numberOfLines={1}
          style={styles.result}>
          {line.text}
          {rollupText ? (
            <Text
              testID={`home-card-subtasks-${task.taskId}`}
              variant="caption"
              color={theme.colors.primary}
              accessibilityRole="link"
              onPress={() => onOpenTree(task)}>
              {` · ${rollupText}`}
            </Text>
          ) : null}
        </Text>
      </PressableScale>
      {canMarkTaskDone(task, capabilities) ? (
        <View style={styles.result}>
          <SheetSceneQuietAction
            testID={`home-card-mark-done-${task.taskId}`}
            label={t`Mark done`}
            onPress={() => {
              void markDone(task).catch((failure: unknown) => {
                showToast({
                  variant: 'danger',
                  title: t`Could not mark the task done`,
                  message: failure instanceof Error ? failure.message : String(failure),
                });
              });
            }}
          />
        </View>
      ) : null}
      {(subTasks ?? []).map((child) => (
        <PressableScale
          key={child.taskId}
          testID={`home-card-task-${child.taskId}`}
          accessibilityRole="button"
          accessibilityLabel={`${taskTitle(child)}, ${rowLine(child, nowMs).text}`}
          onPress={() => onOpen(child)}
          style={[styles.row, styles.child]}>
          <TaskWhereMark task={child} discovery={discovery} size={12} />
          <Text variant="caption" numberOfLines={1} style={styles.grow}>
            <Text variant="caption" weight="semibold" color={theme.colors.textMuted}>
              {taskTitle(child)}
            </Text>
            <Text variant="caption" color={rowLine(child, nowMs).color}>
              {` · ${rowLine(child, nowMs).text}`}
            </Text>
          </Text>
        </PressableScale>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  cards: { gap: 12, minWidth: 0 },
  card: {
    minWidth: 0,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingTop: 4,
  },
  header: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  headerCopy: { flexShrink: 1, minWidth: 0, gap: 2 },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  block: { gap: 2, paddingBottom: 8 },
  row: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 8 },
  child: { paddingLeft: 22, minHeight: 28 },
  taskRow: { paddingVertical: 4 },
  mark: { width: 14, alignItems: 'center' },
  result: { paddingLeft: 22 },
  grow: { flex: 1, minWidth: 0 },
  footer: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
