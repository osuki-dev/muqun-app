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
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { AgentActionMenu, type AgentActionMenuItem } from '@/components/agent-action-menu';
import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { EdgeFade } from '@/components/edge-fade';
import { useEffectiveCustomTheme } from '@/components/theme-candidate';
import { ThemeIcon } from '@/components/theme-icon';
import { useMinuteNow } from '@/hooks/use-minute-now';
import { useStableHandler } from '@/hooks/use-render-refs';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { useTaskAge } from '@/hooks/use-task-age';
import { CloseIcon, NextIcon, SettingsIcon, TaskListIcon, TerminalWindowIcon } from '@/icons';
import { connectionStatusDescription } from '@/i18n/labels';
import { withAlpha } from '@/lib/color';
import { filterHomeRecent, type HomeContinueEntry } from '@/lib/home-continue';
import { wrapStageIndex } from '@/lib/home-stage-geometry';
import { stagePanels, stageSelectedIndex, type StagePanel } from '@/lib/home-stage-panels';
import { fadeIn, fadeOut, SETTLE } from '@/lib/motion';
import type { ConnectionStatus } from '@/lib/server-reachability';
import { useHomeAttention } from '@/stores/home-attention';
import { useServerAgents } from '@/stores/server-agents';
import { useServerTasksStore } from '@/stores/server-tasks';
import { isRenderableThemeAsset } from '@/theme/renderable-asset';
import { resolveThemeImage } from '@/theme/resolve';
import { StageView } from './stage-view';

export type HomeStageLayoutProps = {
  panels: readonly StagePanel[];
  selectedIndex: number;
  artworkUri?: string;
  /** Home is not on screen or the app is in the background. */
  paused: boolean;
  /** Bumped when a task completes: the sparks burst. */
  burst: number;
  topInset: number;
  /** The floating composer's height; the session strip stands above it. */
  dockHeight: number;
  /** The toolbar's buttons (top right). */
  headerAction: ReactNode;
  /** The selected computer's sessions, newest first. */
  sessions: readonly HomeContinueEntry[];
  onOpenSession: (entry: HomeContinueEntry) => void;
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
  onOpenTasks: (index: number) => void;
  onOpenDetails: (index: number) => void;
  onNewTask: () => void;
  onViewport: (height: number) => void;
};

/** Sessions shown in the strip before "All sessions". */
const STRIP_LIMIT = 6;

export type HomeStageProps = Omit<
  HomeStageLayoutProps,
  | 'panels'
  | 'selectedIndex'
  | 'sessions'
  | 'burst'
  | 'onSelect'
  | 'onOpen'
  | 'onOpenTasks'
  | 'onOpenDetails'
> & {
  servers: readonly { serverId: string; label: string }[];
  chosenServerId?: string;
  connectionStatuses: Readonly<Record<string, ConnectionStatus | undefined>>;
  recentEntries: readonly HomeContinueEntry[];
  onSelectServer: (serverId: string) => void;
  onOpenServer: (serverId: string) => void;
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
        recentEntries,
        nowMs,
      }),
    [servers, connectionStatuses, agentsByServer, attention, recentEntries, nowMs]
  );
  const selectedIndex = stageSelectedIndex(panels, chosenServerId);
  const sessions = useMemo(
    () =>
      chosenServerId ? filterHomeRecent(recentEntries, chosenServerId).slice(0, STRIP_LIMIT) : [],
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
      onOpenTasks={run(onOpenTasks)}
      onOpenDetails={run(onOpenDetails)}
    />
  );
}

/**
 * Stage: the theme's world fills the screen, and a thin 2D glass HUD carries
 * everything to read or press -- the chosen computer, its status and the page
 * dots with the tools (top), its sessions above the composer (bottom), and the
 * full list one pull away. Text never renders in 3D.
 */
