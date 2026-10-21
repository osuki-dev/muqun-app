import { plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { useLingui as useLinguiRuntime } from '@lingui/react';
import { PressableScale, Text, useThemeMode, useThemeTokens } from '@osuki-dev/ui';
import * as Haptics from 'expo-haptics';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { AgentActionMenu, type AgentActionMenuItem } from '@/components/agent-action-menu';
import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { EdgeFade } from '@/components/edge-fade';
import { HomeSheetHeader, homeSheetStyles } from '@/components/home-sheet';
import { useEffectiveCustomTheme } from '@/components/theme-candidate';
import { useMinuteNow } from '@/hooks/use-minute-now';
import { useStableHandler } from '@/hooks/use-render-refs';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { useTaskAge } from '@/hooks/use-task-age';
import { CloseIcon, SettingsIcon, TaskListIcon, TerminalWindowIcon } from '@/icons';
import { connectionStatusDescription } from '@/i18n/labels';
import { withAlpha } from '@/lib/color';
import { filterHomeRecent, type HomeContinueEntry } from '@/lib/home-continue';
import { wrapStageIndex } from '@/lib/home-stage-geometry';
import { stagePanels, stageSelectedIndex, type StagePanel } from '@/lib/home-stage-panels';
import { SETTLE, timing } from '@/lib/motion';
import type { ConnectionStatus } from '@/lib/server-reachability';
import { useHomeAttention } from '@/stores/home-attention';
import { useServerAgents } from '@/stores/server-agents';
import { useServerTasksStore } from '@/stores/server-tasks';
import { isRenderableThemeAsset } from '@/theme/renderable-asset';
import { resolveThemeImage } from '@/theme/resolve';
import { StageAgentRow } from './stage-agent-row';
import { useStageComposition, type StageImageInput } from './stage-composition';
import { StageSessionStrip } from './stage-session-strip';
import { StageView } from './stage-view';
import { createStageOpener } from './types';

export type HomeStageLayoutProps = {
  panels: readonly StagePanel[];
  selectedIndex: number;
  /** `home.artwork` as Home resolved it (absent when hidden): its fit, focal point and opacity. */
  artwork?: StageImageInput;
  /** The theme's 2D Home has a cover header (`homePresentation.header`). */
  coverHeader: boolean;
  /** Home is not on screen or the app is in the background. */
  paused: boolean;
  /** Bumped when a task completes: the motes flare. */
  burst: number;
  topInset: number;
  /** The floating composer's height; the session strip stands above it. */
  dockHeight: number;
  /** The toolbar's buttons (top right). */
  headerAction: ReactNode;
  /** The selected computer's sessions, newest first. */
  sessions: readonly HomeContinueEntry[];
  /** The session the dock is talking to, by `HomeContinueEntry.key`. */
  threadKey?: string;
  /** The × on that session's card: the dock's next message starts a new conversation. */
  onClearThread?: () => void;
  onOpenSession: (entry: HomeContinueEntry) => void;
  /** Whether Home's dock can talk to a card's conversation ("Reply from Home"). */
  canReply?: (entry: HomeContinueEntry) => boolean;
  /** "Reply from Home", from a card's long-press menu. */
  onReplySession?: (entry: HomeContinueEntry) => void;
  /** Needs you, as Home builds it for every layout. */
  attention?: ReactNode;
  hasAttention: boolean;
  /** Every computer's Recent list and the connections: the pulled-up list. */
  fullList?: ReactNode;
  /** Nothing paired: Home's pairing card. */
  emptyState?: ReactNode;
  storageError?: ReactNode;
  refreshing: boolean;
  onRefresh: () => void;
  onSelect: (index: number) => void;
  onOpen: (index: number) => void;
  /** An agent's chip: its computer, at the agent's pane when known. */
  onOpenAgent: (index: number, paneId?: string) => void;
  onOpenTasks: (index: number) => void;
  onOpenDetails: (index: number) => void;
  onNewTask: () => void;
  onViewport: (height: number) => void;
};

/** Sessions shown in the strip before "All sessions". */
export const STAGE_STRIP_LIMIT = 6;

export type HomeStageProps = Omit<
  HomeStageLayoutProps,
  | 'panels'
  | 'selectedIndex'
  | 'sessions'
  | 'burst'
  | 'onSelect'
  | 'onOpen'
  | 'onOpenAgent'
  | 'onOpenTasks'
  | 'onOpenDetails'
> & {
  servers: readonly { serverId: string; label: string }[];
  chosenServerId?: string;
  connectionStatuses: Readonly<Record<string, ConnectionStatus | undefined>>;
  recentEntries: readonly HomeContinueEntry[];
  onSelectServer: (serverId: string) => void;
  /** Open a computer; at `paneId` when an agent's chip was tapped. */
  onOpenServer: (serverId: string, paneId?: string) => void;
  onOpenTasks: (serverId: string) => void;
  onOpenDetails: (serverId: string) => void;
};

/**
 * Reads the stage's per-computer facts from the stores Home already keeps
 * (mirrored agents, attention, the task ledgers) here rather than in
 * `HomeOverview`, so those subscriptions re-render only the Stage. Nothing is
 * fetched or written: every layout reads the same state.
 */
export function HomeStage({
  servers,
  chosenServerId,
  connectionStatuses,
  recentEntries,
  onSelectServer,
  onOpenServer,
  onOpenTasks,
  onOpenDetails,
  ...layout
}: HomeStageProps) {
  const agentsByServer = useServerAgents((state) => state.byServer);
  const attention = useHomeAttention((state) => state.byTarget);
  const tasks = useServerTasksStore((state) => state.index);
  const nowMs = useMinuteNow();
  // The newest finished task across the ledgers Home keeps: a later one is a completion.
  const latestDoneMs = useServerTasksStore((state) => {
    let latest = 0;
    for (const entry of Object.values(state.index))
      for (const task of entry?.tasks ?? [])
        if (task.state === 'done' && task.updatedMs > latest) latest = task.updatedMs;
    return latest;
  });
  const seenDoneMs = useRef<number | null>(null);
  const [burst, setBurst] = useState(0);
  useEffect(() => {
    if (seenDoneMs.current === null) {
      seenDoneMs.current = latestDoneMs;
      return;
    }
    if (latestDoneMs <= seenDoneMs.current) return;
    seenDoneMs.current = latestDoneMs;
    setBurst((count) => count + 1);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [latestDoneMs]);
  const panels = useMemo(
    () =>
      stagePanels({
        servers,
        connectionStatuses,
        agentsByServer,
        attention,
        tasks,
        recentEntries,
        nowMs,
      }),
    [servers, connectionStatuses, agentsByServer, attention, tasks, recentEntries, nowMs]
  );
  const selectedIndex = stageSelectedIndex(panels, chosenServerId);
  const sessions = useMemo(
    () =>
      chosenServerId
        ? filterHomeRecent(recentEntries, chosenServerId).slice(0, STAGE_STRIP_LIMIT)
        : [],
    [recentEntries, chosenServerId]
  );
  const at = (index: number) => panels[wrapStageIndex(index, panels.length)]?.serverId;
  const run = (action: (serverId: string) => void) => (index: number) => {
    const serverId = at(index);
    if (serverId) action(serverId);
  };
  return (
    <HomeStageLayout
      {...layout}
      panels={panels}
      selectedIndex={selectedIndex}
      sessions={sessions}
      burst={burst}
      onSelect={run(onSelectServer)}
      onOpen={run(onOpenServer)}
      onOpenAgent={(index, paneId) => {
        const serverId = at(index);
        if (serverId) onOpenServer(serverId, paneId);
      }}
      onOpenTasks={run(onOpenTasks)}
      onOpenDetails={run(onOpenDetails)}
    />
  );
}

/**
 * Stage: the theme's world fills the screen, and a thin 2D HUD carries
 * everything to read or press -- the chosen computer, its status and the page
 * dots with the tools (top; a tap opens the computer, a long press offers its
 * actions), its agents and its sessions above the composer (bottom), and the
 * full list one pull away. Text never renders in 3D.
 */
export function HomeStageLayout({
  panels,
  selectedIndex,
  artwork,
  coverHeader,
  paused,
  burst,
  topInset,
  dockHeight,
  headerAction,
  sessions,
  threadKey,
  onClearThread,
  onOpenSession,
  canReply,
  onReplySession,
  attention,
  hasAttention,
  fullList,
  emptyState,
  storageError,
  refreshing,
  onRefresh,
  onSelect,
  onOpen,
  onOpenAgent,
  onOpenTasks,
  onOpenDetails,
  onNewTask,
  onViewport,
}: HomeStageLayoutProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const background = useSurfaceBackground();
  const profile = useAppearanceProfile();
  const { height: windowHeight } = useWindowDimensions();
  const wallpaper = useStageWallpaper();
  const composition = useStageComposition({ coverHeader, artwork, wallpaper });
  // A cover's authored sky stays open: a short, soft scrim, and the HUD's text
  // reads on the art itself through a halo in the background colour.
  const openSky = composition.role === 'sky' || composition.role === 'figure';
  const halo = useStageTextHalo();
  const [actionsFor, setActionsFor] = useState<string | null>(null);
  // A long-press on a Stage card makes it the dock's conversation directly:
  // it is the only thing a long-press does here, so it needs no menu.
  const replyToCard = useStableHandler((entry: HomeContinueEntry) => {
    if (!canReply?.(entry)) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onReplySession?.(entry);
  });
  const [listOpen, setListOpen] = useState(false);
  const [opener] = useState(createStageOpener);
  const selected = panels[selectedIndex];
  // The foot rows' height above the dock, measured: the art stands on them.
  const [footStack, setFootStack] = useState(0);
  const foot = footStack > 0 ? dockHeight + 6 + footStack : 0;
  const openComputer = useStableHandler(() => opener.open(() => onOpen(selectedIndex)));
  const actionsPanel = panels.find((panel) => panel.serverId === actionsFor);
  const actionsIndex = actionsPanel ? panels.indexOf(actionsPanel) : -1;

  // The HUD's foot rides the dock: when the dock grows (Home's conversation
  // strip arriving) or shrinks, the session strip moves with it rather than
  // jumping a frame later.
  const dockLift = useSharedValue(dockHeight);
  useEffect(() => {
    dockLift.set(withTiming(dockHeight, timing('short')));
  }, [dockHeight, dockLift]);
  const footStyle = useAnimatedStyle(() => ({ bottom: dockLift.get() + 6 }));
  const footScrimStyle = useAnimatedStyle(() => ({ height: dockLift.get() + 230 }));

  const sheet = useSharedValue(0);
  const openList = useStableHandler((open: boolean) => {
    setListOpen(open);
    sheet.set(withSpring(open ? 1 : 0, SETTLE));
  });
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - sheet.get()) * windowHeight }],
  }));
  // A pull up on the HUD's foot raises the full list.
  const pull = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY([-12, 12])
        .failOffsetX([-12, 12])
        .onEnd((event) => {
          if (event.translationY < -36 || event.velocityY < -500) scheduleOnRN(openList, true);
        }),
    [openList]
  );

  const act = (run: (index: number) => void) => () => {
    setActionsFor(null);
    run(actionsIndex);
  };
  const menuItems: AgentActionMenuItem[] =
    actionsIndex < 0
      ? []
      : [
          {
            id: 'open',
            label: t`Open`,
            Icon: TerminalWindowIcon,
            onPress: act(onOpen),
            testID: 'home-stage-action-open',
          },
          { id: 'tasks', label: t`Tasks`, Icon: TaskListIcon, onPress: act(onOpenTasks) },
          {
            id: 'details',
            label: t`Computer details`,
            Icon: SettingsIcon,
            onPress: act(onOpenDetails),
          },
          {
            id: 'close',
            label: t`Close menu`,
            Icon: CloseIcon,
            onPress: () => setActionsFor(null),
          },
        ];

  return (
    <View
      testID="home-stage-layout"
      style={[styles.root, { backgroundColor: theme.colors.background }]}
      onLayout={(event: LayoutChangeEvent) => onViewport(event.nativeEvent.layout.height)}>
      <StageView
        count={panels.length}
        selectedIndex={selectedIndex}
        composition={composition}
        wallpaperUri={wallpaper?.uri}
        artworkUri={artwork?.uri}
        inset={topInset}
        foot={foot}
        paused={paused || listOpen}
        burst={burst}
        opener={opener}
        onSelect={onSelect}
        onNewTask={onNewTask}
      />

      {/* Top: the chosen computer, its status and the dots; the tools on the right. */}
      {openSky ? (
        <View
          pointerEvents="none"
          style={[
            styles.topScrim,
            {
              height: topInset + 112,
              experimental_backgroundImage: `linear-gradient(to bottom, ${withAlpha(theme.colors.background, 0.5)} 0%, ${withAlpha(theme.colors.background, 0.3)} 50%, ${withAlpha(theme.colors.background, 0)} 100%)`,
            },
          ]}
        />
      ) : (
        <EdgeFade
          edge="top"
          color={theme.colors.background}
          style={[styles.topScrim, { height: topInset + 150 }]}
        />
      )}
      <View pointerEvents="box-none" style={[styles.top, { paddingTop: topInset + 10 }]}>
        <View pointerEvents="box-none" style={styles.topRow}>
          {selected ? (
            <StageHeaderButton
              panel={selected}
              index={selectedIndex}
              total={panels.length}
              onOpen={openComputer}
              onActions={() => setActionsFor(selected.serverId)}
              onSelect={onSelect}>
              <Text
                variant="caption"
                weight="semibold"
                color={theme.colors.primary}
                style={[styles.kicker, halo]}>
                {t`Computer`}
              </Text>
              <Text variant="heading" weight="bold" numberOfLines={1} style={[styles.name, halo]}>
                {selected.label}
              </Text>
              <StageStatusLine panel={selected} halo={halo} />
            </StageHeaderButton>
          ) : (
            <View />
          )}
          {headerAction}
        </View>
        {panels.length > 1 ? (
          <View style={styles.dots} accessible={false}>
            {panels.map((panel, index) => (
              <View
                key={panel.serverId}
                style={[
                  styles.dash,
                  index === selectedIndex
                    ? { width: 30, backgroundColor: theme.colors.primary }
                    : { backgroundColor: withAlpha(theme.colors.text, 0.32) },
                ]}
              />
            ))}
          </View>
        ) : null}
      </View>
      {actionsPanel ? (
        <View style={[styles.menu, { top: topInset + 120 }]}>
          <AgentActionMenu testID="home-stage-actions" items={menuItems} />
        </View>
      ) : null}
      {storageError ? (
        <View style={[styles.center, { top: topInset + 130 }]}>{storageError}</View>
      ) : null}

      {/* Bottom: a scrim, the handle and the selected computer's sessions, above the composer. */}
      <Animated.View pointerEvents="none" style={[styles.bottomScrim, footScrimStyle]}>
        <EdgeFade edge="bottom" color={theme.colors.background} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <Animated.View
        pointerEvents="box-none"
        style={[styles.bottom, footStyle]}
        onLayout={(event) => setFootStack(Math.round(event.nativeEvent.layout.height))}>
        {emptyState ? <View style={styles.empty}>{emptyState}</View> : null}
        {panels.length > 0 ? (
          <StageAgentRow
            panel={selected}
            paused={paused || listOpen}
            onOpenAgent={(chip) => opener.open(() => onOpenAgent(selectedIndex, chip.paneId))}
          />
        ) : null}
        {panels.length > 0 ? (
          <GestureDetector gesture={pull}>
            <View>
              {/* No grabber of its own: the dock's is the one handle on Home,
                  and it raises the conversation. The list is the strip's
                  "All sessions" card, or a pull up on the strip. */}
              {hasAttention ? (
                <PressableScale
                  testID="home-stage-pull"
                  accessibilityRole="button"
                  accessibilityLabel={t`All sessions, needs you`}
                  onPress={() => openList(true)}
                  style={styles.handleRow}>
                  <Text variant="caption" weight="semibold" color={theme.colors.warning}>
                    {t`Needs you`}
                  </Text>
                </PressableScale>
              ) : null}
              <StageSessionStrip
                serverId={selected?.serverId}
                selectedIndex={selectedIndex}
                panelCount={panels.length}
                sessions={sessions}
                threadKey={threadKey}
                onClearThread={onClearThread}
                onOpenSession={onOpenSession}
                onSessionActions={onReplySession ? replyToCard : undefined}
                onOpenAll={() => openList(true)}
              />
            </View>
          </GestureDetector>
        ) : null}
      </Animated.View>

      {/* The full list, pulled up over the stage: the existing list UI. */}
      <Animated.View
        pointerEvents={listOpen ? 'auto' : 'none'}
        accessibilityElementsHidden={!listOpen}
        importantForAccessibility={listOpen ? 'auto' : 'no-hide-descendants'}
        style={[
          styles.sheet,
          {
            top: topInset + 48,
            backgroundColor: background(theme.colors.background),
            borderTopLeftRadius: profile.chrome.sheet,
            borderTopRightRadius: profile.chrome.sheet,
          },
          sheetStyle,
        ]}>
        <HomeSheetHeader
          title={t`Sessions`}
          closeTestID="home-stage-list-close"
          onClose={() => openList(false)}
        />
        {listOpen ? (
          <ScrollView
            contentContainerStyle={[homeSheetStyles.content, { paddingBottom: dockHeight + 24 }]}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={theme.colors.primary}
              />
            }>
            {attention}
            {fullList}
          </ScrollView>
        ) : null}
      </Animated.View>
    </View>
  );
}

