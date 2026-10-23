import {
  NO_SIDE_INSETS,
  SideBleedProvider,
  sideInsetPadding,
  type SideInsets,
} from '@/hooks/use-side-insets';
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
import { useKeyboardState, useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
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
import { HomeSheetGrabber, HomeSheetHeader, homeSheetStyles } from '@/components/home-sheet';
import { useEffectiveCustomTheme } from '@/components/theme-candidate';
import { useMinuteNow } from '@/hooks/use-minute-now';
import { useLatestReader, useStableHandler } from '@/hooks/use-render-refs';
import { useStructuralValue } from '@/hooks/use-structural-value';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { useTaskAge } from '@/hooks/use-task-age';
import { CloseIcon, SettingsIcon, TaskListIcon, TerminalWindowIcon } from '@/icons';
import { connectionStatusDescription } from '@/i18n/labels';
import { withAlpha } from '@/lib/color';
import { filterHomeRecent, type HomeContinueEntry } from '@/lib/home-continue';
import type { HomeTaskRow } from '@/lib/home-in-progress';
import type { HomeTarget } from '@/lib/home-recents';
import { wrapStageIndex, type StageOverlayBand } from '@/lib/home-stage-geometry';
import { stageProgressSession } from '@/lib/stage-progress-session';
import type { StageProgress } from '@/lib/stage-overlay';
import { stagePanels, stageSelectedIndex, type StagePanel } from '@/lib/home-stage-panels';
import { HOME_DOCK_OUTER_INSET } from '@/lib/home-pad-geometry';
import { fadeIn, fadeOut, SETTLE, timing } from '@/lib/motion';
import type { ConnectionStatus } from '@/lib/server-reachability';
import { useHomeAgentSessions } from '@/stores/home-agent-sessions';
import { useHomeAttention } from '@/stores/home-attention';
import { useServerAgents } from '@/stores/server-agents';
import { useServerTasksStore } from '@/stores/server-tasks';
import { isRenderableThemeAsset } from '@/theme/renderable-asset';
import { resolveThemeImage } from '@/theme/resolve';
import { STAGE_AGENT_ROW_HEIGHT, StageAgentRow } from './stage-agent-row';
import { StageOverlay } from './stage-overlay';
import { StageSubtitle } from './stage-subtitle';
import { useStageComposition, type StageImageInput } from './stage-composition';
import { StageSessionStrip } from './stage-session-strip';
import { useStageTextHalo, type StageTextHalo } from './stage-text-halo';
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
  /**
   * The side safe areas: the HUD, the foot rows and the pulled-up list keep
   * clear of them (iPhone Duo's status bar runs down the right edge), while
   * the world and its scrims still fill the window.
   */
  sideInsets?: SideInsets;
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
  onOpenAgent: (index: number, paneId?: string, sessionId?: string) => void;
  onOpenTasks: (index: number) => void;
  onOpenDetails: (index: number) => void;
  /** The needs-you card's View: a session's conversation, as Needs you opens it. */
  onOpenRequest: (target: HomeTarget) => void;
  /** The needs-you card's View on a waiting ledger task, as Needs you opens it. */
  onOpenWaitingTask: (row: HomeTaskRow) => void;
  /** A double tap on the art: a new task on the composer's computer. */
  onNewTask?: () => void;
  onViewport: (height: number) => void;
};

