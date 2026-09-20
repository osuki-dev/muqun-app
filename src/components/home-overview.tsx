import { useAppActive } from '@/hooks/use-app-active';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import { useThemeMode, useThemeTokens } from '@osuki-dev/ui';
import { Text } from '@/components/text';
import { Card } from '@/components/themed-card';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { Button } from '@/components/themed-button';
import { Skeleton } from '@/components/themed-skeleton';
import { Image } from 'expo-image';
import { type Href, useFocusEffect, useIsFocused, useRouter } from 'expo-router';
import {
  ChevronRight,
  Play,
  ScanLine,
  Server,
  Settings,
  SquareTerminal,
} from 'lucide-react-native';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, RefreshControl, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Trans, useLingui } from '@lingui/react/macro';
import { useLingui as useLinguiRuntime } from '@lingui/react';

import AppDrawer from '@/components/app-drawer';
import { NewTaskAction } from '@/components/new-task-action';
import { PadServerRail } from '@/components/pad-server-rail';
import { PressableScale } from '@/components/pressable-scale';
import { SectionLabel } from '@/components/settings-chrome';
import { ServerAgentRows } from '@/components/server-agent-rows';
import { GatewayTunnelBadge } from '@/components/gateway-tunnel-badge';
import { HomeHero } from '@/components/home-hero';
import { HomeEditorialLayout } from '@/components/home-editorial-layout';
import { HomeConnections } from '@/components/home-connections';
import { HomeAttention } from '@/components/home-attention';
import { HomeRecentSessions } from '@/components/home-recent-sessions';
import { HomeLaunchActions } from '@/components/home-launch-actions';
import { SshHostRow } from '@/components/ssh-host-row';
import { StatusDot } from '@/components/status-dot';
import { NAV_HEADER_TOP_GAP } from '@/constants/nav-header';
import { reachabilityDescription, reachabilityLabel } from '@/i18n/labels';
import { DEMO_SERVER_ID, isDemoRecord } from '@/lib/demo-gateway';
import { demoSshHost } from '@/lib/demo-ssh';
import type { GatewayRecord } from '@/lib/gateway-storage';
import { fadeIn, fadeOut, listLayout, riseIn, STAGGER, timing } from '@/lib/motion';
import {
  homeServerListLayout,
  THEME_ARTWORK_REGULAR_MIN_WIDTH,
  type HomeServerListLayout,
} from '@/lib/responsive-layout';
import { serverIdsNeedingAddress } from '@/lib/server-address';
import type { ServerAgent, ServerAgentsSnapshot } from '@/lib/server-agents';
import {
  resolveServerReachability,
  serversToProbe,
  type ActiveServerConnection,
  type ServerReachability,
} from '@/lib/server-reachability';
import { sshHomeRows } from '@/lib/ssh-home';
import type { SshHostRecord } from '@/lib/ssh-hosts';
import { useGatewayRecord } from '@/hooks/use-gateway-record';
import { useHomeCommands } from '@/hooks/use-home-commands';
import type { HomeServerEntry } from '@/lib/home-commands';
import { GatewayStorageError } from '@/components/gateway-storage-error';
import { useServerAgents } from '@/stores/server-agents';
import { useHomeRecentsStore } from '@/stores/home-recents';
import { useHomeAttention } from '@/stores/home-attention';
import { serverPrewarmGate, useServerReachability } from '@/stores/server-reachability';
import { useServerSession } from '@/stores/server-session';
import { warmConfiguredWorkspace } from '@/lib/workspace-snapshot';
import { useServerCapabilities } from '@/stores/server-capabilities';
import { useServerLastViewed } from '@/stores/server-last-viewed';
import { useSshHostsStore } from '@/stores/ssh-hosts';
import { useThemeLibrary } from '@/stores/theme-library';
import { resolveHomeIdentity } from '@/theme/resolve';
import { isHomeHeroAvailable, resolveHomeHeroAsset } from '@/theme/home-hero';
import { homeHeroPreference } from '@/theme/repository';
import { ThemeArtwork, useHasThemeArtwork } from '@/components/theme-artwork';
import { ThemedSurface, ThemedSurfaceArtwork } from '@/components/themed-surface';
import { useBrandMark } from '@/components/brand-mark';
import { useAppSettings } from '@/stores/app-settings';
import { forgetWarmWorkspace } from '@/lib/server-warm-cache';

export type HomeOverviewProps = {
  width: number;
  layoutMode: 'compact' | 'pad';
  /** Omits the outer drawer when this surface is embedded in the task owner. */
  embedded?: boolean;
  onExitOverview?: () => void;
  /** Stable route liveness that survives replacement of this overview subtree. */
  sourceRouteActive?: () => boolean;
  /** The overview is embedded in a `/servers/[serverId]` owner. */
  routeBound?: boolean;
  /** Live state for the exact gateway owned by an embedded workspace. */
  activeConnection?: ActiveServerConnection;
};

