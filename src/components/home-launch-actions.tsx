import { HOME_TOOLBAR_PAIR_WIDTH, HOME_TOOLBAR_ICON_INSET } from '@/constants/home-toolbar';
import { homeDockTargetId } from '@/lib/home-composer';
import { useLingui as useLinguiRuntime } from '@lingui/react';
import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import {
  ArrowUpRight,
  ChevronDown,
  Link,
  MessagesSquare,
  Play,
  SquareTerminal,
} from 'lucide-react-native';
import { useIsFocused, useRouter } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { AgentMark } from '@/components/agent-mark';
import { PressableScale } from '@/components/pressable-scale';
import { Text } from '@/components/text';
import { ThemeIcon } from '@/components/theme-icon';
import { useAppActive } from '@/hooks/use-app-active';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { isDemoRecord } from '@/lib/demo-gateway';
import { refreshAgentServerDiscovery } from '@/lib/home-agent-readiness';
import {
  buildLaunchModel,
  groupLaunchCells,
  LAUNCH_GRID_GAP,
  launchGridCellStyle,
  launchRowLayout,
  type LaunchEntry,
} from '@/lib/home-launch-model';
import { useAgents } from '@/stores/agents';
import { PRESS, timing } from '@/lib/motion';
import type { GatewayRecord } from '@/lib/gateway-storage';
import { agentLaunchCaption, connectionStatusDescription } from '@/i18n/labels';
import {
  reachabilityOfStatus,
  type ConnectionStatus,
  type ServerReachability,
} from '@/lib/server-reachability';
import { useHomeTargetPicker } from '@/stores/home-target-picker';
import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { settleAfter } from '@/lib/compiler-safe-control-flow';
import { HOME_CONTINUE_REFRESH_MS, homeRefreshDue } from '@/lib/home-refresh-schedule';
import { useServerChannels } from '@/stores/server-channels';

/** Minimum row height shared by phone and Pad; labels can grow with text size. */
const DOCK_ROW_HEIGHT = 56;

