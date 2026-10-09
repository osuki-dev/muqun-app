import { useLingui as useLinguiRuntime } from '@lingui/react';
import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { ChevronRight, Server } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';

import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { PressableScale } from '@/components/pressable-scale';
import { StatusDot } from '@/components/status-dot';
import { TaskStatusGlyph } from '@/components/task-status-glyph';
import { Text } from '@/components/text';
import { ThemeIcon } from '@/components/theme-icon';
import { useServerTasks } from '@/hooks/use-server-tasks';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { useTaskAge } from '@/hooks/use-task-age';
import { connectionStatusDescription, connectionStatusLabel, taskStateWord } from '@/i18n/labels';
import { findAgent, type MirroredServerDiscovery } from '@/lib/agent-discovery';
import type { GatewayRecord } from '@/lib/gateway-storage';
import { agentBrandName } from '@/lib/herdr-entity';
import {
  buildComputerCards,
  cardLimits,
  taskResultLine,
  taskRollup,
  taskTitle,
  type CardTaskRow,
  type ComputerCard,
  type PendingDispatch,
} from '@/lib/home-computer-cards';
import { projectLaunchAgents } from '@/lib/home-launch-model';
import {
  resolveConnectionStatus,
  type ActiveServerConnection,
  type ConnectionStatus,
} from '@/lib/server-reachability';
import type { TaskView } from '@/lib/task-ledger';
import { useAgents } from '@/stores/agents';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import { useHomeAgentSessions } from '@/stores/home-agent-sessions';
import { useHomeTaskCards } from '@/stores/home-task-cards';
import { useServerAgents } from '@/stores/server-agents';
import { useServerCapabilities } from '@/stores/server-capabilities';
import { useServerChannels } from '@/stores/server-channels';
import { useServerReachability } from '@/stores/server-reachability';
import { useServerTasksStore } from '@/stores/server-tasks';
import { hasTaskLedger } from '@/lib/task-ledger';

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

export type CardTaskTarget = { serverId: string; task: TaskView };

/**
 * One card per paired computer: what it is doing now, what it just finished,
 * and whether it needs the reader. Sorted needs-you → working → idle →
 * offline. The header picks the computer as the dock's target (long press
 * opens it); a task row opens the Tasks sheet on that task's tree; the
 * footer opens the computer's own settings.
 */