/** The HUD's margin from the safe edges. */
const HUD_GUTTER = 20;

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
  onOpenServer: (serverId: string, paneId?: string, sessionId?: string) => void;
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
  // Rebuilt on every task frame, pane mirror pass and minute; kept by identity
  // while nothing shown changed, so the Stage below can skip the render.
  const built = useMemo(
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
  const panels = useStructuralValue(built);
  const selectedIndex = stageSelectedIndex(panels, chosenServerId);
  const sessions = useMemo(
    () => (chosenServerId ? filterHomeRecent(recentEntries, chosenServerId) : []),
    [recentEntries, chosenServerId]
  );
  // Stable across renders, so a store update here does not re-render the GPU
  // scene through fresh callbacks; each reads the panels as last rendered.
  const readPanels = useLatestReader(panels);
  const at = (index: number) => {
    const current = readPanels();
    return current[wrapStageIndex(index, current.length)]?.serverId;
  };
  const select = useStableHandler((index: number) => {
    const serverId = at(index);
    if (serverId) onSelectServer(serverId);
  });
  const open = useStableHandler((index: number) => {
    const serverId = at(index);
    if (serverId) onOpenServer(serverId);
  });
  const openAgent = useStableHandler((index: number, paneId?: string, sessionId?: string) => {
    const serverId = at(index);
    if (serverId) onOpenServer(serverId, paneId, sessionId);
  });
  const openTasks = useStableHandler((index: number) => {
    const serverId = at(index);
    if (serverId) onOpenTasks(serverId);
  });
  const openDetails = useStableHandler((index: number) => {
    const serverId = at(index);
    if (serverId) onOpenDetails(serverId);
  });
  return (
    <HomeStageLayout
      {...layout}
      panels={panels}
      selectedIndex={selectedIndex}
      sessions={sessions}
      burst={burst}
      onSelect={select}
      onOpen={open}
      onOpenAgent={openAgent}
      onOpenTasks={openTasks}
      onOpenDetails={openDetails}
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
  sideInsets = NO_SIDE_INSETS,
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
  onOpenRequest,
  onOpenWaitingTask,
  onNewTask,
  onViewport,
}: HomeStageLayoutProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const background = useSurfaceBackground();
  const profile = useAppearanceProfile();
  const { height: windowHeight, fontScale } = useWindowDimensions();
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
  // Where the needs-you card and the progress subtitle stand, as the Stage measured it.
  const [band, setBand] = useState<StageOverlayBand | null>(null);
  // A waiting request takes the art; only without one does the subtitle show.
  const [waiting, setWaiting] = useState(false);
  const openRequest = useStableHandler((target: HomeTarget) =>
    opener.open(() => onOpenRequest(target))
  );
  const openWaitingTask = useStableHandler((row: HomeTaskRow) =>
    opener.open(() => onOpenWaitingTask(row))
  );
  const openPane = useStableHandler((paneId?: string, sessionId?: string) =>
    opener.open(() => onOpenAgent(selectedIndex, paneId, sessionId))
  );
  // Resolve against all sessions, not only the six cards in the strip.
  // A gateway-reported terminal association opens its conversation first.
  const stripSessions = useMemo(() => sessions.slice(0, STAGE_STRIP_LIMIT), [sessions]);
  const openProgress = useStableHandler((line: StageProgress) => {
    if (!selected) return;
    const serverId = selected.serverId;
    const entry = stageProgressSession({
      line,
      serverId,
      entries: sessions,
      sessions: useHomeAgentSessions.getState().byServer[serverId],
      sessionsSeenAtMs: useHomeAgentSessions.getState().seenAtMs[serverId],
      panes: useServerAgents.getState().byServer[serverId],
      nowMs: Date.now(),
    });
    if (entry) opener.open(() => onOpenSession(entry));
    else if (line.key.startsWith('pane:'))
      openPane(line.key.slice('pane:'.length), line.terminal?.sessionId);
  });
  const actionsPanel = panels.find((panel) => panel.serverId === actionsFor);
  const actionsIndex = actionsPanel ? panels.indexOf(actionsPanel) : -1;

  // The dock lays out at its measured height immediately. Its neighbours must
  // use that same height, without a second animation trailing a new reply header.
  // While typing, the strip rides up with the composer on the keyboard's own
  // motion and sits right above it; the rows over it step aside.
  const { height: keyboardOffset } = useReanimatedKeyboardAnimation();
  const keyboardHeight = useKeyboardState((state) => state.height);
  const typing = keyboardHeight > 0;
  // The art's free height above the foot: subtitles stack upward into it.
  const subtitleRoom = Math.max(0, windowHeight - keyboardHeight - dockHeight - topInset - 240);
  const subtitleRows = Math.min(5, Math.floor(subtitleRoom / Math.max(48, 36 * fontScale + 16)));
  const footStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: keyboardOffset.get() }],
  }));
  const footScrimStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: keyboardOffset.get() }],
  }));

  const sheet = useSharedValue(0);
  const openList = useStableHandler((open: boolean) => {
    setListOpen(open);
    sheet.set(withSpring(open ? 1 : 0, SETTLE));
  });
  const overlayActions = useMemo(
    () => ({
      onOpenRequest: openRequest,
      onOpenTask: openWaitingTask,
      onOpenPane: openPane,
      onOpenList: () => openList(true),
    }),
    [openRequest, openWaitingTask, openPane, openList]
  );
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
        onOverlayBand={setBand}
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
      <View
        pointerEvents="box-none"
        style={[
          styles.top,
          { paddingTop: topInset + 10 },
          sideInsetPadding(sideInsets, HUD_GUTTER),
        ]}>
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
        <View
          style={[
            styles.menu,
            { top: topInset + 120, left: 16 + sideInsets.left, right: 16 + sideInsets.right },
          ]}>
          <AgentActionMenu testID="home-stage-actions" items={menuItems} />
        </View>
      ) : null}
      {storageError ? (
        <View
          style={[
            styles.center,
            { top: topInset + 130, left: 16 + sideInsets.left, right: 16 + sideInsets.right },
          ]}>
          {storageError}
        </View>
      ) : null}

      {/* Bottom: a scrim, the handle and the selected computer's sessions, above the composer. */}
      <Animated.View
        pointerEvents="none"
        style={[styles.bottomScrim, { height: dockHeight + 230 }, footScrimStyle]}>
        <EdgeFade edge="bottom" color={theme.colors.background} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <Animated.View
        pointerEvents="box-none"
        style={[styles.bottom, { bottom: dockHeight + 6 }, sideInsetPadding(sideInsets), footStyle]}
        onLayout={(event) => {
          // The art stands on the resting foot, not on the subtitles' room
          // above it: the rows stepping aside while typing do not move it.
          if (!typing)
            setFootStack(
              Math.round(event.nativeEvent.layout.height - (panels.length > 0 ? subtitleRoom : 0))
            );
        }}>
        <SideBleedProvider value={sideInsets}>
          {emptyState ? <View style={styles.empty}>{emptyState}</View> : null}
          {panels.length > 0 ? (
            <Animated.View
              pointerEvents="box-none"
              entering={fadeIn('short')}
              exiting={fadeOut('short')}>
              <StageFootLine
                serverId={selected?.serverId}
                compact={typing}
                maxRows={subtitleRows}
                room={subtitleRoom}
                subtitle={!paused && !listOpen && !waiting}
                onOpen={openProgress}>
                {(hidden) => (
                  <StageAgentRow
                    panel={selected}
                    paused={paused || listOpen}
                    hidden={hidden}
                    onOpenAgent={(chip) =>
                      opener.open(() => onOpenAgent(selectedIndex, chip.paneId))
                    }
                  />
                )}
              </StageFootLine>
            </Animated.View>
          ) : null}
          {panels.length > 0 ? (
            <GestureDetector gesture={pull}>
              <View>
                {typing ? null : (
                  <Animated.View entering={fadeIn('short')} exiting={fadeOut('short')}>
                    <PressableScale
                      testID="home-stage-pull"
                      accessibilityRole="button"
                      accessibilityLabel={
                        hasAttention ? t`All sessions, needs you` : t`All sessions`
                      }
                      onPress={() => openList(true)}
                      style={styles.handleRow}>
                      <HomeSheetGrabber />
                      {hasAttention ? (
                        <Text variant="caption" weight="semibold" color={theme.colors.warning}>
                          {t`Needs you`}
                        </Text>
                      ) : null}
                    </PressableScale>
                  </Animated.View>
                )}
                <StageSessionStrip
                  serverId={selected?.serverId}
                  selectedIndex={selectedIndex}
                  panelCount={panels.length}
                  sessions={stripSessions}
                  threadKey={threadKey}
                  onClearThread={onClearThread}
                  onOpenSession={onOpenSession}
                  onSessionActions={onReplySession ? replyToCard : undefined}
                  onOpenAll={() => openList(true)}
                />
              </View>
            </GestureDetector>
          ) : null}
        </SideBleedProvider>
      </Animated.View>

      {/* Over the art, on the foot rows: what needs the reader, else what an agent reports. */}
      {selected && band && !paused && !listOpen && !typing ? (
        <StageOverlay
          serverId={selected.serverId}
          band={band}
          sideInsets={sideInsets}
          actions={overlayActions}
          onWaitingChange={setWaiting}
        />
      ) : null}

      {/* The full list, pulled up over the stage: the existing list UI. */}
      <Animated.View
        pointerEvents={listOpen ? 'auto' : 'none'}
        accessibilityElementsHidden={!listOpen}
        importantForAccessibility={listOpen ? 'auto' : 'no-hide-descendants'}
        style={[
          styles.sheet,
          {
            top: topInset + 48,
            ...sideInsetPadding(sideInsets),
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
function StageStatusLine({ panel, halo }: { panel: StagePanel; halo: StageTextHalo }) {
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

/**
 * The agent chips' row, or over it what working agents report. The row keeps
 * the chips' height whether or not subtitles show, so the foot the art stands
 * on never moves: the subtitles float, anchored to the row's bottom, the first
 * in the chips' place and more growing upward over the art, while the chips
 * fade out under them and back when they go. While typing the row folds away
 * so the strip sits on the composer, and up to two one-line subtitles float
 * above the strip.
 */
function StageFootLine({
  serverId,
  subtitle,
  compact,
  maxRows,
  room,
  onOpen,
  children,
}: {
  serverId: string | undefined;
  subtitle: boolean;
  compact: boolean;
  maxRows: number;
  /** Height above the row the subtitles may grow into, held in layout whether or not they show. */
  room: number;
  onOpen: (line: StageProgress) => void;
  /** The row's content, told whether the row is hidden (covered or folded) so its motion can rest. */
  children: (hidden: boolean) => ReactNode;
}) {
  const [shown, setShown] = useState(false);
  const covered = subtitle && shown;
  // Two fades on one row: the chips go under a subtitle, and the whole row
  // folds to nothing while typing, its height easing so the strip glides up
  // with the keyboard instead of jumping a row in one frame.
  const chips = useSharedValue(covered ? 0 : 1);
  const fold = useSharedValue(compact ? 0 : 1);
  useEffect(() => {
    chips.set(withTiming(covered ? 0 : 1, timing('short')));
  }, [chips, covered]);
  useEffect(() => {
    fold.set(withTiming(compact ? 0 : 1, timing('short')));
  }, [fold, compact]);
  const rowStyle = useAnimatedStyle(() => ({
    height: STAGE_AGENT_ROW_HEIGHT * fold.get(),
    opacity: chips.get() * fold.get(),
  }));
  const hidden = covered || compact;
  // The row's box spans the room above it: Android drops views drawn outside
  // their parent's bounds from accessibility and hit testing, so the floating
  // lines must stay inside it.
  return (
    <View pointerEvents="box-none" style={{ paddingTop: room }}>
      <Animated.View
        pointerEvents={hidden ? 'none' : 'box-none'}
        accessibilityElementsHidden={hidden}
        importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
        style={[styles.footRow, rowStyle]}>
        {children(hidden)}
      </Animated.View>
      {serverId && subtitle && maxRows > 0 ? (
        <View pointerEvents="box-none" style={styles.footLine}>
          <StageSubtitle
            key={serverId}
            serverId={serverId}
            compact={compact}
            maxRows={maxRows}
            onShownChange={setShown}
            onOpen={onOpen}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  topScrim: { position: 'absolute', left: 0, right: 0, top: 0 },
  top: { position: 'absolute', left: 0, right: 0, top: 0, gap: 14 },
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
  footRow: { overflow: 'hidden' },
  footLine: {
    position: 'absolute',
    left: HOME_DOCK_OUTER_INSET,
    right: HOME_DOCK_OUTER_INSET,
    top: 0,
    bottom: 0,
    justifyContent: 'flex-end',
  },
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