export function HomeOverview({
  width,
  layoutMode,
  embedded = false,
  onExitOverview,
  sourceRouteActive,
  routeBound = false,
  activeConnection,
}: HomeOverviewProps) {
  // `t` from the hook, not the global `t` from `@lingui/core/macro`.
  //
  // React Compiler is enabled, and it will memoize a global `t` call whose
  // arguments have not changed -- it has no way to know the result also depends
  // on the active locale. The symptom is a half-translated screen after a
  // language switch: `<Trans>` elements move and everything built from a `t`
  // call keeps the old language. The hook's `t` is bound to the Lingui context,
  // so the compiler sees a dependency that actually changes.
  const { t } = useLingui();

  const router = useRouter();
  const theme = useThemeTokens();
  const background = useSurfaceBackground();
  const customTheme = useThemeLibrary((state) => state.active);
  const identity = resolveHomeIdentity(customTheme?.manifest);
  const hasScene = useHasThemeArtwork('home.background', 'shell.background');
  const customAssets = useThemeLibrary(
    (state) =>
      state.library.themes.find((entry) => entry.id === state.active?.installationId)?.assets
  );
  const [failedLogo, setFailedLogo] = useState<string | null>(null);
  const brandMark = useBrandMark();
  const customLogo =
    identity.logo?.mode === 'custom' ? customAssets?.[identity.logo.asset] : undefined;
  const logoSource = customLogo && customLogo !== failedLogo ? { uri: customLogo } : brandMark;
  const isPad = layoutMode === 'pad';
  // Renaming and unpairing live in Settings, not here: the owner asked for one
  // place that manages servers, and the tablet branch's long-press row menu was
  // a second answer to the same question. The layout work from that branch is
  // kept; its row menu is not.
  const { record, records, loading, hydrationError, retryHydration, selectRecord, enterDemo } =
    useGatewayRecord();
  const [refreshing, setRefreshing] = useState(false);
  const homeLayout = useAppSettings((state) => state.homeLayout);
  const [editorialWidth, setEditorialWidth] = useState(0);
  const [failedHeroSource, setFailedHeroSource] = useState<string | null>(null);
  const { resolvedMode } = useThemeMode();
  const homeHeroPreferenceValue = useThemeLibrary((state) => {
    const installed = state.library.themes.find(
      (entry) => entry.id === customTheme?.installationId
    );
    return installed ? homeHeroPreference(installed) : 'theme';
  });
  const heroResolution = resolveHomeHeroAsset({
    manifest: customTheme?.manifest,
    assets: customAssets,
    mode: resolvedMode,
    width: width >= THEME_ARTWORK_REGULAR_MIN_WIDTH ? 'regular' : 'compact',
    preference: homeHeroPreferenceValue,
  });
  const hasHeroArtwork =
    !loading && !hydrationError && isHomeHeroAvailable(heroResolution, failedHeroSource);
  const hasPairedServer = records.some((server) => server.serverId !== DEMO_SERVER_ID);
  const appActive = useAppActive();
  const isFocused = useIsFocused();
  const scrollY = useSharedValue(0);
  // Gutter, measure, card geometry and row density in one answer -- see
  // `homeServerListLayout` for why room, not server count alone, decides it.
  const metrics = homeServerListLayout(width, records.length);

  // The mirror holds all panes; the shared Home model applies the reader's
  // agent-only filter without changing what is persisted.
  const agentsByServer = useServerAgents((state) => state.byServer);
  const hydrateServerAgents = useServerAgents((state) => state.hydrate);
  const keepServerAgents = useServerAgents((state) => state.keepOnly);

  const probes = useServerReachability((state) => state.probes);
  const refreshReachabilityMany = useServerReachability((state) => state.refreshMany);
  const refreshReachability = useServerReachability((state) => state.refresh);
  const keepReachability = useServerReachability((state) => state.keepOnly);

  // Read once so every Home projection resolves probe freshness against the
  // same instant. A standalone Home has no active connection override.
  // oxlint-disable-next-line react/purity -- deliberate: freshness is relative to render.
  const nowMs = Date.now();

  // Which servers have been opened on this device, and when. Already stored for
  // the "while you were away" digest; the probe order is its second reader, and
  // wants exactly the same fact -- which machines this person actually uses.
  const lastViewedByServer = useServerLastViewed((state) => state.byServer);
  const hydrateLastViewed = useServerLastViewed((state) => state.hydrate);
  const hydrateServerCapabilities = useServerCapabilities((state) => state.hydrate);
  useEffect(() => {
    void hydrateLastViewed();
    void hydrateServerCapabilities();
  }, [hydrateLastViewed, hydrateServerCapabilities]);
  const padReachabilityByServer = useMemo(
    () =>
      Object.fromEntries(
        records.map((server) => [
          server.serverId,
          resolveServerReachability(
            server.serverId,
            probes[server.serverId],
            activeConnection,
            nowMs
          ),
        ])
      ),
    [activeConnection, nowMs, probes, records]
  );

  useEffect(() => {
    void hydrateServerAgents();
  }, [hydrateServerAgents]);

  // The saved SSH hosts, read here as well as on `/ssh`: a host already
  // configured is one tap from this screen, not two. Nothing SSH is drawn
  // until the keychain has answered -- a section that appears empty and then
  // fills is the flicker the server skeleton above exists to avoid, and an
  // SSH section has no skeleton because most installs have no hosts at all.
  const sshHosts = useSshHostsStore((state) => state.hosts);
  const sshLoading = useSshHostsStore((state) => state.loading);
  const hydrateSshHosts = useSshHostsStore((state) => state.hydrate);
  useEffect(() => {
    if (sshLoading) void hydrateSshHosts();
  }, [hydrateSshHosts, sshLoading]);
  // The demo host rides along only while the demo is on, which on a phone is
  // never by the time this screen is back (the server header hangs it up on
  // the way out) and on a Pad is exactly while the demo workspace is beside
  // the rail -- see `ssh-home.ts`.
  const sshRows = sshLoading
    ? []
    : sshHomeRows(sshHosts, isDemoRecord(record) ? demoSshHost() : null);

  // Unpairing a server has to take its agent names and its status with it, and
  // this catches every route to that -- Settings > SERVERS, the drawer, a
  // wiped install -- because it follows the record list rather than any one
  // action.
  const serverIds = useMemo(() => records.map((server) => server.serverId), [records]);
  const hydrateHomeRecents = useHomeRecentsStore((state) => state.hydrate);
  useEffect(() => {
    void hydrateHomeRecents();
  }, [hydrateHomeRecents]);
  useEffect(() => {
    // Only loaded inventories authorize pruning. An offline server or an
    // unfinished keychain read is not evidence that a destination was removed.
    if (loading || hydrationError || sshLoading) return;
    void useHomeRecentsStore.getState().keepOnly({
      serverIds,
      hostIds: sshHosts.map((host) => host.id),
    });
    useHomeAttention.getState().keepOnly(serverIds);
  }, [hydrationError, loading, serverIds, sshHosts, sshLoading]);

  // An address is a disambiguator, so it is on screen exactly when it is
  // disambiguating -- which for most installs is never. See
  // `lib/server-address.ts`; Settings > SERVERS lists every address regardless.
  const addressNeeded = useMemo(() => serverIdsNeedingAddress(records), [records]);

  useEffect(() => {
    if (loading || hydrationError) return;
    void keepServerAgents(serverIds);
    keepReachability(serverIds);
  }, [keepReachability, keepServerAgents, loading, hydrationError, serverIds]);

  // Ask the servers worth asking whether they are there. On focus rather than
  // on an interval: the answer is only worth having while someone is looking at
  // it, and the store rate-limits repeat asks.
  //
  // Up to `MAX_PROBED_SERVERS`, configured record first and most recently viewed
  // after -- see `serversToProbe`. Anything past that ceiling still says
  // `NOT CONNECTED`, which remains the honest description of a machine nobody
  // asked; what changed is that the common case is no longer "nobody asked".
  const probeTargets = useMemo(
    () =>
      serversToProbe(
        // A tunnelled record is excluded because its stored address belongs to
        // the SSH host rather than the gateway, and the demo record has nothing
        // to answer. Both are the store's guards too; filtering here as well
        // keeps them out of the ceiling, so four real servers are not crowded
        // out by records that were never going to be probed.
        records.filter((server) => server.serverId !== DEMO_SERVER_ID && !server.sshTunnel),
        lastViewedByServer,
        record?.serverId
      ),
    [records, lastViewedByServer, record?.serverId]
  );

  useFocusEffect(
    useCallback(() => {
      if (!appActive || loading || hydrationError) return;
      let current = true;
      // The initial focus runs under LaunchOverlay: hydrate cached home data
      // and establish reachability without holding the splash for the network.
      // Re-entry and foreground resume reuse fresh results and refresh stale ones.
      void refreshReachabilityMany(probeTargets, {
        shouldContinue: () => current && AppState.currentState === 'active',
      });
      return () => {
        current = false;
      };
    }, [appActive, loading, hydrationError, probeTargets, refreshReachabilityMany])
  );

  useFocusEffect(
    useCallback(() => {
      if (
        !appActive ||
        loading ||
        hydrationError ||
        !record ||
        isDemoRecord(record) ||
        record.sshTunnel
      )
        return;
      let current = true;
      const isCurrent = () =>
        current &&
        AppState.currentState === 'active' &&
        useGatewayConnectionStore.getState().record === record;
      // Prepare only the selected direct gateway while the home is visible.
      // The terminal consumes this same short-lived cache on its first render;
      // see `openServer` for why this screen warms on sight rather than on tap.
      //
      // The dot probe above and this warm both want `/health` from the same
      // gateway, on the same focus. Waiting for the probe rather than racing it
      // is what turns two `/health` calls into one: `refreshReachability` joins
      // the flight the probe effect already started (or starts the only one),
      // and the answer it leaves behind is both the dot's colour and the warm's
      // `knownHealth`. It is not an extra round trip -- it is the same one.
      void (async () => {
        await useServerSession.getState().hydrate();
        if (!isCurrent()) return;
        await refreshReachability(record, { shouldContinue: isCurrent });
        if (!isCurrent()) return;
        const gate = serverPrewarmGate(record.serverId);
        // Nothing to warm from a machine that just failed to answer: the six
        // requests would each sit out the full timeout, against a server the
        // list has already drawn as offline.
        if (!gate.warm) return;
        await warmConfiguredWorkspace(
          record.serverId,
          useServerSession.getState().byServer[record.serverId],
          isCurrent,
          gate.health
        );
      })();
      return () => {
        current = false;
      };
    }, [appActive, loading, hydrationError, record, refreshReachability])
  );

  // A pull is someone asking, so it overrides the store's own rate limit. The
  // focus probe deliberately does not -- it fires on every return to the
  // screen, and honouring all of those would put the pairing token on the wire
  // for a fact the app already has.
  //
  // The same set as the focus probe, forced. A refresh that re-asked only the
  // configured server would leave the other dots showing an answer from up to
  // `REACHABILITY_FRESH_MS` ago while the control said it had just refreshed.
  const onRefresh = useCallback(async () => {
    if (!isFocused || AppState.currentState !== 'active') return;
    setRefreshing(true);
    try {
      await refreshReachabilityMany(probeTargets, {
        force: true,
        shouldContinue: () => AppState.currentState === 'active',
      });
      // The rows under the selected server, re-read. A pull used to refresh the
      // dots and leave the lists as they were, so an agent the reader had
      // closed stayed on its card until they opened the server and came back.
      // The warm cache is dropped first because a pull is someone asking: the
      // warm would otherwise answer from what it read a moment ago.
      const selected = useGatewayConnectionStore.getState().record;
      if (selected && !isDemoRecord(selected) && !selected.sshTunnel) {
        const gate = serverPrewarmGate(selected.serverId);
        if (gate.warm) {
          forgetWarmWorkspace(selected.serverId);
          await warmConfiguredWorkspace(
            selected.serverId,
            useServerSession.getState().byServer[selected.serverId],
            () => AppState.currentState === 'active',
            gate.health
          );
        }
      }
    } finally {
      setRefreshing(false);
    }
  }, [isFocused, probeTargets, refreshReachabilityMany]);

  /*
   * The bar gives way to the list.
   *
   * The bar floats over the top of the list rather than sitting above it, and
   * the list starts under it with padding to match. Scrolling down through
   * the servers slides the bar up off the screen, controls folding into their
   * corner as it goes, so a card on its way up is not sliced off behind a
   * strip of controls. The first gesture back up brings it straight back,
   * controls and (past 82pt) the compact brand with it, and inside the first
   * few points of the list it is always there.
   *
   * It slides rather than shrinks on purpose: a bar that changed height would
   * move the list under the finger by the same amount every time it folded or
   * unfolded, which read as a bounce at the threshold. A translate moves only
   * the bar.
   *
   * Direction rather than offset, because the fold answers what the reader is
   * doing right now: a long list scrolled to its middle should still hand the
   * controls back on the first upward pull, and travel that has to accumulate
   * keeps a finger resting on the screen from flapping it.
   */
  const lastScrollY = useSharedValue(0);
  const foldTarget = useSharedValue(0);
  const travel = useSharedValue(0);
  const fold = useSharedValue(0);
  const insets = useSafeAreaInsets();
  const [barHeight, setBarHeight] = useState(insets.top + HEADER_ROW_HEIGHT);
  const barHeightValue = useSharedValue(insets.top + HEADER_ROW_HEIGHT);
  const onScroll = useAnimatedScrollHandler({
    onScroll(event) {
      const y = event.contentOffset.y;
      const delta = y - lastScrollY.value;
      lastScrollY.value = y;
      scrollY.value = y;
      let target = foldTarget.value;
      if (y <= HEADER_FOLD_FREE_ZONE) {
        target = 0;
        travel.value = 0;
      } else {
        // Travel accumulates while the direction holds and resets when it
        // turns, so a slow drag folds the bar as surely as a flick and a
        // finger resting on the screen does not flap it.
        travel.value = Math.sign(delta) === Math.sign(travel.value) ? travel.value + delta : delta;
        if (travel.value > HEADER_FOLD_TRAVEL) target = 1;
        else if (travel.value < -HEADER_FOLD_TRAVEL) target = 0;
      }
      // Start the animation only on a change of mind: restarting it on every
      // scroll event would hold the bar half-folded for as long as the finger
      // keeps moving.
      if (target !== foldTarget.value) {
        foldTarget.value = target;
        fold.value = withTiming(target, timing('medium'));
      }
    },
  });
  const barFoldStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -fold.value * barHeightValue.value }],
  }));
  // The controls shrink towards the corner they live in as the row closes
  // over them, so they read as folding away rather than as being cut off.
  const headerActionsStyle = useAnimatedStyle(() => ({
    opacity: 1 - fold.value,
    transform: [
      { translateX: fold.value * HEADER_FOLD_SLIDE },
      { scale: 1 - fold.value * HEADER_FOLD_SHRINK },
    ],
  }));
  const compactTitleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [82, 112], [0, 1], Extrapolation.CLAMP),
    transform: [{ translateY: interpolate(scrollY.value, [82, 112], [5, 0], Extrapolation.CLAMP) }],
  }));
  /**
   * The other half of that swap, which used to be missing.
   *
   * The expanded block simply scrolled, and the scroll view cuts its content
   * off at the top edge -- so for the whole 82 points before the compact title
   * begins to appear, the reader watched the name being sliced through
   * horizontally. Bare text got away with it; a pack that tints the block
   * behind its name does not, because what is being guillotined is a rounded
   * plate with an edge of its own.
   *
   * It is gone by 82, which is exactly where the compact one starts, so the
   * name is never drawn twice and never drawn in half.
   *
   * The fade begins at the first point of scroll rather than partway, because
   * that is where the cutting begins: the scroll view's top edge sits at the
   * top of this block, so one point of travel already takes a slice off the
   * name. Starting at 40 left the first forty points looking exactly like the
   * bug this replaced.
   */
  const expandedBrandStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [0, 82], [1, 0], Extrapolation.CLAMP),
  }));

  const commands = useHomeCommands({
    resumeServer: embedded ? undefined : resumeServerTarget,
    embedded,
    routeBound,
    sourceRouteActive,
  });

  function openServer(serverId: string, paneId?: string) {
    void commands.openServer(serverId, paneId);
  }

  function resumeServerTarget(target: HomeServerEntry) {
    const { serverId, paneId, sessionId, workspaceId, tabId } = target;
    // Navigate in this frame; warm only after selection owns the transport.
    // Focus warming remains above: this second chance covers a newly tapped
    // server without ever filing the previous gateway's data under its id.
    void selectRecord(serverId).then((selected) => {
      if (!selected || serverId === DEMO_SERVER_ID) return;
      const server = useGatewayConnectionStore.getState().record;
      if (server?.serverId === serverId && !server.sshTunnel)
        void warmConfiguredWorkspace(
          serverId,
          sessionId ?? useServerSession.getState().byServer[serverId],
          () =>
            AppState.currentState === 'active' &&
            useGatewayConnectionStore.getState().record === server,
          serverPrewarmGate(serverId).health
        );
    });
    router.navigate({
      pathname: '/servers/[serverId]',
      params: {
        serverId,
        ...(paneId ? { paneId } : {}),
        ...(sessionId ? { sessionId } : {}),
        ...(workspaceId ? { workspaceId } : {}),
        ...(tabId ? { tabId } : {}),
      },
    } as Href);
  }

  function openDemo() {
    enterDemo();
    router.navigate({
      pathname: '/servers/[serverId]',
      params: { serverId: DEMO_SERVER_ID },
    } as Href);
  }

  // The shell screen connects on mount, the same way it does from `/ssh`, so
  // a row here is the whole trip: no list in between.
  function openSshHost(host: SshHostRecord) {
    void commands.openSsh(host.id);
  }

  const returnToTask =
    embedded && layoutMode === 'compact' && onExitOverview ? (
      <PressableScale
        testID="home-overview-return-to-task"
        accessibilityRole="button"
        accessibilityLabel={t`Return to task`}
        onPress={onExitOverview}
        style={[
          styles.embeddedReturnButton,
          { backgroundColor: background(theme.colors.surface) },
        ]}>
        <SquareTerminal size={15} color={theme.colors.primary} strokeWidth={2} />
        <Text variant="caption" color={theme.colors.primary} style={styles.embeddedReturnLabel}>
          <Trans>Return to task</Trans>
        </Text>
      </PressableScale>
    ) : null;

  if (homeLayout === 'editorial') {
    const editorialContent = (
      <View
        testID="home-editorial"
        onLayout={(event) => setEditorialWidth(event.nativeEvent.layout.width)}
        style={[styles.page, { backgroundColor: background(theme.colors.background) }]}>
        <ThemeArtwork slot="home.background" fallbackSlot="shell.background" />
        <SafeAreaView style={styles.page} edges={['top', 'bottom']}>
          <KeyboardAwareScrollView
            contentContainerStyle={{ paddingBottom: 24 }}
            onScroll={onScroll}
            scrollEventThrottle={16}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => void onRefresh()}
                tintColor={theme.colors.primary}
              />
            }>
            {returnToTask ? <View style={styles.embeddedReturnRow}>{returnToTask}</View> : null}
            {hydrationError ? (
              <GatewayStorageError busy={loading} onRetry={retryHydration} />
            ) : null}
            <ThemeArtwork slot="home.decoration" banner />
            <HomeEditorialLayout
              contentWidth={editorialWidth || width}
              artworkAvailable={hasHeroArtwork}
              artwork={
                hasHeroArtwork && heroResolution ? (
                  <HomeHero
                    resolution={heroResolution}
                    scrollY={scrollY}
                    maxHeight={isPad ? 180 : 150}
                    onAvailabilityChange={(available) => {
                      if (!available) setFailedHeroSource(heroResolution.source);
                    }}
                  />
                ) : undefined
              }
              identity={
                identity.showBrand ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    {identity.logo ? (
                      <Image
                        source={logoSource}
                        contentFit="contain"
                        style={{ width: 44, height: 44 }}
                        onError={() => setFailedLogo(customLogo ?? null)}
                      />
                    ) : null}
                    {identity.name ? (
                      <Text
                        variant="heading"
                        style={{ flex: 1, minWidth: 0, fontSize: 28, lineHeight: 36 }}>
                        {identity.name}
                      </Text>
                    ) : null}
                  </View>
                ) : undefined
              }
              launches={
                hydrationError ? undefined : loading ? (
                  <Text variant="bodySmall">{t`Loading servers`}</Text>
                ) : (
                  <HomeLaunchActions
                    servers={records}
                    selectedServerId={record?.serverId}
                    reachabilityByServer={padReachabilityByServer}
                    onNewOpenCode={commands.newOpenCode}
                    onNewTerminal={commands.newTerminal}
                    onSsh={commands.openSsh}
                    onPair={commands.pairGateway}
                    onDemo={!loading && !hydrationError && !hasPairedServer ? openDemo : undefined}
                  />
                )
              }
              recent={
                !loading && !hydrationError ? (
                  <HomeRecentSessions
                    servers={records}
                    hosts={sshRows}
                    onOpenPane={(serverId, paneId) => {
                      void commands.openServer(serverId, paneId);
                    }}
                    onOpen={(target) => {
                      void commands.resumeTarget(target);
                    }}
                  />
                ) : undefined
              }
              attention={
                !loading && !hydrationError ? (
                  <HomeAttention
                    servers={records}
                    onOpen={(target) => {
                      void commands.resumeTarget(target);
                    }}
                  />
                ) : undefined
              }
              connections={
                !loading && !hydrationError && !sshLoading ? (
                  <HomeConnections
                    servers={records}
                    hosts={sshRows}
                    onOpenServer={openServer}
                    onOpenHost={(hostId) => {
                      void commands.openSsh(hostId);
                    }}
                    onManage={() => {
                      void commands.manageConnections();
                    }}
                    activeConnection={activeConnection}
                    nowMs={nowMs}
                  />
                ) : undefined
              }
              headerAction={
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <HeaderButton
                    editorial
                    label={t`Scan a gateway QR`}
                    onPress={() => void commands.pairGateway()}>
                    <ScanLine size={20} color={theme.colors.text} strokeWidth={1.8} />
                  </HeaderButton>
                  <HeaderButton
                    editorial
                    label={t`Settings`}
                    onPress={() => void commands.manageConnections()}>
                    <Settings size={20} color={theme.colors.text} strokeWidth={1.8} />
                  </HeaderButton>
                </View>
              }
            />
          </KeyboardAwareScrollView>
        </SafeAreaView>
      </View>
    );
    return editorialContent;
  }

  const padRail = isPad ? (
    <PadServerRail
      homeBrand={{
        name: identity.name,
        logo: identity.logo ? logoSource : null,
        visible: identity.showBrand,
      }}
      servers={records}
      agentsByServer={agentsByServer}
      reachabilityByServer={padReachabilityByServer}
      selectedServerId={record?.serverId ?? null}
      onSelectAgent={(server, agent) => openServer(server.serverId, agent.paneId)}
      onPairServer={() => void commands.pairGateway()}
      onOpenSettings={() => void commands.manageConnections()}
      onOpenSsh={() => void commands.openSsh()}
      sshHosts={sshRows}
      onSelectSshHost={openSshHost}
      nowMs={nowMs}
    />
  ) : undefined;

  const classicContent = (
    <View style={[styles.page, { backgroundColor: background(theme.colors.background) }]}>
      <ThemeArtwork slot="home.background" fallbackSlot="shell.background" />
      {/* The bar and the brand block below it are one header in two states, not
          two rows. At rest the bar's left half is deliberately empty -- no
          hamburger, no title, no rule, no blur -- because the brand block ten
          points below *is* the title, and repeating it up here is what made the
          batch4 header read as chrome. Past 82pt of scroll the brand walks up
          into the bar and the bar earns its left half. The controls never move,
          so the only thing that changes is where the brand is. */}
      {!isPad ? (
        <Animated.View
          style={[styles.topBar, barFoldStyle]}
          onLayout={(event: LayoutChangeEvent) => {
            const { height } = event.nativeEvent.layout;
            barHeightValue.value = height;
            setBarHeight(height);
          }}>
          <SafeAreaView edges={['top']}>
            <View style={styles.topBarRow}>
              {identity.showBrand ? (
                <Animated.View
                  testID="home-brand-compact"
                  pointerEvents="none"
                  style={[styles.compactTitle, compactTitleStyle]}>
                  {/* The plate hugs the name; the frame around it does not. That
                frame is positioned against the action buttons, so its width is
                the gap they leave rather than the width of anything drawn in
                it -- painting the tint on the frame itself draws a pill the
                length of the bar with the name stranded at one end. The
                expanded block below hugs for the same reason. */}
                  <View
                    style={[
                      styles.compactTitlePlate,
                      hasScene && {
                        backgroundColor: background(theme.colors.surface),
                        borderRadius: 12,
                        // The tint needs room around the name, and the name has
                        // an x it travels to. Pay the padding back on the left so
                        // the plate grows outwards and the mark still rises
                        // straight out of the block it came from.
                        paddingHorizontal: COMPACT_PLATE_INSET,
                        marginLeft: -COMPACT_PLATE_INSET,
                        overflow: 'hidden',
                      },
                    ]}>
                    <ThemedSurfaceArtwork
                      slot="navigation.background"
                      baseColor={theme.colors.surface}
                    />
                    {identity.logo ? (
                      <View
                        style={[
                          styles.compactIcon,
                          { backgroundColor: background(theme.colors.surfaceRaised) },
                        ]}>
                        <Image
                          source={logoSource}
                          onError={() => setFailedLogo(customLogo ?? null)}
                          contentFit="contain"
                          style={styles.compactMark}
                        />
                      </View>
                    ) : null}
                    {identity.name ? (
                      <Text variant="bodySmall" numberOfLines={1} style={styles.compactTitleText}>
                        {identity.name}
                      </Text>
                    ) : null}
                  </View>
                </Animated.View>
              ) : null}

              {/* Inboard to corner: scan, then gear. The gear is the fixed landmark --
            the app's front door to everything that is not a server -- so it
            takes the corner. Pairing sits beside the list it adds to, and it
            already has a full-width button in the empty state, so the header
            copy of it is the second route and does not take the most privileged
            pixel.

            Neither is the accent. On this screen the coral belongs to the
            selected server's avatar and loom (card #629) and to the empty
            state's one button; a coral control in the corner is exactly the
            batch4 `ADD` pill under a different icon. */}
              <Animated.View style={[styles.headerActions, headerActionsStyle]}>
                {/* Two doors that are only here until the first server is
              paired. After that they are things done once a month, standing in
              the most-used corner of the most-used screen; both live in
              Settings permanently, which is where a reader looks to add
              another machine. The demo server does not count as one. */}
                {hasPairedServer ? null : (
                  <>
                    {/* A plain shell on any machine with sshd, beside the gateway
              entries rather than among them: it pairs nothing and needs no
              herdr, so it is the one door here that is not about a gateway. */}
                    <HeaderButton
                      testID="home-open-ssh"
                      label={t`SSH`}
                      onPress={() => void commands.openSsh()}>
                      <SquareTerminal size={20} color={theme.colors.textMuted} strokeWidth={2} />
                    </HeaderButton>
                    <HeaderButton
                      label={t`Scan a gateway QR`}
                      onPress={() => void commands.pairGateway()}>
                      {/* The same mark as the empty card's corner brackets, at a fifth of
                the size: the one productive gesture on this screen looks the
                same whether it is a 64pt viewfinder in the middle of an empty
                screen or a 20pt glyph in the corner of a full one. */}
                      <ScanLine size={20} color={theme.colors.textMuted} strokeWidth={2} />
                    </HeaderButton>
                  </>
                )}
                <HeaderButton label={t`Settings`} onPress={() => void commands.manageConnections()}>
                  <Settings size={20} color={theme.colors.textMuted} strokeWidth={2} />
                </HeaderButton>
              </Animated.View>
            </View>
          </SafeAreaView>
        </Animated.View>
      ) : null}

      <KeyboardAwareScrollView
        bottomOffset={24}
        extraKeyboardSpace={12}
        contentInsetAdjustmentBehavior={isPad ? 'automatic' : 'never'}
        scrollIndicatorInsets={isPad ? undefined : { top: barHeight }}
        contentContainerStyle={[
          styles.content,
          isPad && styles.padContent,
          {
            paddingHorizontal: metrics.contentGutter,
            maxWidth: metrics.contentMaxWidth,
          },
          !isPad && { paddingTop: barHeight + styles.content.paddingTop },
        ]}
        keyboardDismissMode={process.env.EXPO_OS === 'ios' ? 'interactive' : 'on-drag'}
        keyboardShouldPersistTaps="handled"
        onScroll={onScroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            tintColor={theme.colors.textSubtle}
            colors={[theme.colors.primary]}
            progressBackgroundColor={theme.colors.surface}
          />
        }
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}>
        {returnToTask ? <View style={styles.embeddedReturnRow}>{returnToTask}</View> : null}
        {/* The app's name, at the weight the screen's own content leaves for
            it. On an empty screen this block *is* the content and is set as
            such; once a machine is paired the card below is what the reader
            came for, and the name steps back to being the top of the page.
            `listLayout` carries the one change between them, so pairing a first
            server folds the poster down rather than cutting to a smaller one. */}
        {!isPad && identity.showBrand ? (
          /*
              The scroll fade is a node inside the animated one, never the same
              node: `entering` and `layout` own this view's opacity while they
              run and the scroll position owns it the rest of the time, which
              is what Reanimated warns about on every launch and every theme
              change -- `Property "opacity" of AnimatedComponent(View) may be
              overwritten by a layout animation`.
            */
          <Animated.View
            testID="home-brand-expanded"
            entering={riseIn()}
            layout={listLayout('medium')}>
            <Animated.View
              style={[
                styles.brandBlock,
                expandedBrandStyle,
                { minHeight: metrics.brand.minHeight, gap: metrics.brand.gap },
              ]}>
              {/* The mark alone, on the page. The rounded tile it used to sit in
              gave a shape the mark already has, and cost it 30% of its own
              footprint to draw -- so the part meant to be read was the smaller
              half of the thing drawing attention to it. */}
              {identity.logo ? (
                <Image
                  source={logoSource}
                  onError={() => setFailedLogo(customLogo ?? null)}
                  contentFit="contain"
                  style={{ width: metrics.brand.markSize, height: metrics.brand.markSize }}
                />
              ) : null}
              {identity.name ? (
                <View
                  style={[
                    styles.titleCopy,
                    hasScene && {
                      flex: 0,
                      flexShrink: 1,
                      backgroundColor: background(theme.colors.background),
                      padding: 10,
                      borderRadius: 14,
                      overflow: 'hidden',
                    },
                  ]}>
                  {hasScene ? (
                    <ThemedSurfaceArtwork
                      slot="navigation.background"
                      baseColor={theme.colors.background}
                    />
                  ) : null}
                  {/* The one place on the screen that spends type, with the tracking
                        pulled in hard so the name reads as a mark rather than as a
                        heading. Size and tracking travel with `homeBrandWeight`; the
                        weight does not, because a wordmark that changes stroke weight
                        stops being the same wordmark.

                        That weight is the kit's prop rather than a `fontWeight: '700'`
                        in the stylesheet, and the difference is an Android one.
                        `expo-font` files a loaded face under Typeface.NORMAL alone, so
                        `ReactFontManager` rounds any request of 700 or more up to BOLD,
                        finds nothing filed there, and ends on a system lookup that has
                        never heard of the reader's family -- handing back the
                        platform's bold in a different typeface. The kit's registry caps
                        the prop at semibold, which stays under that threshold; a style
                        `fontWeight` is applied after the resolved family and would put
                        the wordmark straight back into the platform's face. */}
                  <Text
                    weight="semibold"
                    style={{
                      color: theme.colors.text,
                      fontSize: metrics.brand.titleSize,
                      lineHeight: metrics.brand.titleLineHeight,
                      letterSpacing: metrics.brand.titleTracking,
                    }}>
                    {identity.name}
                  </Text>
                  {/* Only where it is the whole message. On a screen already showing
                a machine and what is running on it, a line about what the app
                is for is the product introducing itself to someone who has
                been using it for months. */}
                  {metrics.brand.showsTagline ? (
                    <Text variant="bodySmall" color={theme.colors.textMuted}>
                      <Trans>Your agents, anywhere.</Trans>
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </Animated.View>
          </Animated.View>
        ) : null}

        <ThemeArtwork slot="home.decoration" banner />

        {/* The pack's own illustration, between the header and the machines.
            Absent while the "Pair your first server" card is up: that card
            already carries `emptyState.illustration`, and two pictures stacked
            on an otherwise empty screen is a gallery rather than an invitation.
            It is also independent of the logo pill above -- a reader can keep
            the mark and drop the picture, or the other way round -- because the
            two answer different questions: what the app is called, and what the
            theme looks like. */}
        {!loading && !hydrationError && records.length > 0 && heroResolution ? (
          <HomeHero resolution={heroResolution} scrollY={scrollY} />
        ) : null}

        {hydrationError ? <GatewayStorageError busy={loading} onRetry={retryHydration} /> : null}
        {loading && !hydrationError ? (
          // The shape of the list that is coming, not a logo in the middle of
          // an empty screen. Reading the paired servers out of SecureStore is
          // fast but not free, and what the loader used to do was hold the
          // screen blank and then hard-cut to a populated list -- so the first
          // thing the app did on every cold start was flicker. The rows are
          // built from the same shape the real ones use, and the block fades
          // out from under them.
          <Animated.View
            exiting={fadeOut('short')}
            style={[styles.serverList, { gap: metrics.cardGap }]}
            accessibilityLabel={t`Loading servers`}>
            {/* The same surface, padding and identity block as a real card, so
                the skeleton previews the shape that is actually coming. */}
            {[0, 1].map((index) => (
              <View
                key={index}
                style={[
                  styles.serverSection,
                  {
                    padding: metrics.cardPadding,
                    borderRadius: metrics.cardRadius,
                    backgroundColor: background(theme.colors.surface),
                  },
                ]}>
                <View style={styles.identityRow}>
                  <Skeleton variant="rect" width={AVATAR_SIZE} height={AVATAR_SIZE} />
                  <View style={styles.serverCopy}>
                    <Skeleton variant="text" width="52%" height={18} />
                    <Skeleton variant="text" width="34%" height={12} />
                  </View>
                </View>
              </View>
            ))}
          </Animated.View>
        ) : null}

        {/* Two spacers with different weights, so a short list settles a little
            below the middle of the space it has rather than either floating in
            the centre or being stranded under the header. They are flex, so a
            list long enough to fill the screen squeezes them to nothing and the
            layout goes back to being an ordinary column. There is no `Servers`
            eyebrow above them and no `Add server` beside it: the list is the
            only thing on the screen, so labelling it says nothing, and pairing
            -- which happens once per machine, ever -- belongs in the drawer,
            not in the corner furthest from a thumb. */}
        {!loading ? (
          <View
            style={[
              styles.spacerAbove,
              isPad && styles.padSpacer,
              // An empty screen is one composition -- the mark, then the
              // invitation -- and a composition sits in the space it has. A
              // list does not: it starts where the reader is already looking
              // and lets its slack collect underneath, because a single card
              // marooned at mid-screen reads as a page still loading.
              identity.showBrand && metrics.brand.weight === 'hero' && styles.spacerAboveEmpty,
            ]}
          />
        ) : null}

        {!loading && !hydrationError && records.length === 0 ? (
          <EmptyState isPad={isPad} onPair={() => void commands.pairGateway()} onDemo={openDemo} />
        ) : null}

        <View style={[styles.serverList, { gap: metrics.cardGap }]}>
          {records.map((server) => (
            <ServerCard
              key={server.serverId}
              server={server}
              metrics={metrics}
              selected={server.serverId === record?.serverId}
              showAddress={addressNeeded.has(server.serverId)}
              reachability={resolveServerReachability(
                server.serverId,
                probes[server.serverId],
                activeConnection,
                nowMs
              )}
              agents={agentsByServer[server.serverId]}
              onOpen={() => openServer(server.serverId)}
              onOpenAgent={(agent) => openServer(server.serverId, agent.paneId)}
            />
          ))}
        </View>

        {/* The saved SSH hosts, under the gateways and apart from them: a
            gateway hands the app a workspace, an SSH host is a machine with
            sshd, and the two are added and trusted in different ways -- see
            `SshHostList` for why they are not one list. Absent entirely until
            there is a host to show, so a reader who has never added one is not
            told about the feature by an empty heading; the header's SSH
            button is the door to that. The eyebrow is the one place this
            screen labels a group, because here there are two. */}
        {sshRows.length > 0 ? (
          <Animated.View
            entering={riseIn(records.length * STAGGER.card)}
            layout={listLayout()}
            style={[styles.sshSection, records.length > 0 && { marginTop: metrics.cardGap }]}
            testID="home-ssh-hosts">
            <View style={styles.sshHeading}>
              {/* The same pill the settings page draws over TERMINAL. This
                  screen's whole point is the wallpaper behind it, so the one
                  heading it has is the one that most needs the plate. The row
                  keeps its `Manage` opposite; only the label hugs. */}
              <SectionLabel
                title={<Trans>SSH hosts</Trans>}
                color={theme.colors.textMuted}
                style={styles.sshHeadingLabel}
              />
              {/* The way to the list this section is a view of: adding,
                  editing and forgetting a host happen there, not here. */}
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={t`Manage SSH hosts`}
                hitSlop={8}
                onPress={() => void commands.openSsh()}
                style={styles.sshManage}>
                <Text variant="caption" color={theme.colors.textMuted}>
                  <Trans>Manage</Trans>
                </Text>
                <ChevronRight size={14} color={theme.colors.textMuted} strokeWidth={2} />
              </PressableScale>
            </View>
            <View style={styles.sshList}>
              {sshRows.map((host) => (
                <SshHostRow
                  key={host.id}
                  record={host}
                  nowMs={nowMs}
                  showAddress={false}
                  onOpen={() => openSshHost(host)}
                />
              ))}
            </View>
          </Animated.View>
        ) : null}

        {!loading ? <View style={[styles.spacerBelow, isPad && styles.padSpacer]} /> : null}
      </KeyboardAwareScrollView>
    </View>
  );
  return embedded ? classicContent : <AppDrawer padRail={padRail}>{classicContent}</AppDrawer>;
}

/**
 * One of the header's two controls.
 *
 * The retired hamburger's exact chassis -- 40pt circle, `surface` fill and a
 * muted 20px glyph -- kept deliberately, so the header reads as the
 * same instrument it was rather than as a new bar that appeared where the old
 * one used to be.
 */
function HeaderButton({
  testID,
  label,
  onPress,
  children,
  editorial = false,
}: {
  testID?: string;
  label: string;
  onPress: () => void;
  children: ReactNode;
  editorial?: boolean;
}) {
  const theme = useThemeTokens();
  const background = useSurfaceBackground();
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={onPress}
      style={[
        styles.headerButton,
        { backgroundColor: background(theme.colors.surface), overflow: 'hidden' },
        editorial && {
          width: 44,
          height: 44,
          borderRadius: 5,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.borderStrong,
        },
      ]}>
      <ThemedSurfaceArtwork slot="navigation.background" baseColor={theme.colors.surface} />
      {children}
    </PressableScale>
  );
}

/**
 * One machine, then the panes running on it.
 *
 * The card is an identity block and a list, and nothing draws the relationship
 * between them. It used to: a coral trunk grew out of the status dot and turned
 * into each pane row through a rounded elbow, which made the card read as a
 * process tree. The line was saying what the card's own surface already says --
 * these panes are on this machine -- and at nine rows it was the loudest thing
 * on the screen. What replaces it is arrangement: the identity block is the only
 * thing on the card with an icon and 18pt type, the panes below it share one
 * left edge and one column of status lights, and the gap between the two is the
 * largest on the card. The reader gets the same hierarchy without anything
 * being drawn to assert it.
 */
function ServerCard({
  server,
  metrics,
  selected,
  showAddress,
  reachability,
  agents,
  onOpen,
  onOpenAgent,
}: {
  server: GatewayRecord;
  /** Card geometry and row density for the current window and server count. */
  metrics: HomeServerListLayout;
  selected: boolean;
  /**
   * Another paired server answers to the same name, so this card's address is
   * the only thing telling them apart. False for every unambiguous name, which
   * is nearly always.
   */
  showAddress: boolean;
  reachability: ServerReachability;
  /** Undefined when the setting is off, or the server has never been opened. */
  agents: ServerAgentsSnapshot | undefined;
  onOpen: () => void;
  onOpenAgent: (agent: ServerAgent) => void;
}) {
  const { t } = useLingui();
  // The runtime `_`, for the message descriptors in `@/i18n/labels`. Same
  // reason as `t` above: it comes from the context, so React Compiler can see
  // it change.
  const { _ } = useLinguiRuntime();

  const theme = useThemeTokens();
  const background = useSurfaceBackground();

  // Read at render because freshness is relative to *now*, not to whenever the
  // last state change happened: a card sitting untouched has to keep telling the
  // truth about a snapshot ageing under it. The alternative is a ticking clock
  // in state, which re-renders the whole list to change one label.
  // oxlint-disable-next-line react/purity -- deliberate: see above.
  const nowMs = Date.now();
  const statusColor = reachability === 'live' ? theme.colors.success : theme.colors.textSubtle;

  return (
    // The header and asynchronously refreshed pane rows share one native
    // layout. Do not animate their frames independently or flatten the hosts
    // that establish the rows' offset below the identity block.
    <View collapsable={false}>
      <ThemedSurface
        collapsable={false}
        slot="cards.decoration"
        baseColor={theme.colors.surface}
        style={[
          styles.serverSection,
          {
            padding: metrics.cardPadding,
            borderRadius: metrics.cardRadius,
            overflow: 'hidden',
          },
        ]}>
        <View collapsable={false} style={styles.identityRow}>
          {/* No long press, and no menu: renaming, editing the address and
              unpairing all moved to Settings > SERVERS once that screen could
              do everything a card's old `...` menu could -- see the note on
              `SettingsServers`. A card is a link now, and nothing else. */}
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={t`Open ${server.label}`}
            onPress={onOpen}
            style={styles.identityMain}>
            {/* The one place the accent is spent on this card. It used to be
                spent twice -- here and on the loom -- and with the loom gone the
                avatar is the whole answer to "which machine is the app attached
                to", which is what a single accent per screen is for. */}
            <View
              style={[
                styles.serverAvatar,
                {
                  // The selected tile is solid: `onPrimary` ink is proven
                  // against the full primary, and running it through the
                  // artwork opacity left a faint tile with a glyph nobody
                  // could read on an image pack, next to an unselected tile
                  // whose muted ink still read fine.
                  backgroundColor: selected
                    ? theme.colors.primary
                    : background(theme.colors.surfaceRaised),
                },
              ]}>
              {selected ? (
                <SquareTerminal size={20} color={theme.colors.onPrimary} strokeWidth={2} />
              ) : (
                // The pack's primary, like every other glyph on this screen. The
                // difference between the two tiles is the fill, not the ink: a
                // grey glyph beside rows of accent-coloured ones read as a
                // machine that was switched off, and this one is online.
                <Server size={19} color={theme.colors.primary} strokeWidth={2} />
              )}
            </View>

            <View style={styles.serverCopy}>
              {/* Sentence case on purpose: a machine's name is a proper noun,
                  and the ALL-CAPS register on this screen is reserved for the
                  one instrument label, which is the status.

                  18/600 against the panes' 14 and the address's 12. It used to
                  be 16 against 14 against a 14 all-caps status, which is three
                  sizes inside two points of each other and therefore no
                  hierarchy at all -- the machine has to outrank the things
                  running on it. */}
              <Text variant="subheading" weight="semibold" numberOfLines={1}>
                {server.label}
              </Text>

              {/* The status is the machine's subtitle now, not a row of its own.
                  It was a row because it was the root the tree grew out of, and
                  with no tree that row was a line of 12pt caps sitting alone
                  between the name above it and the list below -- belonging to
                  neither, and pushing the two things that do belong together
                  apart. Under the name it is what it always was: one fact about
                  this machine, said at the smallest size on the card.

                  The dot never speaks alone: `OFFLINE` and `NOT CONNECTED` are
                  the same grey on purpose, and the words and the hollow ring are
                  what tell them apart. It is still the only dot on the screen
                  that pulses. */}
              <View
                accessibilityLabel={_(reachabilityDescription[reachability])}
                style={styles.statusLine}>
                <StatusDot
                  color={statusColor}
                  filled={reachability !== 'unknown'}
                  pulse={reachability === 'live'}
                  size={STATUS_DOT_SIZE}
                />
                <Text variant="caption" color={statusColor} style={styles.statusLabel}>
                  {_(reachabilityLabel[reachability])}
                </Text>
                {/* No count: the rows below are the count, and saying it here as
                    well would be the same fact twice on one card. */}
              </View>

              {/* Only when a second machine answers to the same name. On every
                  other install this line was a constant the reader had already
                  read -- and on a one-server screen it was the address of the
                  only address there is. It is not lost: Settings > SERVERS
                  lists every server with its address, always. */}
              {showAddress ? (
                <Text
                  selectable
                  variant="caption"
                  color={theme.colors.textSubtle}
                  numberOfLines={1}>
                  {server.url}
                </Text>
              ) : null}

              {/* When this gateway rides an SSH host, say so under its status.
                  Renders nothing for a direct gateway. */}
              <GatewayTunnelBadge record={server} />
            </View>
          </PressableScale>

          {/* The one action a card still offers directly: everything else
              that used to live behind the `...` menu -- rename, unpair -- now
              lives in Settings > SERVERS, but New Task has no equivalent
              there. It is not a fact about the server's identity the way a
              name or an address is; it is a shortcut to starting work on it
              without opening it first, which only makes sense from a list of
              servers. `NewTaskAction` renders nothing at all unless this
              gateway has told the app it can spawn one, so most cards spend
              nothing on this slot. When capabilities finish loading, the
              action and identity are measured together by native flex layout. */}
          <View style={styles.serverTrailing}>
            {reachability === 'live' || Boolean(server.sshTunnel) ? (
              <NewTaskAction server={server} serverId={server.serverId} label={server.label} />
            ) : null}
          </View>
        </View>

        {/* `listGap` is the whole grouping device now, so it belongs to the
            list rather than to a spacer between the two: a machine with no
            mirrored panes renders no rows, and a standalone spacer would leave
            that card with a gap under its name separating it from nothing. */}
        <ServerAgentRows
          serverId={server.serverId}
          style={{ marginTop: metrics.listGap }}
          snapshot={agents}
          reachability={reachability}
          rowMinHeight={metrics.rowMinHeight}
          nowMs={nowMs}
          onOpenAgent={onOpenAgent}
        />
      </ThemedSurface>
    </View>
  );
}

/**
 * An empty screen is an invitation to act, so it shows the shape of the thing
 * the user is about to do: the corner brackets are the viewfinder they are
 * going to point at the QR code their Gateway prints.
 */
function EmptyState({
  isPad,
  onPair,
  onDemo,
}: {
  isPad: boolean;
  onPair: () => void;
  onDemo: () => void;
}) {
  const { t } = useLingui();

  const theme = useThemeTokens();
  const corners = [
    { id: 'tl', style: styles.cornerTL },
    { id: 'tr', style: styles.cornerTR },
    { id: 'bl', style: styles.cornerBL },
    { id: 'br', style: styles.cornerBR },
  ];
  const hasIllustration = useHasThemeArtwork('emptyState.illustration');

  return (
    // It had an entrance and no exit, so pairing the first server made this
    // card vanish on one frame while the new one faded in underneath it -- the
    // one moment in the app where two things are meant to hand over cleanly.
    <Animated.View entering={fadeIn('medium')} exiting={fadeOut('short')}>
      <Card padding="none" style={[styles.emptyCard, isPad && styles.padEmptyCard]}>
        {/* The same mark as the pairing screen's aperture, in the same colour,
            at a sixth of the size: this is the shape the reader is about to
            point at their machine. It is drawn in `borderStrong` rather than
            the accent because the accent on this card belongs to the button --
            spending it twice, once on a picture of the action and once on the
            action, is what made the card read as two invitations. */}
        {hasIllustration ? (
          <View
            style={{
              width: isPad ? 180 : 128,
              aspectRatio: 1,
              alignSelf: 'center',
              borderRadius: 24,
              overflow: 'hidden',
            }}>
            <ThemeArtwork slot="emptyState.illustration" />
          </View>
        ) : (
          <View style={styles.scanFrame}>
            {corners.map((corner) => (
              <View
                key={corner.id}
                style={[styles.corner, corner.style, { borderColor: theme.colors.borderStrong }]}
              />
            ))}
            <Server size={26} color={theme.colors.textMuted} strokeWidth={1.8} />
          </View>
        )}
        <View style={[styles.emptyCopy, isPad && styles.padEmptyCopy]}>
          <Text variant="subheading">
            <Trans>Pair your first server</Trans>
          </Text>
          <Text variant="bodySmall" color={theme.colors.textMuted} style={styles.emptyDetail}>
            <Trans>
              Run the Gateway on your machine and scan the QR code it prints. The pairing stays on
              this device.
            </Trans>
          </Text>
        </View>
        <Button
          variant="primary"
          leftIcon="ScanLine"
          accessibilityLabel={t`Pair a server`}
          testID="home-pair-server"
          onPress={onPair}
          style={isPad ? styles.padEmptyAction : styles.emptyAction}>
          {/* `t` rather than `<Trans>`: the design system's Button types its
              children as a string, so the translation has to arrive already
              rendered rather than as an element. */}
          {t`Pair a server`}
        </Button>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t`Try the demo`}
          onPress={onDemo}
          style={styles.demoAction}>
          <Play size={14} color={theme.colors.textMuted} strokeWidth={2.2} />
          <Text variant="bodySmall" color={theme.colors.textMuted}>
            <Trans>Try the demo</Trans>
          </Text>
        </PressableScale>
      </Card>
    </Animated.View>
  );
}