export function HomeComputerCards({
  servers,
  activeConnection,
  nowMs,
  onSelectServer,
  onOpenServer,
  onOpenTask,
  onOpenComputer,
}: {
  servers: readonly GatewayRecord[];
  activeConnection?: ActiveServerConnection;
  /** The focus tick Home resolves probe freshness against. */
  nowMs?: number;
  onSelectServer: (serverId: string) => void;
  onOpenServer: (serverId: string) => void;
  onOpenTask: (target: CardTaskTarget) => void;
  onOpenComputer: (serverId: string) => void;
}) {
  const serverIds = servers.map((server) => server.serverId);
  const entries = useServerTasksStore(
    useShallow((state) => serverIds.map((serverId) => state.index[serverId]))
  );
  const probes = useServerReachability((state) => state.probes);
  const sockets = useServerChannels((state) => state.sockets);
  const streams = useServerChannels((state) => state.streams);
  const selectedId = useGatewayConnectionStore((state) => state.record?.serverId);
  const dismissedList = useHomeTaskCards((state) => state.dismissed);
  const pending = useHomeTaskCards((state) => state.pending);
  // Ages are relative to now; a tick keeps "just now" from going stale.
  const [tickMs, setTickMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setTickMs(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
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
    limits: cardLimits(servers.length),
  });
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
            onOpenTask={(task) => onOpenTask({ serverId: card.serverId, task })}
            onOpenComputer={() => onOpenComputer(card.serverId)}
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
  onOpenComputer,
}: {
  card: ComputerCard;
  server: GatewayRecord;
  status: ConnectionStatus;
  nowMs: number;
  onSelect: () => void;
  onOpen: () => void;
  onOpenTask: (task: TaskView) => void;
  onOpenComputer: () => void;
}) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();
  const background = useSurfaceBackground();
  const age = useTaskAge();
  const ledger = useServerCapabilities((state) => hasTaskLedger(state.byServer[server.serverId]));
  const discovery = useAgents((state) => state.index.servers[server.serverId]);
  const sessions = useHomeAgentSessions(
    (state) => state.byServer[server.serverId]?.sessions.length
  );
  const terminals = useServerAgents((state) => state.byServer[server.serverId]?.agents.length);
  const badges = projectLaunchAgents(discovery)
    .filter((agent) => agent.readiness === 'ready')
    .slice(0, 3)
    .map((agent) => agent.name);
  const statusWord = _(connectionStatusLabel[status]);
  const statusColor =
    status === 'live'
      ? theme.colors.success
      : status === 'unauthorized'
        ? theme.colors.warning
        : theme.colors.textSubtle;
  const idle = card.now.length === 0 && card.pending.length === 0;
  const label = server.label;
  const lastFinished = card.lastFinished;
  const lastTitle = lastFinished ? taskTitle(lastFinished) : '';
  const lastAge = lastFinished ? age(lastFinished.updatedMs, nowMs) : '';
  const footer =
    sessions !== undefined || terminals !== undefined
      ? [
          sessions !== undefined ? t`${sessions} sessions` : '',
          terminals !== undefined ? t`${terminals} terminals` : '',
        ]
          .filter(Boolean)
          .join(' · ')
      : t`Computer settings`;
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
              pulse={status === 'live'}
            />
            <Text variant="caption" color={statusColor} numberOfLines={1}>
              {statusWord}
            </Text>
          </View>
        </View>
        <View style={styles.badges}>
          {badges.map((name) => (
            <View
              key={name}
              style={[
                styles.badge,
                {
                  borderRadius: profile.chrome.control,
                  backgroundColor: background(theme.colors.primarySubtle),
                },
              ]}>
              <Text variant="caption" color={theme.colors.primary} numberOfLines={1}>
                {name}
              </Text>
            </View>
          ))}
        </View>
      </PressableScale>

      {!ledger ? (
        <Text variant="caption" color={theme.colors.textSubtle} style={styles.note}>
          {t`This computer’s Gateway does not keep a task list yet.`}
        </Text>
      ) : idle ? (
        card.known ? (
          <Text
            testID={`home-card-idle-${server.serverId}`}
            variant="caption"
            color={theme.colors.textMuted}
            numberOfLines={1}
            style={styles.note}>
            {lastFinished && card.finished.length === 0
              ? t`Idle · last finished ${lastTitle} ${lastAge}`
              : t`Idle`}
          </Text>
        ) : null
      ) : (
        <View style={styles.block}>
          <Text variant="caption" weight="semibold" color={theme.colors.textSubtle}>
            {t`Now`}
          </Text>
          {card.pending.map((item) => (
            <PendingRow key={item.id} item={item} />
          ))}
          {card.now.map((row) => (
            <NowRow
              key={row.task.taskId}
              row={row}
              discovery={discovery}
              nowMs={nowMs}
              onOpen={onOpenTask}
            />
          ))}
          {card.nowTotal > card.now.length ? (
            <Text variant="caption" color={theme.colors.textMuted}>
              {t`+${card.nowTotal - card.now.length} more`}
            </Text>
          ) : null}
        </View>
      )}

      {ledger && card.finished.length > 0 ? (
        <View style={styles.block}>
          <Text variant="caption" weight="semibold" color={theme.colors.textSubtle}>
            {t`Just finished`}
          </Text>
          {card.finished.map((task) => (
            <FinishedRow key={task.taskId} task={task} nowMs={nowMs} onOpen={onOpenTask} />
          ))}
        </View>
      ) : null}

      <PressableScale
        testID={`home-card-footer-${server.serverId}`}
        accessibilityRole="button"
        accessibilityLabel={t`${label} settings, ${footer}`}
        onPress={onOpenComputer}
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

function PendingRow({ item }: { item: PendingDispatch }) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  return (
    <View testID="home-card-pending" accessibilityLiveRegion="polite" style={styles.row}>
      <TaskStatusGlyph state="dispatching" size={14} />
      <Text variant="bodySmall" numberOfLines={1} style={styles.grow}>
        <Text variant="bodySmall" weight="semibold">
          {item.goal.split('\n')[0]}
        </Text>
        <Text variant="caption" color={theme.colors.textMuted}>
          {` · ${t`Sent · waiting for the computer`}`}
        </Text>
      </Text>
    </View>
  );
}

