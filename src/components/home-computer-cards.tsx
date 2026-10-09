import { useLingui as useLinguiRuntime } from '@lingui/react';
import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { ChevronRight, Server } from 'lucide-react-native';
import { Fragment } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { LayoutAnimationConfig } from 'react-native-reanimated';
import { useShallow } from 'zustand/react/shallow';

import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { PressableScale } from '@/components/pressable-scale';
import { StatusDot } from '@/components/status-dot';
import { SentTaskRow, TaskRow } from '@/components/task-row';
import { Text } from '@/components/text';
import { ThemeIcon } from '@/components/theme-icon';
import { useServerTasks } from '@/hooks/use-server-tasks';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { connectionStatusDescription, connectionStatusLabel } from '@/i18n/labels';
import type { GatewayRecord } from '@/lib/gateway-storage';
import { buildComputerCards, taskRowRank, type ComputerCard } from '@/lib/home-computer-cards';
import { fadeOut, listLayout, pulseOnce, riseIn } from '@/lib/motion';
import {
  resolveConnectionStatus,
  type ActiveServerConnection,
  type ConnectionStatus,
  type ServerReachability,
} from '@/lib/server-reachability';
import type { TaskView } from '@/lib/task-ledger';
import { useAgents } from '@/stores/agents';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import { PENDING_DISPATCH_TTL_MS, useHomeTaskCards } from '@/stores/home-task-cards';
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

/** `tree`: the reader asked for the work under it (the sub-task count), not the task's own session or pane. */
export type CardTaskTarget = { serverId: string; task: TaskView; tree?: boolean };

/**
 * What every card decision reads besides the ledger: each computer's
 * connection, the reader's acknowledgements, and the goals still on their way.
 */
function useCardInputs(activeConnection: ActiveServerConnection | undefined, nowMs: number) {
  const probes = useServerReachability((state) => state.probes);
  const sockets = useServerChannels((state) => state.sockets);
  const streams = useServerChannels((state) => state.streams);
  const selectedId = useGatewayConnectionStore((state) => state.record?.serverId);
  const dismissedList = useHomeTaskCards((state) => state.dismissed);
  const pendingAll = useHomeTaskCards((state) => state.pending);
  const statusOf = (serverId: string): ConnectionStatus =>
    resolveConnectionStatus({
      serverId,
      probe: probes[serverId],
      activeConnection,
      channels: { socket: sockets[serverId], stream: streams[serverId] },
      selected: serverId === selectedId,
      nowMs,
    });
  const reachability = (serverId: string): ServerReachability => {
    const status = statusOf(serverId);
    return status === 'live' ? 'live' : status === 'offline' ? 'offline' : 'unknown';
  };
  return {
    statusOf,
    reachability,
    dismissed: new Set(dismissedList),
    // A Sent row no task ever answered stops claiming the computer is busy.
    pending: pendingAll.filter((item) => nowMs - item.atMs < PENDING_DISPATCH_TTL_MS),
  };
}

/**
 * Whether any computer has a card. Home asks only this: the store selector
 * returns a boolean, so a task frame re-renders Home only when the section
 * appears or goes, and the cards re-render inside their own tree.
 */
export function useHasComputerCards({
  servers,
  activeConnection,
  nowMs,
}: {
  servers: readonly GatewayRecord[];
  activeConnection?: ActiveServerConnection;
  /** Home's focus tick. */
  nowMs: number;
}): boolean {
  const inputs = useCardInputs(activeConnection, nowMs);
  return useServerTasksStore(
    (state) =>
      buildComputerCards({
        servers,
        index: state.index,
        reachability: inputs.reachability,
        dismissed: inputs.dismissed,
        pending: inputs.pending,
        nowMs,
      }).length > 0
  );
}

/**
 * The cards: what each computer with work is doing now, what it just
 * finished, and whether it needs the reader. Sorted needs-you → working →
 * paused → idle. The header makes the computer the dock's target; a task row
 * opens the session or pane it runs in; the footer opens the computer's task
 * list. A card fades and rises in when its computer starts having work and
 * fades out when it stops; the others move with the shared layout transition.
 * Entering animations are skipped when the list itself mounts (a return from
 * a sub-screen), so only real arrivals move.
 */