/**
 * The machine's tile. Big enough to be the card's one piece of iconography, so
 * the identity block outranks the list under it on weight alone.
 */
const AVATAR_SIZE = 44;

/**
 * The machine's status light, in the identity block.
 *
 * The same size as the lights leading each pane row. It used to be larger,
 * because it was the root the tree grew out of and had to read as a different
 * kind of mark from the bullets hanging off it. There is no tree, so there is
 * nothing to be the root of: the machine is already told apart from its panes by
 * a 44pt tile and 18pt type, and a dot two points wider than the ones below it
 * was hierarchy asserted twice.
 */
const STATUS_DOT_SIZE = 7;

/**
 * Where a short list puts the space it is not using.
 *
 * One machine with three agents is about a quarter of a phone screen, and no
 * honest layout fills the rest: there is no more to say about one server, and
 * padding the page out with things nobody asked for is how the screen got its
 * eyebrow and its `Add server` in the first place.
 *
 * That much still holds. What did not is *dividing* the slack: splitting it
 * near the middle left a single server marooned halfway down with a screen of
 * nothing above it, which reads as a page still loading rather than a page
 * with one server on it. The list now starts where the reader is already
 * looking -- directly under the wordmark -- and all the slack collects below
 * it, so the emptiness sits where emptiness belongs. Both spacers still
 * collapse the moment the list is tall enough to fill the screen, so this
 * remains a layout that works for more than one server.
 */
