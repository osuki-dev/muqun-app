import { useLingui as useLinguiRuntime } from '@lingui/react';
import { useLingui } from '@lingui/react/macro';
import { useThemeTokens, PressableScale, Text } from '@osuki-dev/ui';
import { ArrowUpRight, Monitor } from 'lucide-react-native';
import { useEffect, useLayoutEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  LayoutAnimationConfig,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useShallow } from 'zustand/react/shallow';

import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import {
  HomeComputerDeck,
  type DeckCardActions,
  type DeckCardLayout,
} from '@/components/home-computer-deck';
import { PairAgainNotice } from '@/components/pair-again-notice';
import { StatusDot } from '@/components/status-dot';
import { SentTaskRow, TaskRow } from '@/components/task-row';
import { useFrozenValue } from '@/hooks/use-frozen-value';
import { useServerTasks } from '@/hooks/use-server-tasks';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { connectionStatusDescription, connectionStatusLabel } from '@/i18n/labels';
import type { GatewayRecord } from '@/lib/gateway-storage';
import { HOME_CONTINUE_INITIAL_LIMIT } from '@/lib/home-continue';
import {
  buildComputerCards,
  heldCardOrder,
  lastKnownActivityCaption,
  pendingShown,
  taskRowRank,
  taskRollup,
  type ComputerCard,
  HOME_CARD_INSET,
  FINISHED_ROWS_SHOWN,
} from '@/lib/home-computer-cards';
import { useDeadlineNow } from '@/hooks/use-deadline-now';
import { useMinuteNow } from '@/hooks/use-minute-now';
import { DECK_CARD_ROWS } from '@/lib/home-computer-deck';
import { PAD_CARD_GAP, padCardColumns } from '@/lib/home-pad-geometry';
import { fadeOut, listLayout, riseIn, timing } from '@/lib/motion';
import { useConnectionStatuses, useHomeReachability } from '@/hooks/use-home-reachability';
import {
  statusNeedsPairing,
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
import { useServerAgents } from '@/stores/server-agents';
import { useHomeAttention } from '@/stores/home-attention';
import { useServerChannels } from '@/stores/server-channels';
import { FINISHED_TASKS_SHOWN } from '@/lib/server-tasks-state';

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
  const hiddenList = useHomeTaskCards((state) => state.hidden);
  return {
    dismissed: new Set(dismissedList),
    hidden: new Set(hiddenList),
    // A Sent row no task ever answered goes, unless it holds a draft or a session.
    pending: pendingAll.filter((item) => pendingShown(item, nowMs)),
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
 * The first instant after `afterMs` at which time alone changes a card: a
 * Sent row outliving `PENDING_DISPATCH_TTL_MS`, which stops counting as work
 * and reads as delivery unconfirmed. Nothing leaves a card by time any more.
 */
function nextCardExpiry(afterMs: number): number | undefined {
  let next: number | undefined;
  for (const item of useHomeTaskCards.getState().pending) {
    const atMs = item.atMs + PENDING_DISPATCH_TTL_MS;
    if (atMs > afterMs && (next === undefined || atMs < next)) next = atMs;
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
      panesByServer: useServerAgents.getState().byServer,
      reachability: (serverId) => reachabilityByServer[serverId],
      dismissed: new Set(cards.dismissed),
      hidden: new Set(cards.hidden),
      pending: cards.pending.filter((item) => pendingShown(item, nowMs)),
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
    useShallow((state) => state.pending.filter((item) => pendingShown(item, nowMs)))
  );
  const dismissed = new Set(dismissedList);
  const hiddenList = useHomeTaskCards((state) => state.hidden);
  const hidden = new Set(hiddenList);
  const panesByServer = useServerAgents((state) => state.byServer);
  const requests = useHomeAttention((state) => state.byTarget);
  const hasCards = useServerTasksStore(
    (state) =>
      buildComputerCards({
        servers,
        index: state.index,
        panesByServer,
        requests,
        reachability: (serverId) => reachabilityByServer[serverId],
        dismissed,
        hidden,
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
  deck = false,
  onSelectServer,
  onOpenTask,
  onOpenHistory,
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
  /** The phone: two or more computers sit in a sheaf (`HomeComputerDeck`), not a list. */
  deck?: boolean;
  onSelectServer: (serverId: string) => void;
  onOpenTask: (target: CardTaskTarget) => void;
  /** The computer's task history, everything the card no longer lists. */
  onOpenHistory?: (serverId: string) => void;
}) {
  const serverIds = servers.map((server) => server.serverId);
  const selectedId = useGatewayConnectionStore((state) => state.record?.serverId);
  const statuses = useConnectionStatuses(serverIds, selectedId, activeConnection);
  const { i18n } = useLinguiRuntime();
  const entries = useServerTasksStore(
    useShallow((state) => serverIds.map((serverId) => state.index[serverId]))
  );
  // Ages, the Sent row's lifetime and the finished window move with the
  // minute, and with the probes' own freshness clock.
  const probeNowMs = useServerReachability((state) => state.freshnessNowMs);
  const nowMs = useMinuteNow(probeNowMs);
  const inputs = useCardInputs(nowMs);
  const panesByServer = useServerAgents((state) => state.byServer);
  const requests = useHomeAttention((state) => state.byTarget);
  // The same fold Home's presence check uses, so a card and the section agree;
  // it moves only when a computer goes live, offline or unknown.
  const reachability = useHomeReachability(serverIds, activeConnection);
  const index: Record<string, NonNullable<(typeof entries)[number]>> = {};
  serverIds.forEach((serverId, position) => {
    const entry = entries[position];
    if (entry) index[serverId] = entry;
  });
  const sorted = buildComputerCards({
    // Expand the currently held task page, bounded like the Tasks sheet.
    // The toggle never promises to fetch the computer's entire history.
    limits: { now: 100, finished: FINISHED_TASKS_SHOWN },
    servers,
    index,
    panesByServer,
    requests,
    reachability: (serverId) => reachability[serverId],
    followed: new Set(followedIds),
    dismissed: inputs.dismissed,
    hidden: inputs.hidden,
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
  const renderCard = (
    card: ComputerCard,
    deckActions?: DeckCardActions,
    deckLayout?: DeckCardLayout
  ) => {
    const server = servers.find((item) => item.serverId === card.serverId);
    if (!server) return null;
    return (
      <ComputerCardView
        card={card}
        server={server}
        followed={followedIds.includes(card.serverId)}
        activeConnection={activeConnection}
        nowMs={tickMs}
        deckActions={deckActions}
        deckLayout={deckLayout}
        onSelect={() => onSelectServer(card.serverId)}
        onOpenTask={(task, tree) =>
          onOpenTask({ serverId: card.serverId, task, ...(tree ? { tree } : {}) })
        }
        onOpenHistory={onOpenHistory ? () => onOpenHistory(card.serverId) : undefined}
      />
    );
  };
  if (deck && !grid && cards.length >= 2) {
    return (
      <LayoutAnimationConfig skipEntering={skipEntering}>
        <View testID="home-computer-cards" style={styles.cards}>
          <HomeComputerDeck
            cards={cards}
            servers={servers}
            activeConnection={activeConnection}
            onSelectServer={onSelectServer}
            renderCard={renderCard}
            signatures={Object.fromEntries(
              cards.map((card) => [
                card.serverId,
                cardSignature(
                  card,
                  followedIds.includes(card.serverId),
                  statuses[card.serverId] ?? 'unknown',
                  i18n.locale
                ),
              ])
            )}
          />
        </View>
      </LayoutAnimationConfig>
    );
  }
  return (
    <LayoutAnimationConfig skipEntering={skipEntering}>
      {cards.length === 0 ? null : (
        <View testID="home-computer-cards" style={grid ? styles.grid : styles.cards}>
          {cards.map((card) => (
            <Animated.View
              key={card.serverId}
              entering={riseIn()}
              exiting={fadeOut('micro')}
              layout={listLayout()}
              style={grid ? styles.gridCell : undefined}>
              {renderCard(card)}
            </Animated.View>
          ))}
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
  deckActions,
  deckLayout,
  onSelect,
  onOpenTask,
  onOpenHistory,
}: {
  card: ComputerCard;
  server: GatewayRecord;
  followed: boolean;
  activeConnection?: ActiveServerConnection;
  nowMs: number;
  /** In the sheaf, the header also moves to the next or previous computer. */
  deckActions?: DeckCardActions;
  /** In the sheaf, every card is as tall as the tallest; this one reports its own height. */
  deckLayout?: DeckCardLayout;
  onSelect: () => void;
  onOpenTask: (task: TaskView, tree?: boolean) => void;
  onOpenHistory?: () => void;
}) {
  const { t } = useLingui();
  // Open work is shown up to the usual limit and finished work shows three
  // rows. There is no fold under the card: the rest of the computer's work is
  // one tap away in its tasks list, which the header opens.
  const openRows = card.now.length + card.pending.length;
  // In the sheaf every card shows at most three rows, open work first: the
  // cards are one height, and the header opens the rest.
  const shownOpen = Math.min(openRows, deckLayout ? DECK_CARD_ROWS : HOME_CONTINUE_INITIAL_LIMIT);
  const shownFinished = Math.min(
    card.finished.length,
    deckLayout ? DECK_CARD_ROWS - shownOpen : FINISHED_ROWS_SHOWN
  );
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
  // A followed ledger can retain a list while its socket is reconnecting or
  // unavailable. Keep that history, but do not animate its remembered status
  // as current activity merely because a health probe or terminal stream is up.
  const taskSocket = useServerChannels((state) => state.sockets[server.serverId]);
  const statusCurrent = followed && taskSocket === 'open';
  const cachedCaption = lastKnownActivityCaption({
    followed,
    socket: taskSocket,
    rows: card.now.length + card.finished.length,
  });
  // A card says its computer's connection only when something is wrong with
  // it; a reachable computer is just its name (§3a).
  const statusColor = statusNeedsPairing(status)
    ? theme.colors.warning
    : status === 'offline' || status === 'reconnecting'
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
      inComputerCard
      statusCurrent={statusCurrent}
      serverId={server.serverId}
      discovery={discovery}
      nowMs={nowMs}
      onOpen={(task) => onOpenTask(task)}
      onOpenTree={(task) => onOpenTask(task, true)}
    />
  );
  const cardHeader = (
    <PressableScale
      testID={`home-card-header-${server.serverId}`}
      accessibilityRole="button"
      accessibilityLabel={`${server.label}, ${_(connectionStatusDescription[status])}`}
      accessibilityHint={onOpenHistory ? t`Opens its tasks.` : t`Sends your next goal here.`}
      onPress={onOpenHistory ?? onSelect}
      accessibilityActions={deckActions?.accessibilityActions}
      onAccessibilityAction={deckActions?.onAccessibilityAction}
      style={[styles.header, deckLayout ? styles.historyLink : null]}>
      {deckLayout ? null : <Monitor size={18} color={theme.colors.primary} />}
      <View style={[styles.headerCopy, styles.fill]}>
        <Text variant="bodySmall" weight="medium" numberOfLines={1}>
          {deckLayout ? t`Tasks` : server.label}
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
      {/* The caption sits in the header's spare right half, so it never
            takes a line of its own and nothing below it moves when it fades. */}
      {cachedCaption !== 'none' ? (
        <LastKnownActivityCaption
          shown={cachedCaption === 'shown'}
          testID={`home-card-cached-${server.serverId}`}
        />
      ) : null}
      {deckLayout ? <ArrowUpRight size={16} color={theme.colors.primary} /> : null}
    </PressableScale>
  );
  return (
    <View
      testID={`home-card-${server.serverId}`}
      style={[
        styles.card,
        styles.fill,
        {
          backgroundColor: background(theme.colors.surface),
          borderRadius: profile.chrome.surface,
          borderTopLeftRadius: deckLayout ? 0 : profile.chrome.surface,
          minHeight: deckLayout?.minHeight,
        },
      ]}>
      <View
        onLayout={
          deckLayout
            ? (event) =>
                deckLayout.onContentHeight(event.nativeEvent.layout.height + CARD_PADDING_TOP)
            : undefined
        }>
        {deckLayout ? null : cardHeader}
        <PairAgainNotice
          testID={`home-card-pair-again-${server.serverId}`}
          status={status}
          server={server}
        />

        {followed ? (
          <View style={styles.block}>
            {/* One keyed list, not one per section: a task moving between Now
              and Just finished (it finished, or it was reopened) is the same
              row element, moved by its layout transition, never re-created. */}
            {[
              ...[
                ...urgentNow.map(nowRow),
                ...card.pending.map((item) => (
                  <SentTaskRow key={item.id} item={item} computer={server.label} nowMs={nowMs} />
                )),
                ...restNow.map(nowRow),
              ].slice(0, shownOpen),
              ...card.finished
                .slice(0, shownFinished)
                .map((task) => (
                  <TaskRow
                    key={task.taskId}
                    task={task}
                    inComputerCard
                    statusCurrent={statusCurrent}
                    serverId={server.serverId}
                    discovery={discovery}
                    nowMs={nowMs}
                    onOpen={(finished) => onOpenTask(finished)}
                    onOpenTree={(finished) => onOpenTask(finished, true)}
                  />
                )),
            ]}
          </View>
        ) : (
          <View style={styles.block}>
            <Text variant="caption" color={theme.colors.textMuted}>
              {t`Not updating from here. Open this computer to see its tasks.`}
            </Text>
          </View>
        )}
        {deckLayout ? cardHeader : null}
      </View>
    </View>
  );
}

/** What a card shows, as far as its height goes: its rows and whether it lists them. */
function cardSignature(
  card: ComputerCard,
  followed: boolean,
  status: ConnectionStatus,
  locale: string
): string {
  // The header's status and pairing notice can add height even while its
  // ledger is hidden. Unfollowed cards show only the explanatory paragraph.
  const header = [followed, status, locale];
  if (!followed) return JSON.stringify(header);
  const taskShape = (task: TaskView, childRows = 0) => [
    task.taskId,
    childRows,
    Boolean(taskRollup(task)),
  ];
  // Match the displayed order, including pending rows ahead of paused work.
  // Offscreen fourth-and-later rows must not remount a measurement card.
  const open = [
    ...card.now
      .filter((row) => taskRowRank(row.task.state) < 2)
      .map((row) => taskShape(row.task, row.children.length)),
    ...card.pending.map((item) => [item.id]),
    ...card.now
      .filter((row) => taskRowRank(row.task.state) >= 2)
      .map((row) => taskShape(row.task, row.children.length)),
  ].slice(0, DECK_CARD_ROWS);
  const finished = card.finished
    .slice(0, DECK_CARD_ROWS - open.length)
    .map((task) => taskShape(task));
  return JSON.stringify([header, open, finished]);
}

/**
 * "Last known activity", at the right of the card's header once the card has
 * rows. The caption used to mount above the keyed task rows the moment the
 * socket closed and leave by unmounting, so every arrival pushed the rows
 * down through a layout transition -- and in the app switcher, where
 * Reanimated has stopped, the snapshot caught the first frame of that move
 * with the caption drawn across the first row's title. It now lives in the
 * header's spare half and only fades, so nothing around it ever moves and
 * the card spends no line on it.
 */
function LastKnownActivityCaption({ shown, testID }: { shown: boolean; testID: string }) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const opacity = useSharedValue(shown ? 1 : 0);
  useEffect(() => {
    opacity.set(withTiming(shown ? 1 : 0, timing('micro')));
  }, [opacity, shown]);
  const fade = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  return (
    <Animated.View
      style={fade}
      accessibilityElementsHidden={!shown}
      importantForAccessibility={shown ? 'auto' : 'no-hide-descendants'}>
      <Text
        testID={shown ? testID : undefined}
        variant="caption"
        color={theme.colors.textMuted}
        numberOfLines={1}>
        {t`Last known activity`}
      </Text>
    </Animated.View>
  );
}

const CARD_PADDING_TOP = 8;

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
    paddingHorizontal: HOME_CARD_INSET,
    paddingTop: CARD_PADDING_TOP,
  },
  header: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  historyLink: { paddingBottom: 4 },
  headerCopy: { flexShrink: 1, minWidth: 0, gap: 2 },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  block: { gap: 4, paddingBottom: 8 },
  fill: { flexGrow: 1 },
});