/** The theme's wallpaper: `home.wallpaper`, else `shell.wallpaper`, for the current mode. */
function useStageWallpaper() {
  const { resolvedMode } = useThemeMode();
  const { width } = useWindowDimensions();
  const { theme, assets } = useEffectiveCustomTheme();
  if (!theme || !assets) return null;
  const image = resolveThemeImage(
    theme.manifest,
    'home.wallpaper',
    resolvedMode,
    width >= 768 ? 'regular' : 'compact',
    true,
    'shell.wallpaper'
  );
  const uri = image ? assets[image.asset] : undefined;
  if (!image || !uri || !isRenderableThemeAsset(uri)) return null;
  return { uri, fit: image.fit, focal: image.focalPoint, opacity: image.opacity };
}

/**
 * A soft glow in the background colour behind the HUD's text, so it reads on
 * a bright sky by day and a dark one by night without a plate.
 */
function useStageTextHalo() {
  const theme = useThemeTokens();
  const { resolvedMode } = useThemeMode();
  return {
    textShadowColor: withAlpha(theme.colors.background, resolvedMode === 'light' ? 0.9 : 0.75),
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  };
}

/**
 * The computer's name and status as one control: a tap opens the computer, a
 * long press offers its actions. The screen reader hears its name, status,
 * sessions and place among the computers, and adjusts it to move between
 * them.
 */
