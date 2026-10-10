import { useLingui as useLinguiRuntime } from '@lingui/react';
import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { Server } from 'lucide-react-native';
import { useLayoutEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { LayoutAnimationConfig } from 'react-native-reanimated';
import { useShallow } from 'zustand/react/shallow';

import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { PressableScale } from '@/components/pressable-scale';
import { StatusDot } from '@/components/status-dot';
import { SentTaskRow, TaskRow } from '@/components/task-row';
import { Text } from '@/components/text';
import { useFrozenValue } from '@/hooks/use-frozen-value';
import { useServerTasks } from '@/hooks/use-server-tasks';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { connectionStatusDescription, connectionStatusLabel } from '@/i18n/labels';
import type { GatewayRecord } from '@/lib/gateway-storage';
import {
  buildComputerCards,
  heldCardOrder,
  taskRowRank,
  type ComputerCard,
  HOME_CARD_INSET,
  RECENT_FINISHED_MS,
} from '@/lib/home-computer-cards';
import { isTerminalTaskState } from '@/lib/task-ledger';
import { useDeadlineNow } from '@/hooks/use-deadline-now';
import { useMinuteNow } from '@/hooks/use-minute-now';
import { PAD_CARD_GAP, padCardColumns } from '@/lib/home-pad-geometry';
import { fadeOut, listLayout, riseIn } from '@/lib/motion';
import { useConnectionStatuses, useHomeReachability } from '@/hooks/use-home-reachability';
import {
  type ActiveServerConnection,
  type ConnectionStatus,
  type ServerReachability,
} from '@/lib/server-reachability';
import type { TaskView } from '@/lib/task-ledger';
import { useAgents } from '@/stores/agents';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import { PENDING_DISPATCH_TTL_MS, useHomeTaskCards } from '@/stores/home-task-cards';
import { useServerReachability } from '@/stores/server-reachability';
import { useHomeSortHold } from '@/stores/home-sort-hold';
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
 * What every card decision reads besides the ledger and the connections: the
 * reader's acknowledgements, and the goals still on their way.
 */
function useCardInputs(nowMs: number) {
  const dismissedList = useHomeTaskCards((state) => state.dismissed);
  const pendingAll = useHomeTaskCards((state) => state.pending);
  return {
    dismissed: new Set(dismissedList),
    // A Sent row no task ever answered stops claiming the computer is busy.
    pending: pendingAll.filter((item) => nowMs - item.atMs < PENDING_DISPATCH_TTL_MS),
  };
}

const subscribeCardDeadlines = (onChange: () => void) => {
  const tasks = useServerTasksStore.subscribe(onChange);
  const cards = useHomeTaskCards.subscribe(onChange);
  return () => {
    tasks();
    cards();
  };
};

/**
 * The first instant after `afterMs` at which time alone could take a card
 * away: a Sent row outliving `PENDING_DISPATCH_TTL_MS`, or a finished task
 * leaving the `RECENT_FINISHED_MS` window.
 */
function nextCardExpiry(afterMs: number): number | undefined {
  let next: number | undefined;
  const consider = (atMs: number) => {
    if (atMs > afterMs && (next === undefined || atMs < next)) next = atMs;
  };
  for (const item of useHomeTaskCards.getState().pending)
    consider(item.atMs + PENDING_DISPATCH_TTL_MS);
  for (const entry of Object.values(useServerTasksStore.getState().index)) {
    for (const task of entry?.tasks ?? []) {
      if (!isTerminalTaskState(task.state)) continue;
      consider(
        Math.max(task.updatedMs, task.settledAtMs ?? task.updatedMs) + RECENT_FINISHED_MS + 1
      );
    }
  }
  return next;
}

/** Whether any computer has a card at `nowMs`, from the stores as they are now. */
export function hasComputerCardsAt({
  servers,
  reachabilityByServer,
  nowMs,
}: {
  servers: readonly GatewayRecord[];
  reachabilityByServer: Readonly<Record<string, ServerReachability | undefined>>;
  nowMs: number;
}): boolean {
  const cards = useHomeTaskCards.getState();
  return (
    buildComputerCards({
      servers,
      index: useServerTasksStore.getState().index,
      reachability: (serverId) => reachabilityByServer[serverId],
      dismissed: new Set(cards.dismissed),
      pending: cards.pending.filter((item) => nowMs - item.atMs < PENDING_DISPATCH_TTL_MS),
      nowMs,
    }).length > 0
  );
}

/**
 * Tells Home whether any computer has a card, and draws nothing.
 *
 * Home needs only the boolean (the section is there or not); the clock it
 * turns on lives here. Time is a deadline clock, not a tick: the answer is
 * re-asked at the moment a Sent row or a finished task could expire, and a
 * task frame or a deadline re-renders this, not Home -- Home hears about it
 * only when the answer flips.
 */
export function ComputerCardsPresence({
  servers,
  reachabilityByServer,
  onChange,
}: {
  servers: readonly GatewayRecord[];
  /** Home's folded reachability; a refused pairing counts as offline. */
  reachabilityByServer: Readonly<Record<string, ServerReachability | undefined>>;
  onChange: (hasCards: boolean) => void;
}) {
  const nowMs = useDeadlineNow(subscribeCardDeadlines, nextCardExpiry);
  const dismissedList = useHomeTaskCards((state) => state.dismissed);
  const pending = useHomeTaskCards(
    useShallow((state) =>
      state.pending.filter((item) => nowMs - item.atMs < PENDING_DISPATCH_TTL_MS)
    )
  );
  const dismissed = new Set(dismissedList);
  const hasCards = useServerTasksStore(
    (state) =>
      buildComputerCards({
        servers,
        index: state.index,
        reachability: (serverId) => reachabilityByServer[serverId],
        dismissed,
        pending,
        nowMs,
      }).length > 0
  );
  // Before paint, so a section that appears or goes does it in the same frame.
  useLayoutEffect(() => {
    onChange(hasCards);
  }, [hasCards, onChange]);
  return null;
}

/**
 * The cards: what each computer with work is doing now, what it just
 * finished, and whether it needs the reader. Sorted needs-you → working →
 * paused → idle. The header makes the computer the dock's target; a task row
 * opens the session or pane it runs in. A card fades and rises in when its
 * computer starts having work and fades out when it stops; the others move
 * with the shared layout transition.
 * Entering animations are skipped when the list itself mounts (a return from
 * a sub-screen), so only real arrivals move. A re-sort waits while a finger is
 * on the page and for a moment after a scroll (`useHomeSortHold`).
 */
export function HomeComputerCards({
  servers,
  followedIds,
  activeConnection,
  skipEntering,
  gridWidth,
  onSelectServer,
  onOpenTask,
}: {
  servers: readonly GatewayRecord[];
  /**
   * The computers whose ledgers are kept live (`taskSubscriptionServerIds`).
   * Any other card says it is not being followed instead of showing its last
   * rows as if they were current.
   */
  followedIds: readonly string[];
  activeConnection?: ActiveServerConnection;
  /**
   * The cards were already there when Home mounted: they are not arrivals.
   * Home owns this because the section itself only mounts with its first card.
   */
  skipEntering: boolean;
  /** The Pad work column's width: cards sit two abreast when it has room (`padCardColumns`). */
  gridWidth?: number;
  onSelectServer: (serverId: string) => void;
  onOpenTask: (target: CardTaskTarget) => void;
}) {
  const serverIds = servers.map((server) => server.serverId);
  const entries = useServerTasksStore(
    useShallow((state) => serverIds.map((serverId) => state.index[serverId]))
  );
  // Ages, the Sent row's lifetime and the finished window move with the
  // minute, and with the probes' own freshness clock.
  const probeNowMs = useServerReachability((state) => state.freshnessNowMs);
  const nowMs = useMinuteNow(probeNowMs);
  const inputs = useCardInputs(nowMs);
  // The same fold Home's presence check uses, so a card and the section agree;
  // it moves only when a computer goes live, offline or unknown.
  const reachability = useHomeReachability(serverIds, activeConnection);
  const index: Record<string, NonNullable<(typeof entries)[number]>> = {};
  serverIds.forEach((serverId, position) => {
    const entry = entries[position];
    if (entry) index[serverId] = entry;
  });
  const sorted = buildComputerCards({
    servers,
    index,
    reachability: (serverId) => reachability[serverId],
    followed: new Set(followedIds),
    dismissed: inputs.dismissed,
    pending: inputs.pending,
    nowMs,
  });
  // The order on screen, held while the reader's finger or eye is on it.
  const held = useHomeSortHold((state) => state.held);
  const shownIds = useFrozenValue(
    sorted.map((card) => card.serverId),
    held,
    null
  );
  const cards = heldCardOrder(shownIds, sorted);
  const grid = gridWidth !== undefined && padCardColumns(gridWidth, cards.length) === 2;
  const tickMs = nowMs;
  return (
    <LayoutAnimationConfig skipEntering={skipEntering}>
      {cards.length === 0 ? null : (
        <View testID="home-computer-cards" style={grid ? styles.grid : styles.cards}>
          {cards.map((card) => {
            const server = servers.find((item) => item.serverId === card.serverId);
            if (!server) return null;
            return (
              <Animated.View
                key={card.serverId}
                entering={riseIn()}
                exiting={fadeOut('micro')}
                layout={listLayout()}
                style={grid ? styles.gridCell : undefined}>
                <ComputerCardView
                  card={card}
                  server={server}
                  followed={followedIds.includes(card.serverId)}
                  activeConnection={activeConnection}
                  nowMs={tickMs}
                  onSelect={() => onSelectServer(card.serverId)}
                  onOpenTask={(task, tree) =>
                    onOpenTask({ serverId: card.serverId, task, ...(tree ? { tree } : {}) })
                  }
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
  followed,
  activeConnection,
  nowMs,
  onSelect,
  onOpenTask,
}: {
  card: ComputerCard;
  server: GatewayRecord;
  followed: boolean;
  activeConnection?: ActiveServerConnection;
  nowMs: number;
  onSelect: () => void;
  onOpenTask: (task: TaskView, tree?: boolean) => void;
}) {
  const { t } = useLingui();
  // This card's own status: a probe or a retry against another computer
  // re-renders only the card whose status moved.
  const selectedId = useGatewayConnectionStore((state) => state.record?.serverId);
  const status: ConnectionStatus =
    useConnectionStatuses([server.serverId], selectedId, activeConnection)[server.serverId] ??
    'unknown';
  const { _ } = useLinguiRuntime();
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();
  const background = useSurfaceBackground();
  const discovery = useAgents((state) => state.index.servers[server.serverId]);
  // A card says its computer's connection only when something is wrong with
  // it; a reachable computer is just its name (§3a).
  const statusColor =
    status === 'unauthorized'
      ? theme.colors.warning
      : status === 'offline'
        ? theme.colors.textSubtle
        : null;
  // Sent goals sit among the open work by the same urgency (after working,
  // before paused), and finished rows under all of it, with no group headers:
  // each row's icon and time say which it is. Open and finished rows share
  // one parent, so a row that finishes is the same element moving down.
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
  return (
    <View
      testID={`home-card-${server.serverId}`}
      style={[
        styles.card,
        styles.fill,
        {
          backgroundColor: background(theme.colors.surface),
          borderColor: theme.colors.border,
          borderRadius: profile.chrome.surface,
        },
      ]}>
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
          {statusColor ? (
            <View style={styles.statusLine}>
              {/* No ripple: every card rippling forever keeps Home's UI thread busy. */}
              <StatusDot color={statusColor} filled pulse={false} />
              <Text variant="caption" color={statusColor} numberOfLines={1}>
                {_(connectionStatusLabel[status])}
              </Text>
            </View>
          ) : null}
        </View>
      </PressableScale>

      {followed ? (
        <View style={styles.block}>
          {urgentNow.map(nowRow)}
          {card.pending.map((item) => (
            <SentTaskRow key={item.id} item={item} computer={server.label} />
          ))}
          {restNow.map(nowRow)}
          {card.nowTotal > card.now.length ? (
            <Text key="more" variant="caption" color={theme.colors.textMuted}>
              {t`+${card.nowTotal - card.now.length} more`}
            </Text>
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
      ) : (
        <View style={styles.block}>
          <Text variant="caption" color={theme.colors.textMuted}>
            {t`Not updating from here. Open this computer to see its tasks.`}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  cards: { gap: PAD_CARD_GAP, minWidth: 0 },
  // Half-width cells with the gap split between neighbours, so two cards sit
  // abreast and a row's cards share its height.
  grid: {
    minWidth: 0,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: PAD_CARD_GAP,
    marginHorizontal: -PAD_CARD_GAP / 2,
  },
  gridCell: { width: '50%', paddingHorizontal: PAD_CARD_GAP / 2 },
  card: {
    minWidth: 0,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: HOME_CARD_INSET,
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
  fill: { flexGrow: 1 },
});