export function HomeComputerCards({
  servers,
  activeConnection,
  nowMs,
  skipEntering,
  onSelectServer,
  onOpenTask,
  onOpenTasks,
}: {
  servers: readonly GatewayRecord[];
  activeConnection?: ActiveServerConnection;
  /** Home's focus tick: ages, the Sent row's lifetime and probe freshness. */
  nowMs: number;
  /**
   * The cards were already there when Home mounted: they are not arrivals.
   * Home owns this because the section itself only mounts with its first card.
   */
  skipEntering: boolean;
  onSelectServer: (serverId: string) => void;
  onOpenTask: (target: CardTaskTarget) => void;
  /** The computer's whole task list. */
  onOpenTasks: (serverId: string) => void;
}) {
  const serverIds = servers.map((server) => server.serverId);
  const entries = useServerTasksStore(
    useShallow((state) => serverIds.map((serverId) => state.index[serverId]))
  );
  const inputs = useCardInputs(activeConnection, nowMs);
  const index: Record<string, NonNullable<(typeof entries)[number]>> = {};
  serverIds.forEach((serverId, position) => {
    const entry = entries[position];
    if (entry) index[serverId] = entry;
  });
  const cards = buildComputerCards({
    servers,
    index,
    reachability: inputs.reachability,
    dismissed: inputs.dismissed,
    pending: inputs.pending,
    nowMs,
  });
  const statusOf = inputs.statusOf;
  const tickMs = nowMs;
  return (
    <LayoutAnimationConfig skipEntering={skipEntering}>
      {cards.length === 0 ? null : (
        <View testID="home-computer-cards" style={styles.cards}>
          {cards.map((card) => {
            const server = servers.find((item) => item.serverId === card.serverId);
            if (!server) return null;
            return (
              <Animated.View
                key={card.serverId}
                entering={riseIn()}
                exiting={fadeOut('micro')}
                layout={listLayout()}>
                <ComputerCardView
                  card={card}
                  server={server}
                  status={statusOf(card.serverId)}
                  nowMs={tickMs}
                  onSelect={() => onSelectServer(card.serverId)}
                  onOpenTask={(task, tree) =>
                    onOpenTask({ serverId: card.serverId, task, ...(tree ? { tree } : {}) })
                  }
                  onOpenTasks={() => onOpenTasks(card.serverId)}
                />
              </Animated.View>
            );
          })}
        </View>
      )}
    </LayoutAnimationConfig>
  );
}

function ComputerCardView({
  card,
  server,
  status,
  nowMs,
  onSelect,
  onOpenTask,
  onOpenTasks,
}: {
  card: ComputerCard;
  server: GatewayRecord;
  status: ConnectionStatus;
  nowMs: number;
  onSelect: () => void;
  onOpenTask: (task: TaskView, tree?: boolean) => void;
  onOpenTasks: () => void;
}) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();
  const background = useSurfaceBackground();
  const discovery = useAgents((state) => state.index.servers[server.serverId]);
  const statusColor =
    status === 'live'
      ? theme.colors.success
      : status === 'unauthorized'
        ? theme.colors.warning
        : theme.colors.textSubtle;
  const footer = t`All tasks`;
  // Sent goals sit among the open work by the same urgency (after working,
  // before paused). Now and Just finished share one parent, so a row that
  // finishes is the same element moving down, not a new one.
  const urgentNow = card.now.filter((row) => taskRowRank(row.task.state) < 2);
  const restNow = card.now.filter((row) => taskRowRank(row.task.state) >= 2);
  const nowRow = (row: ComputerCard['now'][number]) => (
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
  );
  const hasNow = card.now.length > 0 || card.pending.length > 0;
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
      ]}>
      {card.activity === 'needs-you' ? (
        // The needs-you edge pulses once when the card starts needing the
        // reader (`pulseOnce`), then stays still; instant under reduce-motion.
        <Animated.View
          pointerEvents="none"
          entering={pulseOnce()}
          style={[styles.needsYou, { backgroundColor: theme.colors.warning }]}
        />
      ) : null}
      <PressableScale
        testID={`home-card-header-${server.serverId}`}
        accessibilityRole="button"
        accessibilityLabel={`${server.label}, ${_(connectionStatusDescription[status])}`}
        accessibilityHint={t`Sends your next goal here.`}
        onPress={onSelect}
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
              {_(connectionStatusLabel[status])}
            </Text>
          </View>
        </View>
      </PressableScale>

      <View style={styles.block}>
        {hasNow ? (
          <Text key="now" variant="caption" weight="semibold" color={theme.colors.textSubtle}>
            {t`Now`}
          </Text>
        ) : null}
        {urgentNow.map(nowRow)}
        {card.pending.map((item) => (
          <SentTaskRow key={item.id} goal={item.goal} computer={server.label} />
        ))}
        {restNow.map(nowRow)}
        {card.nowTotal > card.now.length ? (
          <Text key="more" variant="caption" color={theme.colors.textMuted}>
            {t`+${card.nowTotal - card.now.length} more`}
          </Text>
        ) : null}
        {card.finished.length > 0 ? (
          <Fragment key="finished">
            <Text variant="caption" weight="semibold" color={theme.colors.textSubtle}>
              {t`Just finished`}
            </Text>
          </Fragment>
        ) : null}
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

      <PressableScale
        testID={`home-card-footer-${server.serverId}`}
        accessibilityRole="button"
        accessibilityLabel={`${server.label}, ${footer}`}
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
  needsYou: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  block: { gap: 2, paddingBottom: 8 },
  grow: { flex: 1, minWidth: 0 },
  footer: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