export function HomeStageLayout({
  panels,
  selectedIndex,
  artworkUri,
  paused,
  burst,
  topInset,
  dockHeight,
  headerAction,
  sessions,
  onOpenSession,
  attention,
  hasAttention,
  fullList,
  emptyState,
  storageError,
  refreshing,
  onRefresh,
  onSelect,
  onOpen,
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
  const backdrop = useStageBackdrop();
  const [actionsFor, setActionsFor] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const selected = panels[selectedIndex];
  const actionsPanel = panels.find((panel) => panel.serverId === actionsFor);
  const actionsIndex = actionsPanel ? panels.indexOf(actionsPanel) : -1;

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
        panels={panels}
        selectedIndex={selectedIndex}
        backdropUri={backdrop?.uri}
        backdropFocal={backdrop?.focal}
        artworkUri={artworkUri}
        paused={paused || listOpen}
        burst={burst}
        onSelect={onSelect}
        onOpen={onOpen}
        onNewTask={onNewTask}
        onActions={(index) => {
          const panel = panels[index];
          if (panel) setActionsFor(panel.serverId);
        }}
      />

      {/* Top: the chosen computer, its status and the dots; the tools on the right. */}
      <EdgeFade
        edge="top"
        color={theme.colors.background}
        style={[styles.topScrim, { height: topInset + 150 }]}
      />
      <View pointerEvents="box-none" style={[styles.top, { paddingTop: topInset + 10 }]}>
        <View pointerEvents="box-none" style={styles.topRow}>
          {selected ? (
            <View
              testID="home-stage-hud-computer"
              accessible
              accessibilityLabel={selected.label}
              style={styles.who}>
              <Text
                variant="caption"
                weight="semibold"
                color={theme.colors.primary}
                style={styles.kicker}>
                {t`Computer`}
              </Text>
              <Text variant="heading" weight="bold" numberOfLines={1} style={styles.name}>
                {selected.label}
              </Text>
              <StageStatusLine panel={selected} />
            </View>
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
                    : { backgroundColor: withAlpha(theme.colors.text, 0.25) },
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
      <EdgeFade
        edge="bottom"
        color={theme.colors.background}
        style={[styles.bottomScrim, { height: dockHeight + 190 }]}
      />
      <View pointerEvents="box-none" style={[styles.bottom, { bottom: dockHeight + 6 }]}>
        {emptyState ? <View style={styles.empty}>{emptyState}</View> : null}
        {panels.length > 0 ? (
          <GestureDetector gesture={pull}>
            <View>
              <PressableScale
                testID="home-stage-pull"
                accessibilityRole="button"
                accessibilityLabel={hasAttention ? t`All sessions, needs you` : t`All sessions`}
                onPress={() => openList(true)}
                style={styles.handleRow}>
                <View
                  style={[styles.handle, { backgroundColor: withAlpha(theme.colors.text, 0.3) }]}
                />
                {hasAttention ? (
                  <Text variant="caption" weight="semibold" color={theme.colors.warning}>
                    {t`Needs you`}
                  </Text>
                ) : null}
              </PressableScale>
              <Animated.View
                key={selected?.serverId ?? 'none'}
                entering={fadeIn('short')}
                exiting={fadeOut('micro')}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.strip}>
                  {sessions.map((entry) => (
                    <StageSessionCard
                      key={entry.key}
                      entry={entry}
                      onPress={() => onOpenSession(entry)}
                    />
                  ))}
                  <PressableScale
                    testID="home-stage-all-sessions"
                    accessibilityRole="button"
                    accessibilityLabel={t`All sessions`}
                    onPress={() => openList(true)}
                    style={[
                      styles.card,
                      styles.moreCard,
                      {
                        backgroundColor: background(theme.colors.surface),
                        borderColor: withAlpha(theme.colors.text, 0.1),
                        borderRadius: profile.chrome.card,
                      },
                    ]}>
                    <Text variant="bodySmall" weight="semibold" color={theme.colors.primary}>
                      {t`All sessions`}
                    </Text>
                    <ThemeIcon
                      name="home.arrow"
                      fallback={NextIcon}
                      size={16}
                      color={theme.colors.primary}
                    />
                  </PressableScale>
                </ScrollView>
              </Animated.View>
            </View>
          </GestureDetector>
        ) : null}
      </View>

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
        <View style={styles.sheetHeader}>
          <Text variant="heading" accessibilityRole="header">
            {t`Sessions`}
          </Text>
          <PressableScale
            testID="home-stage-list-close"
            accessibilityRole="button"
            accessibilityLabel={t`Close`}
            hitSlop={12}
            onPress={() => openList(false)}>
            <CloseIcon size={20} color={theme.colors.textMuted} />
          </PressableScale>
        </View>
        {listOpen ? (
          <ScrollView
            contentContainerStyle={[styles.sheetContent, { paddingBottom: dockHeight + 24 }]}
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

/** The theme's far sky: `home.wallpaper`, else `shell.wallpaper`, for the current mode. */
function useStageBackdrop() {
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
  return { uri, focal: image.focalPoint };
}

function StageStatusLine({ panel }: { panel: StagePanel }) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const theme = useThemeTokens();
  const age = useTaskAge();
  const nowMs = useMinuteNow();
  const seen = panel.lastSeenMs;
  const count = panel.sessionCount;
  const offline = panel.tone === 'offline' || panel.tone === 'unknown';
  const text =
    panel.tone === 'offline' && seen !== undefined
      ? t`Offline · last seen ${age(seen, nowMs)}`
      : panel.attention
        ? t`Needs you`
        : panel.working
          ? t`Agent working`
          : panel.tone === 'online'
            ? t`Online · ${plural(count, { one: '# session', other: '# sessions' })}`
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
        color={theme.colors.textMuted}
        numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

function StageSessionCard({ entry, onPress }: { entry: HomeContinueEntry; onPress: () => void }) {
  const theme = useThemeTokens();
  const background = useSurfaceBackground();
  const profile = useAppearanceProfile();
  const age = useTaskAge();
  const nowMs = useMinuteNow();
  const when = age(entry.atMs, nowMs);
  const live = entry.observation?.status === 'working';
  return (
    <PressableScale
      testID="home-stage-session"
      accessibilityRole="button"
      accessibilityLabel={`${entry.title}, ${when}`}
      onPress={onPress}
      style={[
        styles.card,
        {
          backgroundColor: background(theme.colors.surface),
          borderColor: live
            ? withAlpha(theme.colors.primary, 0.6)
            : withAlpha(theme.colors.text, 0.1),
          borderRadius: profile.chrome.card,
        },
      ]}>
      <Text variant="bodySmall" weight="semibold" numberOfLines={1}>
        {entry.title}
      </Text>
      <Text variant="caption" color={theme.colors.textMuted} numberOfLines={1}>
        {entry.agentLabel ? `${entry.agentLabel} · ${when}` : when}
      </Text>
    </PressableScale>
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
  handle: { width: 40, height: 4, borderRadius: 2 },
  strip: { paddingHorizontal: 14, gap: 8 },
  card: {
    width: 176,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 3,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
  },
  moreCard: { width: 132, flexDirection: 'row', alignItems: 'center', gap: 6 },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, overflow: 'hidden' },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  sheetContent: { paddingHorizontal: 18, gap: 16 },
});