const SPACE_ABOVE = 0;
const SPACE_BELOW = 1;

/**
 * The same weight, for the one screen that has no list.
 *
 * The reasoning above is about a *list*: it starts under the wordmark because
 * that is where the reader is already looking, and slack below is honest. With
 * nothing paired there is no list -- there is one invitation, and a card
 * top-aligned above half a screen of nothing reads as a page that failed to
 * finish rather than as a screen waiting to be used. Deliberately less than
 * `SPACE_BELOW`, so the composition still sits above the middle: an invitation
 * centred exactly is a dialog, and this is a page.
 */
const SPACE_ABOVE_EMPTY = 0.55;

/**
 * The floor under `spacerAbove`, regardless of how the flex weights above
 * divide the leftover space.
 *
 * With `SPACE_ABOVE` at 0 this is no longer a spacer that grows -- it is the
 * whole gap between the wordmark and the first section, and it was still the
 * old 18, a number picked back when a large flex-grown spacer did the actual
 * separating and this floor was only there to keep that spacer from
 * collapsing to zero on a tall list. Now it is asked to do the separating on
 * its own, and 18 reads as the wordmark and the list nearly touching -- the
 * hierarchy between "the brand" and "the first thing it's showing you"
 * collapses. `spacing.xl` says "a new group starts here" between two servers,
 * and says it here too: the wordmark and the list are a bigger break than
 * server-to-server, so it does not owe the list less air than the list owes
 * itself.
 */