function NowRow({
  row,
  discovery,
  nowMs,
  onOpen,
}: {
  row: CardTaskRow;
  discovery: MirroredServerDiscovery | undefined;
  nowMs: number;
  onOpen: (task: TaskView) => void;
}) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const theme = useThemeTokens();
  const age = useTaskAge();
  const { task } = row;
  const rollup = taskRollup(task);
  const rollupText = rollup
    ? rollup.waiting > 0
      ? t`${rollup.total} sub-tasks (${rollup.waiting} waiting)`
      : t`${rollup.total} sub-tasks`
    : '';
  const meta = [
    task.state === 'waiting' ? _(taskStateWord.waiting) : '',
    age(task.updatedMs, nowMs),
    rollupText,
  ]
    .filter(Boolean)
    .join(' · ');
  const title = taskTitle(task);
  const agentOf = (child: TaskView) =>
    child.binding.kind === 'agent_session'
      ? (findAgent(discovery?.agents?.agents, child.binding.agentId)?.name ??
        agentBrandName(child.binding.agentId))
      : child.binding.kind === 'pane'
        ? t`Terminal`
        : _(taskStateWord[child.state]);
  return (
    <View>
      <PressableScale
        testID={`home-card-task-${task.taskId}`}
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${_(taskStateWord[task.state])}, ${meta}`}
        onPress={() => onOpen(task)}
        style={styles.row}>
        <TaskStatusGlyph state={task.state} size={14} />
        <Text variant="bodySmall" numberOfLines={1} style={styles.grow}>
          <Text variant="bodySmall" weight="semibold">
            {title}
          </Text>
          <Text variant="caption" color={theme.colors.textMuted}>
            {` · ${meta}`}
          </Text>
        </Text>
      </PressableScale>
      {row.children.map((child) => (
        <PressableScale
          key={child.taskId}
          testID={`home-card-task-${child.taskId}`}
          accessibilityRole="button"
          accessibilityLabel={`${agentOf(child)}, ${taskTitle(child)}, ${_(taskStateWord[child.state])}`}
          onPress={() => onOpen(child)}
          style={[styles.row, styles.child]}>
          <TaskStatusGlyph state={child.state} size={12} />
          <Text variant="caption" numberOfLines={1} style={styles.grow}>
            <Text variant="caption" weight="semibold" color={theme.colors.textMuted}>
              {agentOf(child)}
            </Text>
            <Text variant="caption" color={theme.colors.textMuted}>
              {` · ${taskTitle(child)}`}
            </Text>
          </Text>
        </PressableScale>
      ))}
    </View>
  );
}

function FinishedRow({
  task,
  nowMs,
  onOpen,
}: {
  task: TaskView;
  nowMs: number;
  onOpen: (task: TaskView) => void;
}) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const theme = useThemeTokens();
  const age = useTaskAge();
  const result = taskResultLine(task);
  const code = result?.kind === 'exit' ? result.code : 0;
  const resultText = result
    ? result.kind === 'summary'
      ? result.text
      : t`exit ${code}`
    : _(taskStateWord[task.state]);
  const title = taskTitle(task);
  return (
    <PressableScale
      testID={`home-card-finished-${task.taskId}`}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${_(taskStateWord[task.state])}, ${resultText}`}
      onPress={() => onOpen(task)}
      style={styles.finished}>
      <View style={styles.row}>
        <TaskStatusGlyph state={task.state} size={14} />
        <Text variant="bodySmall" weight="semibold" numberOfLines={1} style={styles.grow}>
          {title}
        </Text>
        <Text variant="caption" color={theme.colors.textSubtle}>
          {age(task.updatedMs, nowMs)}
        </Text>
      </View>
      <Text
        variant="caption"
        color={task.state === 'failed' ? theme.colors.danger : theme.colors.textMuted}
        numberOfLines={1}
        style={styles.result}>
        {resultText}
      </Text>
    </PressableScale>
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
  badges: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 4,
  },
  badge: { paddingHorizontal: 6, paddingVertical: 1, maxWidth: 120 },
  note: { paddingBottom: 10 },
  block: { gap: 2, paddingBottom: 8 },
  row: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 8 },
  child: { paddingLeft: 22, minHeight: 28 },
  finished: { paddingVertical: 4 },
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