/** Target choice is local to Home; a selection alone never switches a live connection. */
export function useHomeLaunchController({
  servers,
  selectedServerId,
  connectionStatuses,
  reachabilityByServer,
  onPair,
}: {
  servers: readonly GatewayRecord[];
  selectedServerId?: string;
  connectionStatuses: Readonly<Record<string, ConnectionStatus | undefined>>;
  reachabilityByServer: Readonly<Record<string, ServerReachability | undefined>>;
  onPair: () => Promise<unknown>;
}) {
  const router = useRouter();
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [pickerRequestId, setPickerRequestId] = useState<number | null>(null);
  // This is visual feedback only; the shared command controller owns the
  // operation guard across layouts, buttons, and unmounts.
  const [opening, setOpening] = useState(false);
  const reduceMotion = useReducedMotion();
  const pickerOpen = useSharedValue(0);
  const pickerOpenRequestId = useHomeTargetPicker((state) => state.openRequestId);
  const pickerCompletedRequestId = useHomeTargetPicker((state) => state.completedRequestId);
  const pickerCompletedServerId = useHomeTargetPicker((state) => state.completedServerId);
  const beginPicker = useHomeTargetPicker((state) => state.begin);
  const updatePickerReachability = useHomeTargetPicker((state) => state.updateReachability);
  const returnedServerId =
    pickerRequestId !== null && pickerCompletedRequestId === pickerRequestId
      ? pickerCompletedServerId
      : null;
  const chosenTargetId = homeDockTargetId({
    serverIds: servers.map((server) => server.serverId),
    pickedId: returnedServerId ?? chosenId,
    ...(selectedServerId ? { selectedId: selectedServerId } : {}),
  });
  const chosen = servers.find((server) => server.serverId === chosenTargetId);
  const chosenConnection = chosen ? (connectionStatuses[chosen.serverId] ?? 'unknown') : undefined;
  const chosenOffline = reachabilityOfStatus(chosenConnection ?? 'unknown') === 'offline';

  useEffect(() => {
    if (pickerRequestId === null || pickerCompletedRequestId !== pickerRequestId) return;
    if (pickerCompletedServerId) setChosenId(pickerCompletedServerId);
    setPickerRequestId(null);
  }, [pickerCompletedRequestId, pickerCompletedServerId, pickerRequestId]);
  useEffect(() => {
    if (pickerRequestId !== null && pickerRequestId === pickerOpenRequestId) {
      updatePickerReachability(pickerRequestId, reachabilityByServer);
    }
  }, [pickerOpenRequestId, pickerRequestId, reachabilityByServer, updatePickerReachability]);
  useEffect(() => {
    pickerOpen.set(
      withTiming(reduceMotion ? 0 : pickerOpenRequestId === null ? 0 : 1, timing('micro'))
    );
  }, [pickerOpen, pickerOpenRequestId, reduceMotion]);
  const pickerChevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${pickerOpen.get() * 180}deg` }],
  }));
  function openTargetPicker() {
    if (pickerOpenRequestId !== null) return;
    const requestId = beginPicker(chosen?.serverId, reachabilityByServer);
    setPickerRequestId(requestId);
    router.push({ pathname: '/home-target', params: { requestId: String(requestId) } });
  }

  async function launch(action: () => Promise<unknown>) {
    if (opening) return;
    setOpening(true);
    return settleAfter(
      async () => {
        await action();
      },
      () => {
        setOpening(false);
      }
    );
  }

  function launchOnChosen(action: (serverId: string) => Promise<unknown>) {
    if (chosen && !chosenOffline) void launch(() => action(chosen.serverId));
    else if (servers.length) openTargetPicker();
    else void launch(onPair);
  }

  /** Choose a target directly, as Home's composer does from an `@` mention. */
  function choose(serverId: string) {
    if (servers.some((server) => server.serverId === serverId)) setChosenId(serverId);
  }
  /**
   * Keep the dock on the computer it names now, before something else (opening
   * a task on another computer) moves the app's selection.
   */
  function pinTarget() {
    if (chosen) setChosenId(chosen.serverId);
  }

  return {
    choose,
    pinTarget,
    chosen,
    chosenOffline,
    chosenConnection,
    launchOnChosen,
    openTargetPicker,
    opening,
    pickerChevronStyle,
    pickerOpen: pickerOpenRequestId !== null,
    run: launch,
    servers,
  };
}

export type HomeLaunchController = ReturnType<typeof useHomeLaunchController>;

/** The Gateway selector lives in Home's masthead but owns no global connection state. */
export function HomeLaunchTarget({
  controller,
  loading = false,
  bare = false,
  wide = false,
  chip = false,
  onPair,
}: {
  controller: HomeLaunchController;
  loading?: boolean;
  bare?: boolean;
  wide?: boolean;
  /** A short chip, for the wide Pad cover's launch dock. */
  chip?: boolean;
  onPair: () => Promise<unknown>;
}) {
  const profile = useAppearanceProfile();
  const { t } = useLingui();
  const theme = useThemeTokens();
  const background = useSurfaceBackground();
  const { chosen, openTargetPicker, opening, pickerChevronStyle, pickerOpen, run, servers } =
    controller;
  const hasMultiple = servers.length > 1;
  const disabled = loading || opening;

  return (
    <PressableScale
      testID={servers.length === 0 ? 'home-pair-server' : 'home-launch-target'}
      accessibilityRole="button"
      accessibilityState={{ expanded: hasMultiple ? pickerOpen : undefined, disabled }}
      disabled={disabled}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 12 }}
      onPress={() => {
        if (servers.length === 0) void run(onPair);
        else openTargetPicker();
      }}
      style={[
        styles.target,
        !bare &&
          servers.length > 0 && { width: HOME_TOOLBAR_PAIR_WIDTH, paddingHorizontal: 8, gap: 4 },
        wide && { width: undefined, minWidth: 160, maxWidth: 300, paddingHorizontal: 16, gap: 12 },
        chip && [
          styles.targetChip,
          { borderColor: theme.colors.border, backgroundColor: background(theme.colors.surface) },
        ],
        bare && { minWidth: 0 },
        bare && { paddingHorizontal: HOME_TOOLBAR_ICON_INSET },
        {
          borderRadius: profile.chrome.control,
          backgroundColor: bare ? 'transparent' : background(theme.colors.surface),
        },
      ]}>
      <Text
        variant="bodySmall"
        weight="semibold"
        numberOfLines={1}
        ellipsizeMode="tail"
        style={styles.targetName}
        pointerEvents="none">
        {loading
          ? t`Loading computers`
          : chosen
            ? chosen.label
            : servers.length
              ? t`Choose a computer`
              : t`Pair a computer`}
      </Text>
      {hasMultiple ? (
        <Animated.View style={pickerChevronStyle} pointerEvents="none">
          <ThemeIcon
            name="home.arrow"
            fallback={ChevronDown}
            size={16}
            color={theme.colors.primary}
            direction="down"
          />
        </Animated.View>
      ) : null}
    </PressableScale>
  );
}

export function HomeLaunchActions({
  controller,
  onNewAgent,
  onOpenAgent,
  onNewTerminal,
  onOpenTerminal,
  onSsh,
  onDemo,
  grid = false,
  newOnly = false,
  dock = false,
}: {
  controller: HomeLaunchController;
  /**
   * The Pad's embedded Home: every agent in a row of its own and the
   * utilities in compact tiles under it, with no sideways scroll.
   */
  grid?: boolean;
  /** Existing destinations live in the Pad's persistent navigation. */
  newOnly?: boolean;
  /**
   * The wide Pad cover uses the same agent grid with compact utilities.
   */
  dock?: boolean;
  onNewAgent: (serverId: string, directory?: string, agentId?: string) => Promise<unknown>;
  onOpenAgent: (serverId: string) => Promise<unknown>;
  onNewTerminal: (serverId: string) => Promise<unknown>;
  onOpenTerminal: (serverId: string) => Promise<unknown>;
  onSsh: () => Promise<unknown>;
  onDemo?: () => void;
}) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const theme = useThemeTokens();
  const { chosen, chosenOffline, chosenConnection, launchOnChosen, opening, run } = controller;
  const [availableWidth, setAvailableWidth] = useState(0);

  // The row is a projection of what the chosen gateway said about itself; a
  // gateway never asked, or too old to be asked, projects to the fixed five.
  const chosenId = chosen?.serverId;
  const discovery = useAgents((state) => (chosenId ? state.index.servers[chosenId] : undefined));
  const lastUsedAgentId = useAgents((state) =>
    chosenId ? state.index.lastUsed[chosenId] : undefined
  );
  const model = buildLaunchModel({
    discovery,
    lastUsedAgentId,
  });
  const entries = newOnly
    ? model.entries.filter((entry) => isAgentEntry(entry) || entry.kind === 'new-terminal')
    : model.entries;
  const agentEntries = entries.filter(isAgentEntry);
  const utilityEntries = entries.filter((entry) => !isAgentEntry(entry));
  const layout = launchRowLayout({
    width: availableWidth,
    agentCount: agentEntries.length,
    utilityCount: utilityEntries.length,
    grid: grid || dock,
  });

  // Fresh on focus and on Continue's own cadence, for the chosen gateway only,
  // and never in the way of a render: the row draws from the mirror.
  const focused = useIsFocused();
  const appActive = useAppActive();
  useEffect(() => {
    if (!chosen || chosenOffline || !focused || !appActive || isDemoRecord(chosen)) return;
    let askedAtMs = Date.now();
    void refreshAgentServerDiscovery(chosen);
    const timer = setInterval(() => {
      // Continue's cadence: half as often while the task socket is open.
      const nowMs = Date.now();
      const live = useServerChannels.getState().sockets[chosen.serverId] === 'open';
      if (!homeRefreshDue({ atMs: askedAtMs, failures: 0 }, nowMs, live)) return;
      askedAtMs = nowMs;
      void refreshAgentServerDiscovery(chosen);
    }, HOME_CONTINUE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [appActive, chosen, chosenOffline, focused]);

  /** Agent widths belong to their mosaic column; utility widths belong to the tile. */
  function renderEntry(
    entry: LaunchEntry,
    cell?: { width?: number; compact: boolean; featured?: boolean }
  ) {
    const utilityCompact = dock || (cell?.compact ?? false);
    const common = {
      testID: entry.testID,
      marker: entry.marker,
      ...(cell ? { width: cell.width } : {}),
      rowHeight:
        entry.kind !== 'agent' && !utilityCompact
          ? DOCK_ROW_HEIGHT * 2 + LAUNCH_GRID_GAP
          : DOCK_ROW_HEIGHT,
    };
    switch (entry.kind) {
      case 'agent': {
        if (!cell?.featured) {
          // Setup states remain visible alongside the agent name.
          const ready = entry.caption === 'new-session';
          const filled = entry.primary && ready;
          return (
            <LaunchTile
              key={entry.key}
              {...common}
              chip
              aliasTestID={entry.aliasTestID}
              primary={filled}
              muted={!ready}
              title={entry.name}
              caption={_(agentLaunchCaption[entry.caption])}
              inlineCaption={ready ? undefined : _(agentLaunchCaption[entry.caption])}
              icon={
                <AgentMark
                  kind={entry.agentKind}
                  size={18}
                  color={
                    filled
                      ? theme.colors.onPrimary
                      : ready
                        ? theme.colors.primary
                        : theme.colors.textMuted
                  }
                />
              }
              disabled={opening || chosenOffline}
              onPress={() =>
                launchOnChosen((serverId) => onNewAgent(serverId, undefined, entry.agentId))
              }
            />
          );
        }
        const ready = entry.caption === 'new-session';
        const filled = entry.primary && ready;
        const ink = filled
          ? theme.colors.onPrimary
          : ready
            ? theme.colors.primary
            : theme.colors.textMuted;
        return (
          <LaunchTile
            key={entry.key}
            {...common}
            aliasTestID={entry.aliasTestID}
            primary={filled}
            rowHeight={DOCK_ROW_HEIGHT * 2 + LAUNCH_GRID_GAP}
            title={entry.name}
            caption={_(agentLaunchCaption[entry.caption])}
            icon={<AgentMark kind={entry.agentKind} size={entry.primary ? 24 : 22} color={ink} />}
            disabled={opening || chosenOffline}
            onPress={() =>
              launchOnChosen((serverId) => onNewAgent(serverId, undefined, entry.agentId))
            }
          />
        );
      }
      case 'sessions':
        return (
          <LaunchTile
            key={entry.key}
            {...common}
            aliasTestID={entry.aliasTestID}
            compact
            title={t`Sessions`}
            icon={<MessagesSquare size={16} color={theme.colors.primary} />}
            disabled={opening || chosenOffline}
            onPress={() => launchOnChosen(onOpenAgent)}
          />
        );
      case 'terminal':
        return (
          <LaunchTile
            key={entry.key}
            {...common}
            compact
            title={t`Terminal`}
            icon={<SquareTerminal size={16} color={theme.colors.primary} />}
            disabled={opening || chosenOffline}
            onPress={() => launchOnChosen(onOpenTerminal)}
          />
        );
      case 'new-terminal':
        return (
          <LaunchTile
            key={entry.key}
            {...common}
            compact={utilityCompact}
            title={t`New terminal`}
            caption={entry.backend}
            icon={
              <SquareTerminal
                size={dock ? 18 : utilityCompact ? 16 : 22}
                color={theme.colors.primary}
              />
            }
            disabled={opening || chosenOffline}
            onPress={() => launchOnChosen(onNewTerminal)}
          />
        );
      case 'ssh':
        return (
          <LaunchTile
            key={entry.key}
            {...common}
            compact={utilityCompact}
            title={t`SSH`}
            caption={t`SSH hosts`}
            icon={<Link size={utilityCompact ? 16 : 22} color={theme.colors.primary} />}
            disabled={opening}
            onPress={() => {
              void run(onSsh);
            }}
          />
        );
    }
  }

  return (
    <View
      testID="home-launch-actions"
      onLayout={(event) => setAvailableWidth(event.nativeEvent.layout.width)}
      style={styles.root}>
      {chosen &&
      chosenConnection &&
      chosenConnection !== 'live' &&
      chosenConnection !== 'unknown' ? (
        <Text
          testID="home-launch-unavailable"
          accessibilityLiveRegion="polite"
          variant="caption"
          color={theme.colors.textMuted}>
          {`${chosen.label} · ${_(connectionStatusDescription[chosenConnection])}`}
        </Text>
      ) : null}
      {onDemo ? (
        <PressableScale
          testID="home-try-demo"
          accessibilityRole="button"
          accessibilityLabel={t`Try the demo`}
          accessibilityState={{ disabled: opening }}
          disabled={opening}
          onPress={onDemo}
          style={styles.demoAction}>
          <Play size={14} color={theme.colors.textMuted} strokeWidth={2.2} />
          <Text variant="bodySmall" color={theme.colors.textMuted} style={styles.demoLabel}>
            {t`Try the demo`}
          </Text>
        </PressableScale>
      ) : null}
      <View
        testID={
          dock
            ? 'home-launch-actions-dock'
            : grid
              ? 'home-launch-actions-grid'
              : 'home-launch-actions-mosaic'
        }
        style={styles.grid}>
        {availableWidth > 0 ? (
          layout.mode === 'scroll' ? (
            <Animated.ScrollView
              horizontal
              nestedScrollEnabled
              directionalLockEnabled
              showsHorizontalScrollIndicator={false}
              testID="home-launch-actions-scroll"
              contentContainerStyle={styles.scrollRow}>
              {layout.agentRows[0]?.map((cell) => (
                <View
                  key={agentEntries[cell.indices[0]!]!.key}
                  style={{ width: cell.width, gap: LAUNCH_GRID_GAP }}>
                  {cell.indices.map((index) =>
                    renderEntry(agentEntries[index]!, { compact: false, featured: cell.featured })
                  )}
                </View>
              ))}
              {groupLaunchCells(utilityEntries).map((cell) => (
                <View key={cell.key} style={{ width: layout.utilityWidth, gap: LAUNCH_GRID_GAP }}>
                  {cell.entries.map((entry) =>
                    renderEntry(entry, { compact: entry.layout === 'compact' })
                  )}
                </View>
              ))}
            </Animated.ScrollView>
          ) : (
            <>
              {layout.agentRows.map((row) => (
                <View key={agentEntries[row[0]!.indices[0]!]!.key} style={styles.gridRow}>
                  {row.map((cell) => (
                    <View
                      key={agentEntries[cell.indices[0]!]!.key}
                      style={{ width: cell.width, gap: LAUNCH_GRID_GAP }}>
                      {cell.indices.map((index) =>
                        renderEntry(agentEntries[index]!, { compact: false })
                      )}
                    </View>
                  ))}
                </View>
              ))}
              {utilityEntries.length ? (
                <View style={styles.gridRow}>
                  {utilityEntries.map((entry) =>
                    renderEntry(entry, { width: layout.utilityWidth, compact: true })
                  )}
                </View>
              ) : null}
            </>
          )
        ) : null}
      </View>
      {opening ? <Text variant="caption" color={theme.colors.textMuted}>{t`Opening…`}</Text> : null}
    </View>
  );
}

function isAgentEntry(entry: LaunchEntry): boolean {
  return entry.kind === 'agent';
}

function LaunchTile({
  title,
  marker,
  caption,
  icon,
  onPress,
  primary = false,
  compact = false,
  chip = false,
  muted = false,
  inlineCaption,
  rowHeight,
  width,
  disabled,
  testID,
  aliasTestID,
}: {
  title: string;
  marker: string;
  caption?: string;
  icon: ReactNode;
  onPress: () => void;
  primary?: boolean;
  compact?: boolean;
  /** Compact agent tile with an icon and a wrapping name. */
  chip?: boolean;
  /** A chip for an agent that is not ready to start. */
  muted?: boolean;
  /** Setup state below the name; `caption` also supplies the accessibility text. */
  inlineCaption?: string;
  /** Minimum height for chips and compact rows. */
  rowHeight?: number;
  /** Fixed utility width; agent columns own their width. */
  width?: number;
  disabled: boolean;
  testID: string;
  /** The id this tile answered to before it was projected; kept for the e2e manifest. */
  aliasTestID?: string;
}) {
  const profile = useAppearanceProfile();
  const theme = useThemeTokens();
  const background = useSurfaceBackground();
  const ink = primary ? theme.colors.onPrimary : theme.colors.text;
  const reduceMotion = useReducedMotion();
  const arrowTravel = useSharedValue(0);
  useEffect(() => {
    if (disabled || reduceMotion) arrowTravel.set(0);
  }, [arrowTravel, disabled, reduceMotion]);
  const arrowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: arrowTravel.get() }, { translateY: -arrowTravel.get() }],
  }));
  const moveArrow = (pressed: boolean) => {
    arrowTravel.set(
      withTiming(pressed && !reduceMotion ? 2 : 0, timing(pressed ? PRESS.in : PRESS.out))
    );
  };
  if (chip) {
    const chipInk = primary
      ? theme.colors.onPrimary
      : muted
        ? theme.colors.textMuted
        : theme.colors.text;
    return (
      <PressableScale
        testID={testID}
        nativeID={aliasTestID}
        accessibilityRole="button"
        accessibilityLabel={caption ? `${title}, ${caption}` : title}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        style={[
          styles.chip,
          { borderRadius: profile.chrome.control },
          rowHeight !== undefined && { minHeight: rowHeight },
          {
            backgroundColor: background(primary ? theme.colors.primary : theme.colors.surface),
            opacity: disabled ? 0.6 : 1,
          },
        ]}>
        {icon}
        <Text variant="bodySmall" weight="semibold" color={chipInk} style={styles.chipTitle}>
          {title}
          {inlineCaption ? `\n${inlineCaption}` : ''}
        </Text>
      </PressableScale>
    );
  }
  if (compact) {
    return (
      <PressableScale
        testID={testID}
        nativeID={aliasTestID}
        accessibilityRole="button"
        accessibilityLabel={caption ? `${title}, ${caption}` : title}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPressIn={() => moveArrow(true)}
        onPressOut={() => moveArrow(false)}
        onPress={onPress}
        style={[
          styles.compactTile,
          { borderRadius: profile.chrome.control },
          rowHeight !== undefined && { minHeight: rowHeight },
          width !== undefined && launchGridCellStyle(width),
          {
            backgroundColor: background(theme.colors.surface),
            opacity: disabled ? 0.6 : 1,
          },
        ]}>
        <View style={styles.compactIcon}>{icon}</View>
        <View style={styles.compactCopy}>
          <Text variant="caption" weight="semibold" color={ink} style={styles.tileTitle}>
            {title}
          </Text>
          {caption ? (
            <Text variant="caption" color={theme.colors.textMuted} style={styles.tileCaption}>
              {caption}
            </Text>
          ) : null}
        </View>
        <Text variant="caption" color={theme.colors.textMuted} style={styles.tileMarker}>
          {marker}
        </Text>
        <Animated.View style={arrowStyle}>
          <ThemeIcon
            name="home.arrow"
            direction="up-right"
            fallback={ArrowUpRight}
            size={15}
            color={ink}
          />
        </Animated.View>
      </PressableScale>
    );
  }

  return (
    <PressableScale
      testID={testID}
      nativeID={aliasTestID}
      accessibilityRole="button"
      accessibilityLabel={caption ? `${title}, ${caption}` : title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPressIn={() => moveArrow(true)}
      onPressOut={() => moveArrow(false)}
      onPress={onPress}
      style={[
        styles.tile,
        {
          borderRadius: profile.chrome.control,
        },
        primary ? styles.primaryTile : styles.secondaryTile,
        rowHeight !== undefined && { minHeight: rowHeight, flexBasis: 0, flex: 1 },
        width !== undefined && launchGridCellStyle(width),
        {
          backgroundColor: background(primary ? theme.colors.primary : theme.colors.surface),
          opacity: disabled ? 0.6 : 1,
        },
      ]}>
      <View style={styles.tileTopRow}>
        <View style={styles.tileIcon}>{icon}</View>
        <View style={styles.tileMeta}>
          <Text variant="caption" color={ink} style={styles.tileMarker}>
            {marker}
          </Text>
          <Animated.View style={arrowStyle}>
            <ThemeIcon
              name="home.arrow"
              direction="up-right"
              fallback={ArrowUpRight}
              size={16}
              color={ink}
            />
          </Animated.View>
        </View>
      </View>
      <View style={styles.tileCopy}>
        <Text
          variant={primary ? 'heading' : 'bodySmall'}
          weight="semibold"
          color={ink}
          style={[styles.tileTitle, primary ? styles.primaryTileTitle : styles.secondaryTileTitle]}>
          {title}
        </Text>
        {caption ? (
          <Text
            variant="caption"
            color={primary ? ink : theme.colors.textMuted}
            style={styles.tileCaption}>
            {caption}
          </Text>
        ) : null}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  root: { gap: 12, minWidth: 0 },
  target: {
    minWidth: HOME_TOOLBAR_PAIR_WIDTH,
    minHeight: 44,
    paddingVertical: 10,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 3,
    gap: 8,
    paddingHorizontal: 12,
    maxWidth: '100%',
  },
  targetName: { minWidth: 0, flexShrink: 1 },
  targetChip: {
    minWidth: 0,
    height: 44,
    minHeight: 44,
    paddingVertical: 0,
    paddingHorizontal: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chip: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipTitle: { minWidth: 0, flexShrink: 1 },
  demoAction: {
    minWidth: 44,
    minHeight: 44,
    maxWidth: '100%',
    alignSelf: 'flex-start',
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  demoLabel: { minWidth: 0, flexShrink: 1 },
  scrollRow: { flexDirection: 'row', gap: LAUNCH_GRID_GAP },
  grid: { gap: LAUNCH_GRID_GAP, minWidth: 0 },
  gridRow: { flexDirection: 'row', flexWrap: 'wrap', gap: LAUNCH_GRID_GAP, minWidth: 0 },
  tile: {
    flexGrow: 1,
    flexBasis: 124,
    minHeight: 104,
    borderRadius: 3,
    padding: 6,
    gap: 3,
    justifyContent: 'space-between',
  },
  tileTopRow: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  tileIcon: { alignSelf: 'flex-start' },
  tileMeta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  tileMarker: { fontSize: 9, lineHeight: 12, letterSpacing: 0.8, opacity: 0.66 },
  tileCopy: { gap: 1 },
  tileTitle: { minWidth: 0, flexShrink: 1, letterSpacing: -0.25 },
  primaryTile: { flexBasis: 148, padding: 10 },
  secondaryTile: { padding: 10 },
  compactTile: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 3,
    gap: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  compactIcon: { width: 18, alignItems: 'center' },
  compactCopy: { flex: 1, minWidth: 0, gap: 1 },
  primaryTileTitle: { fontSize: 16, lineHeight: 20 },
  secondaryTileTitle: { fontSize: 14, lineHeight: 20 },
  tileCaption: { minWidth: 0, flexShrink: 1, fontSize: 11, lineHeight: 14 },
});