function StageHeaderButton({
  panel,
  index,
  total,
  onOpen,
  onActions,
  onSelect,
  children,
}: {
  panel: StagePanel;
  index: number;
  total: number;
  onOpen: () => void;
  onActions: () => void;
  onSelect: (index: number) => void;
  children: ReactNode;
}) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const status = _(connectionStatusDescription[panel.connection]);
  const count = panel.sessionCount;
  const sessions = t`${plural(count, { one: '# session', other: '# sessions' })}`;
  const position = total > 1 ? `, ${t`${index + 1} of ${total}`}` : '';
  return (
    <PressableScale
      testID="home-stage-hud-computer"
      accessibilityRole={total > 1 ? 'adjustable' : 'button'}
      accessibilityLabel={`${panel.label}, ${status}, ${sessions}${position}`}
      accessibilityHint={t`Opens this computer.`}
      accessibilityActions={[
        ...(total > 1 ? [{ name: 'increment' }, { name: 'decrement' }] : []),
        { name: 'longpress', label: t`Actions` },
      ]}
      onAccessibilityAction={(event) => {
        const action = event.nativeEvent.actionName;
        if (action === 'longpress') onActions();
        else if (action === 'increment' && index < total - 1) onSelect(index + 1);
        else if (action === 'decrement' && index > 0) onSelect(index - 1);
      }}
      onPress={onOpen}
      onLongPress={onActions}
      style={styles.who}>
      {children}
    </PressableScale>
  );
}