const BRAND_TO_LIST_GAP = 32;

/**
 * The header's geometry, named because three styles have to agree on it: the
 * bar's own padding, the two controls, and where the folded brand may end.
 *
 * `CONTENT_GUTTER` is `homeServerListLayout`'s compact gutter, repeated here
 * because the bar is outside the scroll view that gets the metrics -- and
 * `BRAND_BLOCK_INSET` is the brand block's own, so their sum is the x the app
 * icon sits at, which is where the folded wordmark has to arrive. The bar only
 * ever renders in compact, so there is no pad value to keep in step.
 */
const CONTENT_GUTTER = 18;
const BRAND_BLOCK_INSET = 2;
const HEADER_GUTTER = CONTENT_GUTTER;
const HEADER_BUTTON_SIZE = 40;
const HEADER_BUTTON_GAP = 8;
/** Breathing room inside the compact brand plate, only when a pack tints it. */
const COMPACT_PLATE_INSET = 10;
/** The bar's row at rest: its controls plus the gaps above and below them. */
const HEADER_ROW_HEIGHT = 54 + NAV_HEADER_TOP_GAP + 8;
/** Within this much of the top the bar never folds. */
const HEADER_FOLD_FREE_ZONE = 24;
/** Scroll travel in one direction, in points, before the bar answers it. */
const HEADER_FOLD_TRAVEL = 8;
/** How far the controls travel into the corner, and how much they shrink, folded. */
const HEADER_FOLD_SLIDE = 12;
const HEADER_FOLD_SHRINK = 0.4;

