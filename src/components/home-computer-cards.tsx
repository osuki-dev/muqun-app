import { useLingui as useLinguiRuntime } from '@lingui/react';
import { useLingui } from '@lingui/react/macro';
import { useIsFocused } from 'expo-router';
import { useThemeTokens } from '@osuki-dev/ui';
import { ChevronRight, Server } from 'lucide-react-native';
import { Fragment, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
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
import { fadeIn, fadeOut, listLayout, riseIn } from '@/lib/motion';
import {
  resolveConnectionStatus,
  type ActiveServerConnection,
  type ConnectionStatus,
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
 * paused → idle. The header makes the computer the dock's target; a task row
 * opens the session or pane it runs in; the footer opens the computer's task
 * list. A card fades and rises in when its computer starts having work and
 * fades out when it stops; the others move with the shared layout transition.
 */
export function HomeComputerCards({
  model,
  servers,
  onSelectServer,
  onOpenTask,
  onOpenTasks,
}: {
  model: HomeComputerCardsModel;
  servers: readonly GatewayRecord[];
  onSelectServer: (serverId: string) => void;
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
        // The needs-you edge arrives once, a single fade on `medium`, then
        // stays still; reduce-motion makes it instant.
        <Animated.View
          pointerEvents="none"
          entering={fadeIn('medium')}
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