/**
 * What the selected computer is doing, in one line: online, offline since
 * when, an agent working, or how many things need the reader, in the warning
 * colour. Its sessions are the strip's to show.
 */
function StageStatusLine({
  panel,
  halo,
}: {
  panel: StagePanel;
  halo: ReturnType<typeof useStageTextHalo>;
}) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const theme = useThemeTokens();
  const age = useTaskAge();
  const nowMs = useMinuteNow();
  const seen = panel.lastSeenMs;
  const waiting = Math.max(1, panel.needsYouCount);
  const offline = panel.tone === 'offline' || panel.tone === 'unknown';
  const text =
    panel.tone === 'offline' && seen !== undefined
      ? t`Offline · last seen ${age(seen, nowMs)}`
      : panel.attention
        ? t`${plural(waiting, { one: '# needs you', other: '# need you' })}`
        : panel.working
          ? t`Agent working`
          : panel.tone === 'online'
            ? t`Online`
            : _(connectionStatusDescription[panel.connection]);
  const color =
    panel.attention || panel.tone === 'warning'
      ? theme.colors.warning
      : panel.working
        ? theme.colors.primary
        : offline
          ? theme.colors.textMuted
          : theme.colors.success;
  return (
    <View style={styles.statusRow}>
      <View style={[styles.statusDot, { backgroundColor: color, shadowColor: color }]} />
      <Text
        testID="home-stage-hud-status"
        variant="caption"
        weight={panel.attention ? 'semibold' : undefined}
        color={panel.attention ? theme.colors.warning : theme.colors.text}
        numberOfLines={1}
        style={halo}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  topScrim: { position: 'absolute', left: 0, right: 0, top: 0 },
  top: { position: 'absolute', left: 0, right: 0, top: 0, paddingHorizontal: 20, gap: 14 },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  who: { flexShrink: 1, gap: 3 },
  kicker: { letterSpacing: 1.6, textTransform: 'uppercase', fontSize: 10 },
  name: { fontSize: 32, lineHeight: 36, letterSpacing: -0.6 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    shadowOpacity: 0.9,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  dots: { flexDirection: 'row', gap: 6 },
  dash: { width: 18, height: 3, borderRadius: 2 },
  menu: { position: 'absolute', left: 16, right: 16 },
  center: { position: 'absolute', left: 16, right: 16 },
  bottomScrim: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  bottom: { position: 'absolute', left: 0, right: 0, gap: 8 },
  empty: { paddingHorizontal: 16 },
  handleRow: {
    alignSelf: 'center',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 24,
  },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, overflow: 'hidden' },
});