const styles = StyleSheet.create({
  page: {
    flex: 1,
    overflow: 'hidden',
  },
  embeddedReturnRow: {
    minWidth: 0,
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
  },
  embeddedReturnButton: {
    minWidth: 44,
    minHeight: 44,
    maxWidth: '100%',
    alignSelf: 'flex-start',
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 16,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  embeddedReturnLabel: {
    minWidth: 0,
    flexShrink: 1,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  topBarRow: {
    minHeight: 54,
    // 18, not 16: the gear's right edge lands on the server cards' right edge
    // rather than two points outside their column, so the bar reads as part of
    // the page instead of as something laid over it.
    paddingHorizontal: HEADER_GUTTER,
    // Same gap the pushed-screen and server headers leave above their controls.
    paddingTop: NAV_HEADER_TOP_GAP,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    // The controls are the only thing in the row at rest; the folded brand is
    // absolutely positioned, so it cannot push them around as it fades in.
    justifyContent: 'flex-end',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: HEADER_BUTTON_GAP,
  },
  headerButton: {
    width: HEADER_BUTTON_SIZE,
    height: HEADER_BUTTON_SIZE,
    borderRadius: HEADER_BUTTON_SIZE / 2,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactTitle: {
    position: 'absolute',
    // The brand icon's own x -- the content's 18 plus the brand block's 2 -- so
    // the icon travels straight up out of the block rather than sliding to a
    // centre it never occupied.
    left: CONTENT_GUTTER + BRAND_BLOCK_INSET,
    // Reserve all three actions (SSH, scan, settings), including their gaps.
    right: HEADER_GUTTER + HEADER_BUTTON_SIZE * 3 + HEADER_BUTTON_GAP * 3,
    bottom: 10,
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  // Sized by the mark and the name, never by the frame: a row child takes its
  // content's width, and `flexShrink` is what stops a long name from reaching
  // the buttons instead of truncating.
  compactTitlePlate: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    flexShrink: 1,
    gap: 8,
  },
  compactIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  compactMark: {
    width: '72%',
    height: '72%',
  },
  // `flexShrink`, not `flex`: filling the frame is what made the tinted plate
  // the width of the bar. It still truncates, because it can still shrink.
  compactTitleText: {
    flexShrink: 1,
    minWidth: 0,
    fontWeight: '600',
  },
  // The horizontal inset and the measure come from `homeServerListLayout` at
  // the call site; what is left here is the same in both modes.
  content: {
    flexGrow: 1,
    paddingTop: 10,
    paddingBottom: 40,
  },
  // `width: '100%'` with `alignSelf: 'center'` is what centres the column once
  // the measure caps it: without the explicit width the container shrink-wraps
  // its widest card and a one-server list stops filling the measure at all.
  padContent: {
    width: '100%',
    alignSelf: 'center',
    paddingTop: 32,
    paddingBottom: 32,
  },
  // Both shrink to nothing the moment the list is tall enough to fill the
  // screen, which is what keeps this from being a layout that only works for
  // one server.
  spacerAbove: {
    flexGrow: SPACE_ABOVE,
    flexShrink: 1,
    flexBasis: 0,
    minHeight: BRAND_TO_LIST_GAP,
  },
  spacerAboveEmpty: {
    flexGrow: SPACE_ABOVE_EMPTY,
  },
  spacerBelow: {
    flexGrow: SPACE_BELOW,
    flexShrink: 1,
    flexBasis: 0,
  },
  padSpacer: {
    flexGrow: 1,
    minHeight: 24,
  },
  // Height, gap, tile and type all come from `homeBrandWeight` at the call
  // site, because they change together with whether the screen has content.
  brandBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: BRAND_BLOCK_INSET,
    paddingBottom: 4,
  },
  appIconFrame: {
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  appIcon: {
    width: '70%',
    height: '70%',
  },
  titleCopy: {
    flex: 1,
    gap: 2,
  },
  emptyCard: {
    padding: 24,
    alignItems: 'center',
    gap: 16,
  },
  padEmptyCard: {
    paddingHorizontal: 44,
    paddingVertical: 40,
    borderRadius: 28,
    borderCurve: 'continuous',
    gap: 20,
    boxShadow: '0 16px 44px rgba(0, 0, 0, 0.08)',
  },
  scanFrame: {
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  corner: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderCurve: 'continuous',
  },
  cornerTL: {
    top: 0,
    left: 0,
    borderTopWidth: 2,
    borderLeftWidth: 2,
    borderTopLeftRadius: 7,
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderTopWidth: 2,
    borderRightWidth: 2,
    borderTopRightRadius: 7,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 2,
    borderLeftWidth: 2,
    borderBottomLeftRadius: 7,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 2,
    borderRightWidth: 2,
    borderBottomRightRadius: 7,
  },
  emptyCopy: {
    alignItems: 'center',
    gap: 5,
  },
  padEmptyCopy: {
    width: '100%',
    maxWidth: 520,
  },
  /**
   * No `lineHeight`: 20 is the kit's own 14x1.5 rounded down.
   *
   * This is the centred paragraph on the first screen a new reader ever sees,
   * and it already wraps to three or four lines -- more under a wide face,
   * and every extra line is another chance for a clipped ascender against the
   * line above. The ratio belongs to the type scale, which computes 21 for a
   * `bodySmall`, and the scale is a better judge of it than a number measured
   * once against the system font.
   */
  emptyDetail: { textAlign: 'center' },
  demoAction: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emptyAction: {
    alignSelf: 'stretch',
  },
  padEmptyAction: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
  },
  // `cardGap` at the call site, because it depends on the window.
  serverList: {},
  // Matches SettingsCard: a semantic surface with a continuous corner, no
  // outline. `cardPadding` and `cardRadius` are applied at the call site because
  // they depend on the window and the number of machines on it.
  serverSection: {
    borderCurve: 'continuous',
    // The pane rows' press band bleeds into this padding, so the card is what
    // clips it back to the corner radius.
    overflow: 'hidden',
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  identityMain: {
    flex: 1,
    minWidth: 0,
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  serverAvatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: 14,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  serverCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  statusLine: {
    flexDirection: 'row',
    alignItems: 'center',
    // Clearance for the live dot's ring, which is the one thing on this card
    // that paints outside its own box: `StatusDot` sends it out to 2.6x the
    // dot, so a subtitle gap sized by eye for a static dot has the ring
    // crossing the first letter of ONLINE every two and a half seconds.
    gap: 12,
  },
  statusLabel: {
    letterSpacing: 0.9,
  },
  // A right-aligned row rather than the default stretch column: the slot's
  // width travels between nothing and a 36pt button as `NewTaskAction`'s
  // capability check resolves, and it has to stay pinned to the card's
  // trailing edge while that width changes rather than stretch to fill it.
  serverTrailing: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  // The gap above comes from `cardGap` at the call site, and only when there
  // is a card above to gap from.
  sshSection: {
    gap: 10,
  },
  sshHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    // `SectionLabel` carries the 4pt indent itself, so the row only insets the
    // action opposite it. Keeping both would have moved the heading 4pt right
    // of every card below it -- and a pack's plate does not move it either,
    // because the plate's padding is cancelled by its own negative margin.
    paddingRight: 4,
  },
  // A row's cross axis is vertical, so the pill's own `flex-start` would hang
  // it off the top of the `Manage` button beside it.
  sshHeadingLabel: {
    alignSelf: 'center',
  },
  sshManage: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  // The same gap the list on `/ssh` uses between its rows.
  sshList: {
    gap: 10,
  },
  openCodeCardAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 10,
  },
  openCodeLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  openCodeIconBadge: {
    width: 28,
    height: 28,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  openCodeTitle: {
    fontWeight: '600',
  },
  openCodeRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  openCodeLaunchText: {
    fontWeight: '600',
  },
});
