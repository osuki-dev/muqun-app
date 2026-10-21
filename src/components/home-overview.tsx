import {
  HOME_TOOLBAR_BUTTON_SIZE,
  HOME_TOOLBAR_ICON_SIZE,
  HOME_TOOLBAR_GAP,
} from '@/constants/home-toolbar';
import { useAppActive } from '@/hooks/use-app-active';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import {
  useThemeMode,
  useThemeTokens,
  Card,
  Skeleton,
  Surface,
  SurfaceDecoration,
  Button,
  PressableScale,
  Text,
} from '@osuki-dev/ui';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { withAlpha } from '@/lib/color';
import { useHomeScenePlate } from '@/hooks/use-home-scene-plate';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import {
  type Href,
  useFocusEffect,
  useIsFocused,
  useLocalSearchParams,
  useRouter,
} from 'expo-router';
import {
  NextIcon,
  StartIcon,
  PairScanIcon,
  ComputerIcon,
  SettingsIcon,
  TerminalWindowIcon,
} from '@/icons';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AppState,
  useWindowDimensions,
  RefreshControl,
  StyleSheet,
  TextInput,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { KeyboardAwareScrollView, useKeyboardState } from 'react-native-keyboard-controller';
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
import { SectionLabel } from '@/components/settings-chrome';
import { GatewayTunnelBadge } from '@/components/gateway-tunnel-badge';
import { HomeArtwork } from '@/components/home-artwork';
import { ThemeIcon } from '@/components/theme-icon';
import { HomeEditorialArtwork } from '@/components/home-editorial-artwork';
import {
  EDITORIAL_MAX_WIDTH,
  EDITORIAL_PAD_MAX_WIDTH,
  HomeEditorialLayout,
  getEditorialLayoutGeometry,
} from '@/components/home-editorial-layout';
import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { HomeConnections } from '@/components/home-connections';
import { HomeAttention, useHasHomeAttention } from '@/components/home-attention';
import {
  HomeComputerCards,
  HomeTaskSync,
  ComputerCardsPresence,
  hasComputerCardsAt,
} from '@/components/home-computer-cards';
import { HomeRecentChips } from '@/components/home-recent-chips';
import { HomeStage } from '@/components/home-stage/home-stage-layout';
import { filterHomeRecent, homeContinueCommand, homeRecentFilterIds } from '@/lib/home-continue';
import {
  HOME_CARD_INSET,
  openTaskWork,
  taskSubscriptionServerIds,
} from '@/lib/home-computer-cards';
import { hasTaskLedger } from '@/lib/task-ledger';
import {
  HomeContinueSearch,
  HomeRecentSessions,
  useHomeRecentEntries,
} from '@/components/home-recent-sessions';
import { homeContinueSearchEnabled } from '@/lib/home-continue-search';
import { demoContinueSearchEntries } from '@/lib/demo-recents';
import { useScreenVisible } from '@/hooks/use-screen-visible';
import { claimHomeFirstEntry, hasHomeComposerRevealed } from '@/lib/home-first-entry';
import { useThemePack } from '@/hooks/use-theme-pack';
import { useLaunchHandoff } from '@/stores/launch-handoff';
import {
  HOME_DOCK_OUTER_BOTTOM_INSET,
  HOME_DOCK_OUTER_INSET,
  nextRestingInset,
  PAD_DOCK_FIELD_LINES,
  padDockOuterInset,
  padHomeColumns,
  padLaunchLayoutEnabled,
  type RestingInset,
} from '@/lib/home-pad-geometry';
import { useDockAutoHide } from '@/hooks/use-dock-auto-hide';
import { resetSortHold, sortHoldScroll, sortHoldTouches } from '@/stores/home-sort-hold';
import {
  HomeLaunchActions,
  HomeLaunchTarget,
  useHomeLaunchController,
} from '@/components/home-launch-actions';
import { HomeComposerDock } from '@/components/home-composer-dock';
import { HomeScrollViewport } from '@/components/home-scroll-viewport';
import { SshHostRow } from '@/components/ssh-host-row';
import { StatusDot } from '@/components/status-dot';
import { NAV_HEADER_TOP_GAP } from '@/constants/nav-header';
import { reachabilityDescription, reachabilityLabel } from '@/i18n/labels';
import { DEMO_SERVER_ID, isDemoRecord } from '@/lib/demo-gateway';
import { demoSshHost } from '@/lib/demo-ssh';
import type { GatewayRecord } from '@/lib/gateway-storage';
import {
  ENTRY_BUDGET_MS,
  fadeIn,
  fadeOut,
  listLayout,
  riseIn,
  STAGGER,
  timing,
} from '@/lib/motion';
import {
  homeServerListLayout,
  homeCoverArtworkHeight,
  THEME_ARTWORK_REGULAR_MIN_WIDTH,
  type HomeServerListLayout,
} from '@/lib/responsive-layout';
import { serverIdsNeedingAddress } from '@/lib/server-address';
import {
  reachabilityOfStatus,
  REACHABILITY_TICK_MS,
  serversToProbe,
  type ActiveServerConnection,
  type ServerReachability,
} from '@/lib/server-reachability';
import { sshHomeRows } from '@/lib/ssh-home';
import type { SshHostRecord } from '@/lib/ssh-hosts';
import { useGatewayRecord } from '@/hooks/use-gateway-record';
import { useFleetLink } from '@/hooks/use-fleet-link';
import { type HomeCommandOptions, useHomeCommands } from '@/hooks/use-home-commands';
import type { HomeServerEntry } from '@/lib/home-commands';
import { GatewayStorageError } from '@/components/gateway-storage-error';
import { useServerAgents } from '@/stores/server-agents';
import { retryHomeRefresh } from '@/lib/home-refresh-schedule';
import { useConnectionStatuses } from '@/hooks/use-home-reachability';
import { useHomeRecentsStore } from '@/stores/home-recents';
import { useHomeAgentChoice } from '@/stores/home-agent-choice';
import { useHomeAttention } from '@/stores/home-attention';
import { useServerTasksStore } from '@/stores/server-tasks';
import { dismissTaskNotices } from '@/stores/in-app-notifications';
import { useServerChannels } from '@/stores/server-channels';
import { serverPrewarmGate, useServerReachability } from '@/stores/server-reachability';
import { useServerSession } from '@/stores/server-session';
import { warmConfiguredWorkspace } from '@/lib/workspace-snapshot';
import { useServerCapabilities } from '@/stores/server-capabilities';
import { showOpeningWhile, taskOpeningKey } from '@/stores/home-task-cards';
import { useServerLastViewed } from '@/stores/server-last-viewed';
import { useSshHostsStore } from '@/stores/ssh-hosts';
import { useThemeLibrary } from '@/stores/theme-library';
import { resolveHomeIdentity } from '@/theme/resolve';
import { isHomeArtworkAvailable, resolveHomeArtworkAsset } from '@/theme/home-artwork';
import { homeArtworkPreference } from '@/theme/repository';
import { ThemeArtwork, useHasThemeArtwork } from '@/components/theme-artwork';
import { DevHomeAmbientControls } from '@/components/dev-home-ambient-controls';
import { DevIconGalleryEntry } from '@/components/dev-icon-gallery';
import { SkiaAmbientEffect } from '@/components/skia-ambient-effect';
import type {
  ThemeAmbientEffect,
  ThemeEffectColorRole,
  ThemeEffectDirection,
} from '@/theme/schema';
import { useBrandMark } from '@/components/brand-mark';
import { forgetWarmWorkspace } from '@/lib/server-warm-cache';
import { settleAfter } from '@/lib/compiler-safe-control-flow';

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
  /** The Pad shell's detail swap: agent rows open beside it instead of on `/agent`. */
  onOpenAgentInPlace?: HomeCommandOptions['openAgentInPlace'];
};

/**
 * The work column's trailing links ("Sessions (N)", "Manage connections"): text
 * 12 under the card (the 44 tap box centres it) and inset to the rows' text.
 */
const PAD_WORK_LINK = { marginTop: 0, paddingVertical: 0, paddingHorizontal: 12 } as const;
export function HomeOverview({
  width,
  layoutMode,
  embedded = false,
  onExitOverview,
  sourceRouteActive,
  routeBound = false,
  activeConnection,
  onOpenAgentInPlace,
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
  // Known only once the library has loaded: until then a pack's cover must not
  // flash the app's own wordmark.
  const themeLibraryHydrated = useThemeLibrary((state) => state.hydrated);
  const identity = resolveHomeIdentity(customTheme?.manifest);
  const hasScene = useHasThemeArtwork('home.wallpaper', 'shell.wallpaper');
  // Opacity audit: Home's section labels ("Computers", "Recent", ...) stand on
  // the plate Home's other headings use, `surface` through the slider, rather
  // than the settings page's opaque one -- an opaque pill beside translucent
  // cards read as the one surface that ignored the setting. Only the fill is
  // taken: where there is no scene there is no plate, and none is added.
  const scenePlate = useHomeScenePlate();
  const labelFill = scenePlate.backgroundColor
    ? { backgroundColor: scenePlate.backgroundColor }
    : null;
  const customAssets = useThemeLibrary((state) => state.activeAssets);
  const [failedLogo, setFailedLogo] = useState<string | null>(null);
  const brandMark = useBrandMark();
  const customLogo =
    identity.logo?.mode === 'custom' ? customAssets?.[identity.logo.asset] : undefined;
  const logoSource = customLogo && customLogo !== failedLogo ? { uri: customLogo } : brandMark;
  const isPad = layoutMode === 'pad';
  const { width: windowWidth, height: windowHeight, fontScale } = useWindowDimensions();
  const showsEditorialBrand = identity.showBrand;
  // Renaming and unpairing live in Settings, not here: the owner asked for one
  // place that manages servers, and the tablet branch's long-press row menu was
  // a second answer to the same question. The layout work from that branch is
  // kept; its row menu is not.
  const { record, records, loading, hydrationError, retryHydration, selectRecord, enterDemo } =
    useGatewayRecord();
  const recordIds = useMemo(() => records.map((server) => server.serverId), [records]);
  const connectionStatuses = useConnectionStatuses(recordIds, record?.serverId, activeConnection);
  const padReachabilityByServer = useMemo(
    () =>
      Object.fromEntries(
        recordIds.map((serverId) => [
          serverId,
          reachabilityOfStatus(connectionStatuses[serverId] ?? 'unknown'),
        ])
      ),
    [connectionStatuses, recordIds]
  );
  // The ledgers Home keeps live: every computer that keeps one and answers,
  // the selected one first, each over its own task-only socket while Home is
  // mounted (see `taskSubscriptionServerIds`). One Home's check says is down
  // is left alone until it answers. Needs you and the cards read them all.
  const capabilitiesByServer = useServerCapabilities((state) => state.byServer);
  const taskServerIds = useMemo(
    () =>
      taskSubscriptionServerIds({
        servers: records,
        selectedId: record?.serverId,
        hasLedger: (serverId) => hasTaskLedger(capabilitiesByServer[serverId]),
        isDemo: (serverId) => serverId === DEMO_SERVER_ID,
        isOffline: (serverId) => padReachabilityByServer[serverId] === 'offline',
      }),
    [records, record?.serverId, capabilitiesByServer, padReachabilityByServer]
  );
  // One card per paired computer; the demo has no ledger and no card.
  const cardServers = useMemo(
    () => records.filter((server) => server.serverId !== DEMO_SERVER_ID),
    [records]
  );
  const [recentServerId, setRecentServerId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const profile = useAppearanceProfile();
  const homeLayout = profile.id;
  const classicLayout = homeLayout === 'classic' && !isPad;
  const [editorialWidth, setEditorialWidth] = useState(0);
  const [editorialArtworkTop, setEditorialArtworkTop] = useState<{
    source: string;
    top: number;
  } | null>(null);
  const [artworkForeground, setArtworkForeground] = useState<{
    source: string;
    foreground: boolean;
  } | null>(null);
  const reportArtworkForeground = useCallback((source: string, foreground: boolean) => {
    setArtworkForeground((current) =>
      current?.source === source && current.foreground === foreground
        ? current
        : { source, foreground }
    );
  }, []);
  const reportEditorialArtworkTop = useCallback((source: string, top: number) => {
    setEditorialArtworkTop((current) =>
      current?.source === source && current.top === top ? current : { source, top }
    );
  }, []);
  const [failedEditorialArtworkSource, setFailedEditorialArtworkSource] = useState<string | null>(
    null
  );
  const { resolvedMode } = useThemeMode();
  const [devEffect, setDevEffect] = useState<ThemeAmbientEffect | 'theme'>('theme');
  const [devEffectIntensity, setDevEffectIntensity] = useState(0.5);
  const [devEffectSpeed, setDevEffectSpeed] = useState(1);
  const [devEffectDensity, setDevEffectDensity] = useState(1);
  const [devEffectSize, setDevEffectSize] = useState(1);
  const [devEffectPalette, setDevEffectPalette] = useState<ThemeEffectColorRole[] | undefined>();
  const [devEffectDirection, setDevEffectDirection] = useState<ThemeEffectDirection | undefined>();
  const hasDevEffectOverride = __DEV__ && devEffect !== 'theme';
  const devAmbientLayer = hasDevEffectOverride ? (
    <SkiaAmbientEffect
      effect={devEffect}
      intensity={devEffectIntensity}
      speed={devEffectSpeed}
      density={devEffectDensity}
      size={devEffectSize}
      palette={devEffectPalette}
      direction={devEffectDirection}
      mode={resolvedMode}
      colors={theme.colors}
    />
  ) : null;
  const devIconGallery = __DEV__ ? <DevIconGalleryEntry /> : null;
  const devAmbientControls = __DEV__ ? (
    <DevHomeAmbientControls
      value={devEffect}
      onChange={setDevEffect}
      intensity={devEffectIntensity}
      onIntensityChange={setDevEffectIntensity}
      speed={devEffectSpeed}
      onSpeedChange={setDevEffectSpeed}
      density={devEffectDensity}
      onDensityChange={setDevEffectDensity}
      size={devEffectSize}
      onSizeChange={setDevEffectSize}
      palette={devEffectPalette}
      onPaletteChange={setDevEffectPalette}
      direction={devEffectDirection}
      onDirectionChange={setDevEffectDirection}
    />
  ) : null;
  const homeArtworkPreferenceValue = useThemeLibrary((state) => {
    const installed = state.library.themes.find(
      (entry) => entry.id === customTheme?.installationId
    );
    return installed ? homeArtworkPreference(installed) : 'theme';
  });
  const artworkWidth = width >= THEME_ARTWORK_REGULAR_MIN_WIDTH ? 'regular' : 'compact';
  const artworkResolution = resolveHomeArtworkAsset({
    manifest: customTheme?.manifest,
    assets: customAssets,
    mode: resolvedMode,
    width: artworkWidth,
    preference: homeArtworkPreferenceValue,
  });
  const editorialArtworkResolution = resolveHomeArtworkAsset({
    manifest: customTheme?.manifest,
    assets: customAssets,
    mode: resolvedMode,
    width: (editorialWidth || width) >= THEME_ARTWORK_REGULAR_MIN_WIDTH ? 'regular' : 'compact',
    preference: homeArtworkPreferenceValue,
  });
  const hasEditorialArtwork =
    !loading &&
    !hydrationError &&
    isHomeArtworkAvailable(editorialArtworkResolution, failedEditorialArtworkSource);
  const hasPairedServer = records.some((server) => server.serverId !== DEMO_SERVER_ID);
  const appActive = useAppActive();
  const isFocused = useIsFocused();
  // The other computers' task sockets live only while Home is on screen --
  // which it still is under a sheet (a dock picker, the Tasks list), so those
  // do not tear the sockets down and read every list again on the way back.
  // The selected one's ledger stays current as it always has (the dock, Needs
  // you and the Continue status read it).
  const homeInView = useScreenVisible(isPad);
  const liveTaskServerIds = useMemo(
    () => (homeInView ? taskServerIds : taskServerIds.filter((id) => id === record?.serverId)),
    [homeInView, taskServerIds, record?.serverId]
  );
  const scrollY = useSharedValue(0);
  // Save only at gesture boundaries, never once per frame on the JS thread.
  // A composition can replace the list chrome, not the reader's scroll intent.
  const overviewScroll = useRef<React.ComponentRef<typeof KeyboardAwareScrollView>>(null);
  const restoredScroll = useRef<React.ComponentRef<typeof KeyboardAwareScrollView>>(null);
  const savedScrollY = useRef(0);
  const [composerRevealed, setComposerRevealed] = useState(hasHomeComposerRevealed);
  const [initialProbeSettled, setInitialProbeSettled] = useState(false);
  const [viewportReady, setViewportReady] = useState(false);
  const launchSettled = useLaunchHandoff((state) => state.settled);
  // The phone dock floats over the page; the page's foot clears it.
  const [dockHeight, setDockHeight] = useState(0);
  const [dockClipHeight, setDockClipHeight] = useState(0);
  // The Pad cover's left column holds still while the dock's field has focus.
  const [dockFocused, setDockFocused] = useState(false);
  // Classic: the pack artwork's measured slot, which the work block overlaps.
  const [classicArtworkHeight, setClassicArtworkHeight] = useState(0);
  const [classicBrandHeight, setClassicBrandHeight] = useState(0);
  const [failedClassicArtworkSource, setFailedClassicArtworkSource] = useState<string | null>(null);
  // On the phone the dock slides out of the way while the page scrolls down.
  // The Pad cover's dock stays fixed at the foot of its column.
  const pageDockHide = useDockAutoHide(dockHeight);
  // Back on Home, the dock is there: a scroll that hid it belonged to the
  // visit that ended.
  const resetDocks = useEffectEvent(() => {
    pageDockHide.reset();
  });
  useEffect(() => {
    if (isFocused) resetDocks();
  }, [isFocused]);
  const rememberScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    savedScrollY.current = event.nativeEvent.contentOffset.y;
  };
  // Also the page's content-size change, which the dock's hide-on-scroll reads.
  const restoreScroll = (_width: number, contentHeight: number) => {
    pageDockHide.settle({ contentHeight });
    if (restoredScroll.current === overviewScroll.current) return;
    overviewScroll.current?.scrollTo({ y: savedScrollY.current, animated: false });
    restoredScroll.current = overviewScroll.current;
  };
  // Gutter, measure, card geometry and row density in one answer -- see
  // `homeServerListLayout` for why room, not server count alone, decides it.
  const metrics = homeServerListLayout(width, records.length);

  const serverAgentsHydrated = useServerAgents((state) => state.hydrated);
  const hydrateServerAgents = useServerAgents((state) => state.hydrate);
  const keepServerAgents = useServerAgents((state) => state.keepOnly);

  const refreshReachabilityMany = useServerReachability((state) => state.refreshMany);
  const refreshReachability = useServerReachability((state) => state.refresh);
  const keepReachability = useServerReachability((state) => state.keepOnly);

  // Whether each computer is answering, from its probe and its live channels
  // (agent socket, terminal stream). Home re-renders only when one of those
  // answers moves -- not when a probe lands or expires with the same answer,
  // and not on a tick. A standalone Home has no active connection override.

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
  // Only computers with work get a card; with none the section is left out.
  // A boolean, so task frames do not re-render all of Home.
  // `ComputerCardsPresence` below keeps this current; Home holds only the answer.
  const [hasComputerCards, setHasComputerCards] = useState(() =>
    hasComputerCardsAt({
      servers: cardServers,
      reachabilityByServer: padReachabilityByServer,
      nowMs: Date.now(),
    })
  );
  // Needs you stays mounted while empty; the Pad cover asks whether it has a row.
  const hasAttention = useHasHomeAttention({ servers: records, taskServerIds });
  const coverHeader = customTheme?.manifest.homePresentation?.header === 'cover';
  // Cards on screen when Home mounts are not arrivals; once the section has
  // emptied, the next card to come is one and enters (and pulses) as such.
  const [cardsSkipEntering, setCardsSkipEntering] = useState(hasComputerCards);
  useEffect(() => {
    if (!hasComputerCards) setCardsSkipEntering(false);
  }, [hasComputerCards]);
  // The launch's first Home: its sections rise in once the records have
  // loaded, and the window closes with the entry budget. A return from a
  // sub-screen (or the Pad shell's Home replacing the first one later) is not
  // an entry.
  // A scroll view that leaves mid-drag never reports its end: let go with Home.
  useEffect(() => resetSortHold, []);
  const [entering, setEntering] = useState(claimHomeFirstEntry);
  const wornTheme = useThemePack();
  const wornThemeRef = useRef(wornTheme);
  useEffect(() => {
    if (wornThemeRef.current === wornTheme) return;
    wornThemeRef.current = wornTheme;
    setEntering(false);
  }, [wornTheme]);
  useEffect(() => {
    if (!entering || loading) return;
    const timer = setTimeout(() => setEntering(false), ENTRY_BUDGET_MS);
    return () => clearTimeout(timer);
  }, [entering, loading]);
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
  // this catches every route to that -- Settings > Computers, the drawer, a
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
    // What this device kept per computer goes with the pairing: its ledger
    // and reported folder, and the dock's folder and model picks.
    useServerTasksStore.getState().keepOnly(serverIds);
    useHomeAgentChoice.getState().keepOnly(serverIds);
  }, [hydrationError, loading, serverIds, sshHosts, sshLoading]);

  // An address is a disambiguator, so it is on screen exactly when it is
  // disambiguating -- which for most installs is never. See
  // `lib/server-address.ts`; Settings > Computers lists every address regardless.
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
      const finishInitialProbe = () => {
        if (current) setInitialProbeSettled(true);
      };
      const shouldContinue = () => current && AppState.currentState === 'active';
      // The dock waits on the selected computer alone: the one the next goal
      // goes to. The others used to be asked first, one after another at up
      // to four seconds each, and the composer waited on all of them; they
      // are asked alongside it now, and their dots fill in as they answer.
      const selected = probeTargets.find((target) => target.serverId === record?.serverId);
      void (selected ? refreshReachability(selected, { shouldContinue }) : Promise.resolve()).then(
        finishInitialProbe,
        finishInitialProbe
      );
      void refreshReachabilityMany(
        probeTargets.filter((target) => target !== selected),
        { shouldContinue }
      );
      return () => {
        current = false;
      };
    }, [
      appActive,
      loading,
      hydrationError,
      probeTargets,
      record?.serverId,
      refreshReachability,
      refreshReachabilityMany,
    ])
  );

  // The computers arrive first. Reuse their bounded initial probe, cached
  // rows and native viewport layout, then one frame so that page can commit
  // before the dock rises. This gate never closes on a refresh, reconnect
  // or return; an empty inventory needs no probe.
  const initialComputersReady =
    !loading &&
    (Boolean(hydrationError) ||
      (serverAgentsHydrated && (records.length === 0 || initialProbeSettled)));
  useEffect(() => {
    if (
      composerRevealed ||
      !initialComputersReady ||
      !viewportReady ||
      (records.length > 0 && !hydrationError && dockHeight === 0) ||
      !launchSettled ||
      !isFocused ||
      !appActive
    )
      return;
    const frame = requestAnimationFrame(() => {
      setComposerRevealed(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [
    composerRevealed,
    initialComputersReady,
    viewportReady,
    records.length,
    hydrationError,
    dockHeight,
    launchSettled,
    isFocused,
    appActive,
  ]);

  // While Home is on screen: re-read freshness every tick, and ask the
  // selected computer again. The store's own limit (one probe per server per
  // `REACHABILITY_RECHECK_MS`) still holds, so the tick costs at most one
  // `/health` every 30 s, and only for the computer the composer sends to.
  useFocusEffect(
    useCallback(() => {
      if (!appActive) return;
      const timer = setInterval(() => {
        const selected = useGatewayConnectionStore.getState().record;
        if (!selected || isDemoRecord(selected) || selected.sshTunnel) return;
        // An open task socket already says the computer is answering; a
        // `/health` on top of it would only repeat that.
        if (useServerChannels.getState().sockets[selected.serverId] === 'open') return;
        void refreshReachability(selected, {
          shouldContinue: () => AppState.currentState === 'active',
        });
      }, REACHABILITY_TICK_MS);
      return () => clearInterval(timer);
    }, [appActive, refreshReachability])
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
    return settleAfter(
      async () => {
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
      },
      () => {
        setRefreshing(false);
      }
    );
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
  // The bottom inset with no keyboard up, which the Pad page is sized from
  // (`nextRestingInset`). Pad only: the phone reads `insets.bottom` and must
  // not re-render on a keyboard showing.
  const keyboardVisible = useKeyboardState((state) => isPad && state.isVisible);
  const [restingInset, setRestingInset] = useState<RestingInset>(() => ({
    inset: insets.bottom,
    width: windowWidth,
    height: windowHeight,
  }));
  useEffect(() => {
    if (!isPad) return;
    setRestingInset((previous) =>
      nextRestingInset(previous, {
        inset: insets.bottom,
        width: windowWidth,
        height: windowHeight,
        keyboardVisible,
        // Any field, not just the dock's: Recent's search and a sheet's field
        // raise the inset before the keyboard reports itself too.
        fieldFocused: TextInput.State.currentlyFocusedInput() != null,
      })
    );
  }, [isPad, keyboardVisible, insets.bottom, windowWidth, windowHeight]);
  const [barHeight, setBarHeight] = useState(insets.top + HEADER_ROW_HEIGHT);
  const barHeightValue = useSharedValue(insets.top + HEADER_ROW_HEIGHT);
  const onScroll = useAnimatedScrollHandler({
    onScroll(event) {
      pageDockHide.scroll(event);
      const y = event.contentOffset.y;
      const delta = y - lastScrollY.value;
      lastScrollY.set(y);
      scrollY.set(y);
      let target = foldTarget.value;
      if (y <= HEADER_FOLD_FREE_ZONE) {
        target = 0;
        travel.set(0);
      } else {
        // Travel accumulates while the direction holds and resets when it
        // turns, so a slow drag folds the bar as surely as a flick and a
        // finger resting on the screen does not flap it.
        travel.set(Math.sign(delta) === Math.sign(travel.value) ? travel.value + delta : delta);
        if (travel.value > HEADER_FOLD_TRAVEL) target = 1;
        else if (travel.value < -HEADER_FOLD_TRAVEL) target = 0;
      }
      // Start the animation only on a change of mind: restarting it on every
      // scroll event would hold the bar half-folded for as long as the finger
      // keeps moving.
      if (target !== foldTarget.value) {
        foldTarget.set(target);
        fold.set(withTiming(target, timing('medium')));
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

  // Links the reader's computers to each other in the background (spec §4.1).
  useFleetLink();
  const commands = useHomeCommands({
    resumeServer: embedded ? undefined : resumeServerTarget,
    embedded,
    routeBound,
    sourceRouteActive,
    openAgentInPlace: onOpenAgentInPlace,
    workspaceServerId: embedded ? activeConnection?.serverId : undefined,
  });
  const launchController = useHomeLaunchController({
    servers: records,
    selectedServerId: record?.serverId,
    connectionStatuses,
    reachabilityByServer: padReachabilityByServer,
    onPair: commands.pairGateway,
  });

  const availableRecentEntries = useHomeRecentEntries({
    // Every layout keeps its pane inventory in Continue; Classic's computer
    // cards below are entry points, not a second list of those panes.
    servers: records,
    hosts: sshRows,
    selectedServerId: launchController.chosen?.serverId,
    reachabilityByServer: padReachabilityByServer,
    activeConnection,
  });
  const { homeContinueFixture } = useLocalSearchParams<{ homeContinueFixture?: string }>();
  const demoSearchEntries = demoContinueSearchEntries(homeContinueFixture, isDemoRecord(record));
  const recentEntries = demoSearchEntries ?? availableRecentEntries;
  const [continueQuery, setContinueQuery] = useState('');
  const searchContinue = homeContinueSearchEnabled(recentEntries.length);
  const recentHeading = searchContinue ? (
    <HomeContinueSearch query={continueQuery} onChange={setContinueQuery} />
  ) : undefined;
  const recentQuery = searchContinue ? continueQuery : '';
  // Recent narrowed to one computer by its chip; a chip whose computer has no
  // rows any more is let go of.
  const recentFilterIds = homeRecentFilterIds(
    recentEntries,
    records.map((server) => server.serverId)
  );
  const recentFilter =
    recentServerId && recentFilterIds.includes(recentServerId) ? recentServerId : null;
  const recentShown = filterHomeRecent(recentEntries, recentFilter);

  function openServer(serverId: string, paneId?: string) {
    retryHomeRefresh(serverId);
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
    if (embedded && activeConnection?.serverId === DEMO_SERVER_ID && onExitOverview) {
      onExitOverview();
      return;
    }
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
    embedded && onExitOverview ? (
      <PressableScale
        testID="home-overview-return-to-task"
        accessibilityRole="button"
        accessibilityLabel={t`Return to task`}
        onPress={onExitOverview}
        style={[
          styles.embeddedReturnButton,
          { backgroundColor: background(theme.colors.surface) },
        ]}>
        <TerminalWindowIcon size={15} color={theme.colors.primary} />
        <Text variant="caption" color={theme.colors.primary} style={styles.embeddedReturnLabel}>
          <Trans>Return to task</Trans>
        </Text>
      </PressableScale>
    ) : null;

  // Whether the measured artwork top belongs to the artwork now resolved. Read
  // here rather than inline in the prop: React Compiler cannot lower an
  // optional chain in a conditional's test.
  const editorialArtworkTopCurrent =
    editorialArtworkTop?.source === editorialArtworkResolution?.source;
  const editorialArtworkSource = editorialArtworkResolution?.source;
  const editorialArtworkForeground =
    artworkForeground === null ||
    artworkForeground.source !== editorialArtworkSource ||
    artworkForeground.foreground;
  // Every layout gets the same dispatch surface -- the dock, Needs you and the
  // computer cards -- built once here; a layout only decides where they go.
  // Classic keeps its own look on the phone; a Pad always takes the editorial
  // spread, and so does any layout added later.
  // Same width and predicate the layout resolves for itself: the Pad cover
  // spread lists eight Continue rows in its work column; other layouts keep theirs.
  // On the Pad the page's height does not follow the keyboard: the bottom
  // inset grows while an on-screen keyboard is up, and a page sized from it
  // would shrink the cover and move every column. Only the dock reacts.
  const pageBottomInset = isPad ? restingInset.inset : insets.bottom;
  const editorialViewportHeight = windowHeight - insets.top - pageBottomInset - 24;
  const padGeometry = getEditorialLayoutGeometry(
    Math.min(editorialWidth || width, isPad ? EDITORIAL_PAD_MAX_WIDTH : EDITORIAL_MAX_WIDTH)
  );
  const padLaunch =
    isPad && padLaunchLayoutEnabled(padGeometry.contentWidth, fontScale, editorialViewportHeight);
  // The Pad work column's width, which decides whether cards sit two abreast.
  const cardGridWidth = padLaunch ? padHomeColumns(padGeometry.innerWidth).work : undefined;
  // Hidden with nothing paired: the pair card is that page's one action.
  const showDock = !hydrationError && !loading && launchController.servers.length > 0;
  // The session screen's own dock, at the foot of the page -- or, on the
  // wide Pad cover, at the foot of the work column.
  // Nothing paired: the pairing call to action.
  const emptyState =
    !hydrationError && !loading && launchController.servers.length === 0 ? (
      <EmptyState
        compact
        isPad={isPad}
        onPair={() => void commands.pairGateway()}
        onDemo={openDemo}
      />
    ) : undefined;
  const dock = showDock ? (
    <HomeComposerDock
      revealed={composerRevealed}
      controller={launchController}
      reachabilityByServer={padReachabilityByServer}
      bottomInset={padLaunch ? 0 : insets.bottom}
      topInset={insets.top}
      // Phone Home has a small gutter outside the field and its shadow.
      // On the Pad cover, the bar is capped at the phone dock's width and
      // centred in the cover column (`padDockOuterInset`), so the field and
      // the theme's decoration fit to it keep the phone's proportions; its
      // rows are padded like the cards' rows, and the field has room for a
      // paragraph. A Pad too narrow for the cover (portrait, large text)
      // keeps the phone's full-width bar.
      outerInsets={
        padLaunch
          ? {
              horizontal: padDockOuterInset(padHomeColumns(padGeometry.innerWidth).cover),
              bottom: 0,
            }
          : isPad
            ? undefined
            : { horizontal: HOME_DOCK_OUTER_INSET, bottom: HOME_DOCK_OUTER_BOTTOM_INSET }
      }
      edgeBar={
        padLaunch
          ? { inset: HOME_CARD_INSET }
          : { inset: classicLayout ? metrics.contentGutter : padGeometry.gutter }
      }
      fieldLines={padLaunch ? PAD_DOCK_FIELD_LINES : undefined}
      onDockHeight={(height, clipHeight) => {
        setDockHeight(height);
        setDockClipHeight(clipHeight);
      }}
      onFieldFocus={isPad ? setDockFocused : undefined}
      // The device class decides, not the layout: a Pad never hides its dock.
      autoHide={isPad ? undefined : pageDockHide.dock}
      onOpenAgent={commands.openAgent}
    />
  ) : null;
  // A computer row sets the dock's target. The bar does not flash for it: the
  // deck is swiped through often, and a ring on the composer at every swipe
  // read as a stuck highlight rather than as news.
  const targetComposer = (serverId: string) => {
    retryHomeRefresh(serverId);
    launchController.choose(serverId);
    void Haptics.selectionAsync();
  };
  const attentionSection =
    !loading && !hydrationError ? (
      <HomeAttention
        servers={records}
        taskServerIds={taskServerIds}
        onOpen={(target) => {
          void commands.resumeTarget(target);
        }}
        // A request is answered where the task runs: its session
        // or its pane, on its own computer.
        onOpenTask={({ serverId, task }) => {
          dismissTaskNotices(task);
          // Opening work on another computer keeps the dock where it is.
          launchController.pinTarget();
          showOpeningWhile(
            taskOpeningKey(serverId, task.taskId),
            openTaskWork(commands, serverId, task)
          );
        }}
      />
    ) : undefined;
  const progressSection =
    !loading && !hydrationError && hasComputerCards ? (
      <HomeComputerCards
        servers={cardServers}
        followedIds={taskServerIds}
        activeConnection={activeConnection}
        skipEntering={cardsSkipEntering}
        gridWidth={cardGridWidth}
        deck={!isPad}
        onSelectServer={targetComposer}
        onOpenHistory={(serverId) =>
          router.push({ pathname: '/server-tasks', params: { serverId } })
        }
        onOpenTask={({ serverId, task, tree }) => {
          // A row opens the session or pane the task runs in; only
          // the sub-task count opens the list of the work under it.
          if (tree) {
            router.push({
              pathname: '/server-tasks',
              params: { serverId, root: task.parentTaskId ?? task.taskId },
            });
            return;
          }
          dismissTaskNotices(task);
          // Opening work on another computer keeps the dock where it is.
          launchController.pinTarget();
          showOpeningWhile(
            taskOpeningKey(serverId, task.taskId),
            openTaskWork(commands, serverId, task)
          );
        }}
      />
    ) : undefined;
  // Continue keeps the full inventory in every layout. Classic uses compact
  // rows above entry-only computer cards; Editorial uses numbered rows.
  const recentSection =
    !loading && !hydrationError && recentEntries.length > 0 ? (
      <HomeRecentSessions
        compact={classicLayout}
        pad={isPad}
        limit={5}
        linkStyle={padLaunch ? PAD_WORK_LINK : undefined}
        selectedServerId={launchController.chosen?.serverId}
        servers={records}
        hosts={sshRows}
        available={recentShown}
        query={recentQuery}
        header={
          recentFilterIds.length > 0 ? (
            <HomeRecentChips
              servers={records}
              serverIds={recentFilterIds}
              value={recentFilter}
              onChange={setRecentServerId}
            />
          ) : undefined
        }
        onOpen={(command) => {
          // QA-only leaves already have read-only snapshots in the demo
          // detail sheet; never send them to a live agent workbench.
          if (demoSearchEntries && command.type === 'open-agent') {
            router.push({
              pathname: '/agent-subagent-detail',
              params: { asid: command.target.asid, sessionId: 'demo' },
            });
            return;
          }
          void commands.dispatch(command);
        }}
      />
    ) : undefined;
  // The phone toolbar's two doors, shared by Editorial and Stage; Stage's
  // float over its world as small translucent rounds.
  const toolbarBare = customTheme?.manifest.homePresentation?.toolbarBackground === false;
  const phoneToolbarFor = (stage: boolean) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: HOME_TOOLBAR_GAP }}>
      <HeaderButton
        editorial={!stage}
        stage={stage}
        bare={toolbarBare}
        label={t`Scan a gateway QR`}
        onPress={() => void commands.pairGateway()}>
        <ThemeIcon
          name="chrome.scan"
          fallback={PairScanIcon}
          size={HOME_TOOLBAR_ICON_SIZE}
          color={theme.colors.text}
        />
      </HeaderButton>
      <HeaderButton
        editorial={!stage}
        stage={stage}
        bare={toolbarBare}
        label={t`Settings`}
        onPress={() => void commands.manageConnections()}>
        <ThemeIcon
          name="chrome.settings"
          fallback={SettingsIcon}
          size={HOME_TOOLBAR_ICON_SIZE}
          color={theme.colors.text}
        />
      </HeaderButton>
    </View>
  );
  const phoneToolbar = phoneToolbarFor(false);
  if (homeLayout === 'stage' && !isPad) {
    // Stage: the theme's world fills the screen under a thin HUD; the
    // composer, Needs you and Recent are the same pieces every layout gets.
    const stageContent = (
      <View style={styles.page} {...sortHoldTouches}>
        <HomeTaskSync serverIds={liveTaskServerIds} />
        <HomeStage
          servers={launchController.servers}
          chosenServerId={launchController.chosen?.serverId}
          connectionStatuses={connectionStatuses}
          recentEntries={recentEntries}
          artwork={
            hasEditorialArtwork && editorialArtworkResolution
              ? {
                  uri: editorialArtworkResolution.source,
                  fit: editorialArtworkResolution.resolved.image.fit,
                  focal: editorialArtworkResolution.resolved.image.focalPoint,
                  opacity: editorialArtworkResolution.resolved.image.opacity,
                }
              : undefined
          }
          coverHeader={coverHeader}
          paused={!isFocused || !appActive}
          topInset={insets.top}
          dockHeight={dock && composerRevealed ? dockHeight : insets.bottom}
          headerAction={phoneToolbarFor(true)}
          hasAttention={!loading && !hydrationError && hasAttention}
          attention={attentionSection}
          fullList={
            <>
              {recentSection}
              {!loading && !hydrationError && !sshLoading ? (
                <HomeConnections
                  servers={records}
                  hosts={sshRows}
                  onOpenServer={openServer}
                  onSelectServer={targetComposer}
                  onOpenHost={(hostId) => {
                    void commands.openSsh(hostId);
                  }}
                  onManage={() => {
                    void commands.manageConnections();
                  }}
                  activeConnection={activeConnection}
                />
              ) : null}
            </>
          }
          emptyState={emptyState}
          storageError={
            hydrationError ? (
              <GatewayStorageError busy={loading} onRetry={retryHydration} />
            ) : undefined
          }
          refreshing={refreshing}
          onRefresh={() => void onRefresh()}
          onSelectServer={targetComposer}
          onOpenServer={openServer}
          onOpenTasks={(serverId) =>
            router.push({ pathname: '/server-tasks', params: { serverId } })
          }
          onOpenDetails={(serverId) =>
            router.push({ pathname: '/settings-servers', params: { serverId } })
          }
          onOpenSession={(entry) => {
            void commands.dispatch(homeContinueCommand(entry.destination));
          }}
          // The host starts a new task on the composer's computer, as Home's
          // New session action does (an offline target opens the picker).
          onNewTask={() => launchController.launchOnChosen(commands.newAgent)}
          onViewport={(height) => {
            pageDockHide.settle({ viewportHeight: height });
            if (height > 0) setViewportReady(true);
          }}
        />
        {dock}
        {devIconGallery}
      </View>
    );
    return embedded ? (
      stageContent
    ) : (
      <AppDrawer wallpaperEffectsEnabled={false}>{stageContent}</AppDrawer>
    );
  }

  if (!classicLayout) {
    const editorialContent = (
      <View
        testID="home-editorial"
        onLayout={(event) => setEditorialWidth(event.nativeEvent.layout.width)}
        // Any finger on the page holds the cards' order (design §9).
        {...sortHoldTouches}
        style={[styles.page, { backgroundColor: background(theme.colors.background) }]}>
        <ThemeArtwork
          slot="home.wallpaper"
          waitForTransition
          fallbackSlot="shell.wallpaper"
          effectsEnabled={!hasDevEffectOverride}
        />
        {devAmbientLayer}
        <HomeTaskSync serverIds={liveTaskServerIds} />
        <ComputerCardsPresence
          servers={cardServers}
          reachabilityByServer={padReachabilityByServer}
          onChange={setHasComputerCards}
        />
        <HomeScrollViewport
          dockHeight={dock && !padLaunch && composerRevealed ? dockClipHeight : 0}
          dockOffset={isPad ? undefined : pageDockHide.dock.offset}
          ref={overviewScroll}
          keyboardShouldPersistTaps="handled"
          // The wide Pad cover holds the dock inside this page, and the dock
          // rides the keyboard by itself; this view must not move it twice.
          enabled={!padLaunch}
          // Elsewhere the dock floats over the page's foot and rises with the
          // keyboard: a field in the page is kept clear of it, not just of the
          // keyboard.
          bottomOffset={dock && !padLaunch ? dockHeight : undefined}
          onContentSizeChange={restoreScroll}
          onLayout={(event) => {
            pageDockHide.settle({ viewportHeight: event.nativeEvent.layout.height });
            if (event.nativeEvent.layout.height > 0 && event.nativeEvent.layout.width > 0)
              setViewportReady(true);
          }}
          onScrollBeginDrag={() => {
            sortHoldScroll.onScrollBeginDrag();
            pageDockHide.beginDrag();
          }}
          onScrollEndDrag={(event) => {
            rememberScroll(event);
            sortHoldScroll.onScrollEndDrag();
            pageDockHide.endDrag();
          }}
          onMomentumScrollBegin={sortHoldScroll.onMomentumScrollBegin}
          onMomentumScrollEnd={(event) => {
            rememberScroll(event);
            sortHoldScroll.onMomentumScrollEnd();
          }}
          contentInsetAdjustmentBehavior="never"
          style={styles.page}
          contentContainerStyle={{
            flexGrow: 1,
            paddingTop: insets.top,
            paddingBottom: (dock && !padLaunch ? dockHeight : insets.bottom) + 24,
          }}
          onScroll={onScroll}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void onRefresh()}
              tintColor={theme.colors.primary}
              progressViewOffset={insets.top}
            />
          }>
          {!isPad && returnToTask ? (
            <View style={styles.embeddedReturnRow}>{returnToTask}</View>
          ) : null}
          {hydrationError ? <GatewayStorageError busy={loading} onRetry={retryHydration} /> : null}
          <View>
            <HomeEditorialLayout
              contentWidth={editorialWidth || width}
              viewportHeight={editorialViewportHeight}
              scrollY={scrollY}
              cover={coverHeader}
              artworkForeground={editorialArtworkForeground}
              topInset={insets.top}
              coverTitle={showsEditorialBrand ? (identity.name ?? undefined) : undefined}
              pad={isPad}
              typographicCover={themeLibraryHydrated && !customTheme}
              coverMark={
                identity.logo ? (
                  <Image
                    source={logoSource}
                    contentFit="contain"
                    style={{ width: 44, height: 44 }}
                    onError={() => setFailedLogo(customLogo ?? null)}
                  />
                ) : undefined
              }
              coverBackdrop={
                // The default theme has no painting and no ambient effect of
                // its own; the static circuit traces (no clock, so nothing to
                // reduce under reduced motion) give the cover a quiet ground.
                hasDevEffectOverride ? undefined : (
                  <SkiaAmbientEffect
                    effect="scanlines"
                    intensity={0.6}
                    palette={['textMuted']}
                    mode={resolvedMode}
                    colors={theme.colors}
                  />
                )
              }
              artworkTopInset={editorialArtworkTopCurrent ? editorialArtworkTop?.top : 0}
              artwork={
                hasEditorialArtwork && editorialArtworkResolution ? (
                  <HomeEditorialArtwork
                    cover={coverHeader}
                    fullBleed={coverHeader && (!isPad || padLaunch)}
                    onForegroundChange={reportArtworkForeground}
                    resolution={editorialArtworkResolution}
                    onVisibleTopChange={reportEditorialArtworkTop}
                    onAvailabilityChange={(available) => {
                      if (!available)
                        setFailedEditorialArtworkSource(editorialArtworkResolution.source);
                    }}
                  />
                ) : null
              }
              identity={
                showsEditorialBrand ? (
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
                        numberOfLines={1}
                        ellipsizeMode="tail"
                        style={{ flexShrink: 1, minWidth: 0, fontSize: 28, lineHeight: 36 }}>
                        {identity.name}
                      </Text>
                    ) : null}
                  </View>
                ) : undefined
              }
              headerLeading={
                // The composer's assignment bar is where a computer is picked;
                // a header dropdown beside it said the same thing twice (and
                // truncated the name to fit). Only while no composer is drawn
                // -- a storage error -- does the header keep the choice.
                isPad || showDock || launchController.servers.length <= 1 ? undefined : (
                  <HomeLaunchTarget
                    wide={isPad}
                    bare={customTheme?.manifest.homePresentation?.toolbarBackground === false}
                    controller={launchController}
                    loading={loading}
                    onPair={commands.pairGateway}
                  />
                )
              }
              padComposer={padLaunch ? dock : undefined}
              padWorkEmpty={padLaunch ? emptyState : undefined}
              padComposerHeight={dockHeight}
              coverPaneKeyboardAware={!dockFocused}
              workScrollEvents={sortHoldScroll}
              entering={entering}
              launches={
                hydrationError || loading ? undefined : launchController.servers.length === 0 ? (
                  // On the Pad cover it heads the work column instead.
                  padLaunch ? undefined : (
                    emptyState
                  )
                ) : (
                  <View style={{ gap: padLaunch ? 12 : 16 }}>
                    {padLaunch ? null : isPad ? (
                      <>
                        {/* No computer picker here: the dock carries the
                            assignment bar, the one place a target is chosen. */}
                        <Text variant="heading" accessibilityRole="header">
                          <Trans>New session</Trans>
                        </Text>
                      </>
                    ) : null}
                    <HomeLaunchActions
                      controller={launchController}
                      grid={isPad}
                      newOnly={isPad}
                      dock={padLaunch}
                      onNewAgent={commands.newAgent}
                      onOpenAgent={commands.openAgent}
                      onNewTerminal={commands.newTerminal}
                      onOpenTerminal={commands.openServer}
                      onSsh={commands.openSsh}
                      onDemo={
                        !loading && !hydrationError && !hasPairedServer ? openDemo : undefined
                      }
                    />
                  </View>
                )
              }
              recent={recentSection}
              recentHeading={recentHeading}
              hasAttention={!loading && !hydrationError && hasAttention}
              attention={attentionSection}
              progress={progressSection}
              connections={
                // The cards are the computers now; this keeps the SSH hosts
                // and the way to manage connections.
                !loading &&
                !hydrationError &&
                !sshLoading &&
                (sshRows.length > 0 || (cardServers.length === 0 && records.length > 0)) ? (
                  <HomeConnections
                    servers={cardServers.length > 0 ? [] : records}
                    hosts={sshRows}
                    onOpenServer={openServer}
                    onSelectServer={targetComposer}
                    onOpenHost={(hostId) => {
                      void commands.openSsh(hostId);
                    }}
                    onManage={() => {
                      void commands.manageConnections();
                    }}
                    activeConnection={activeConnection}
                    linkStyle={padLaunch ? PAD_WORK_LINK : undefined}
                  />
                ) : undefined
              }
              headerAction={
                isPad ? (
                  // The rail no longer sits beside Home, so its three
                  // destinations live here, under the rail's own labels.
                  <View
                    testID="home-pad-toolbar-actions"
                    style={{ flexDirection: 'row', alignItems: 'center', gap: HOME_TOOLBAR_GAP }}>
                    <HeaderButton
                      editorial
                      bare={customTheme?.manifest.homePresentation?.toolbarBackground === false}
                      label={t`Pair a computer`}
                      onPress={() => void commands.pairGateway()}>
                      <ThemeIcon
                        name="chrome.scan"
                        fallback={PairScanIcon}
                        size={HOME_TOOLBAR_ICON_SIZE}
                        color={theme.colors.text}
                      />
                    </HeaderButton>
                    <HeaderButton
                      editorial
                      bare={customTheme?.manifest.homePresentation?.toolbarBackground === false}
                      label={t`SSH`}
                      onPress={() => void commands.openSsh()}>
                      <TerminalWindowIcon size={HOME_TOOLBAR_ICON_SIZE} color={theme.colors.text} />
                    </HeaderButton>
                    <HeaderButton
                      editorial
                      bare={customTheme?.manifest.homePresentation?.toolbarBackground === false}
                      label={t`Settings`}
                      onPress={() => router.push('/settings')}>
                      <ThemeIcon
                        name="chrome.settings"
                        fallback={SettingsIcon}
                        size={HOME_TOOLBAR_ICON_SIZE}
                        color={theme.colors.text}
                      />
                    </HeaderButton>
                  </View>
                ) : (
                  phoneToolbar
                )
              }
            />
          </View>
        </HomeScrollViewport>
        {padLaunch ? null : dock}
        {devAmbientControls}
        {devIconGallery}
      </View>
    );
    return embedded ? (
      editorialContent
    ) : (
      <AppDrawer wallpaperEffectsEnabled={!hasScene && !hasDevEffectOverride}>
        {editorialContent}
      </AppDrawer>
    );
  }

  const classicArtwork =
    !loading &&
    !hydrationError &&
    records.length > 0 &&
    isHomeArtworkAvailable(artworkResolution, failedClassicArtworkSource)
      ? artworkResolution
      : undefined;
  const classicCover = Boolean(classicArtwork && coverHeader);
  const classicBareToolbar =
    classicCover && customTheme?.manifest.homePresentation?.toolbarBackground === false;
  const classicCoverHeight = homeCoverArtworkHeight(Math.min(windowWidth, metrics.contentMaxWidth));
  const classicBrandBlockHeight = identity.showBrand
    ? classicBrandHeight || metrics.brand.minHeight
    : 0;
  const classicArtworkSource = classicArtwork?.source;
  const classicScene =
    classicCover &&
    artworkForeground !== null &&
    artworkForeground.source === classicArtworkSource &&
    !artworkForeground.foreground;
  // Large or wrapped wordmarks stand above the painting instead of covering
  // its subject. Ordinary type shares the theme's quiet header sky.
  const classicCoverTop =
    fontScale >= 1.35 || classicBrandBlockHeight > metrics.brand.minHeight
      ? barHeight + styles.content.paddingTop + classicBrandBlockHeight
      : insets.top;
  // The quiet sky begins below the status bar, behind the fixed controls and
  // the existing wordmark. Its measured wordmark leaves room for large type.
  const classicCoverRemainder = Math.max(
    0,
    classicCoverHeight +
      classicCoverTop -
      barHeight -
      styles.content.paddingTop -
      classicBrandBlockHeight
  );
  // The work block rises over the artwork slot's bottom third; with no
  // artwork it keeps the list's own spacing.
  const artworkOverlap =
    classicArtwork && classicArtworkHeight > 0
      ? Math.round((classicCover ? classicCoverRemainder : classicArtworkHeight) / 3)
      : 0;
  const classicContent = (
    <View
      // Any finger on the page holds the cards' order (design §9).
      {...sortHoldTouches}
      style={[styles.page, { backgroundColor: background(theme.colors.background) }]}>
      <ThemeArtwork
        slot="home.wallpaper"
        waitForTransition
        fallbackSlot="shell.wallpaper"
        effectsEnabled={!hasDevEffectOverride}
      />
      {devAmbientLayer}
      <HomeTaskSync serverIds={liveTaskServerIds} />
      <ComputerCardsPresence
        servers={cardServers}
        reachabilityByServer={padReachabilityByServer}
        onChange={setHasComputerCards}
      />
      {/* The bar and the brand block below it are one header in two states, not
          two rows. At rest the bar's left half is deliberately empty -- no
          hamburger, no title, no rule, no blur -- because the brand block ten
          points below *is* the title, and repeating it up here is what made the
          batch4 header read as chrome. Past 82pt of scroll the brand walks up
          into the bar and the bar earns its left half. The controls never move,
          so the only thing that changes is where the brand is.

          The bar has no surface of its own, so only its buttons take touches:
          the page scrolls under it, and a drag or tap on its empty half
          reaches the page that shows through it. */}
      <Animated.View
        pointerEvents="box-none"
        style={[styles.topBar, barFoldStyle]}
        onLayout={(event: LayoutChangeEvent) => {
          const { height } = event.nativeEvent.layout;
          barHeightValue.set(height);
          setBarHeight(height);
        }}>
        <SafeAreaView edges={['top']} pointerEvents="box-none">
          <View pointerEvents="box-none" style={styles.topBarRow}>
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
                  <SurfaceDecoration
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
            <Animated.View
              pointerEvents="box-none"
              style={[styles.headerActions, headerActionsStyle]}>
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
                    bare={classicBareToolbar}
                    label={t`SSH`}
                    onPress={() => void commands.openSsh()}>
                    <TerminalWindowIcon size={20} color={theme.colors.textMuted} />
                  </HeaderButton>
                  <HeaderButton
                    label={t`Scan a gateway QR`}
                    bare={classicBareToolbar}
                    onPress={() => void commands.pairGateway()}>
                    {/* The same mark as the empty card's corner brackets, at a fifth of
                the size: the one productive gesture on this screen looks the
                same whether it is a 64pt viewfinder in the middle of an empty
                screen or a 20pt glyph in the corner of a full one. */}
                    <ThemeIcon
                      name="chrome.scan"
                      fallback={PairScanIcon}
                      size={20}
                      color={theme.colors.textMuted}
                    />
                  </HeaderButton>
                </>
              )}
              <HeaderButton
                bare={classicBareToolbar}
                label={t`Settings`}
                onPress={() => void commands.manageConnections()}>
                <ThemeIcon
                  name="chrome.settings"
                  fallback={SettingsIcon}
                  size={20}
                  color={theme.colors.textMuted}
                />
              </HeaderButton>
            </Animated.View>
          </View>
        </SafeAreaView>
      </Animated.View>

      <HomeScrollViewport
        dockHeight={dock && composerRevealed ? dockClipHeight : 0}
        dockOffset={pageDockHide.dock.offset}
        ref={overviewScroll}
        onContentSizeChange={restoreScroll}
        onLayout={(event) => {
          pageDockHide.settle({ viewportHeight: event.nativeEvent.layout.height });
          if (event.nativeEvent.layout.height > 0 && event.nativeEvent.layout.width > 0)
            setViewportReady(true);
        }}
        onScrollBeginDrag={() => {
          sortHoldScroll.onScrollBeginDrag();
          pageDockHide.beginDrag();
        }}
        onScrollEndDrag={(event) => {
          rememberScroll(event);
          sortHoldScroll.onScrollEndDrag();
          pageDockHide.endDrag();
        }}
        onMomentumScrollBegin={sortHoldScroll.onMomentumScrollBegin}
        onMomentumScrollEnd={(event) => {
          rememberScroll(event);
          sortHoldScroll.onMomentumScrollEnd();
        }}
        // The dock floats over the page's foot: a field in the page is kept
        // clear of it, not just of the keyboard.
        bottomOffset={dock ? dockHeight : 24}
        extraKeyboardSpace={12}
        contentInsetAdjustmentBehavior="never"
        scrollIndicatorInsets={{ top: barHeight }}
        contentContainerStyle={[
          styles.content,
          isPad && styles.padContent,
          {
            paddingHorizontal: metrics.contentGutter,
            maxWidth: metrics.contentMaxWidth,
          },
          { paddingTop: barHeight + styles.content.paddingTop },
          // Room under the last card above the bar.
          dock && { paddingBottom: dockHeight + theme.spacing.lg },
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
        {classicCover && classicArtwork ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: classicScene ? 0 : classicCoverTop,
              left: 0,
              right: 0,
            }}>
            <HomeArtwork
              resolution={classicArtwork}
              scrollY={scrollY}
              cover
              onForegroundChange={reportArtworkForeground}
              maxHeight={classicCoverHeight}
              onAvailabilityChange={(available) => {
                if (!available) setFailedClassicArtworkSource(classicArtwork.source);
              }}
            />
          </View>
        ) : null}
        {/* The app's name, at the weight the screen's own content leaves for
            it. On an empty screen this block *is* the content and is set as
            such; once a machine is paired the card below is what the reader
            came for, and the name steps back to being the top of the page.
            `listLayout` carries the one change between them, so pairing a first
            server folds the poster down rather than cutting to a smaller one. */}
        {identity.showBrand ? (
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
            layout={listLayout('medium')}
            onLayout={(event) => {
              const height = event.nativeEvent.layout.height;
              setClassicBrandHeight((current) => (current === height ? current : height));
            }}>
            <Animated.View
              style={[
                styles.brandBlock,
                expandedBrandStyle,
                { minHeight: metrics.brand.minHeight, gap: metrics.brand.gap },
                // Full-bleed scenes begin at the status bar. Keep their title
                // in the toolbar's quiet left area rather than on the subject
                // below it. The existing flow reservation still positions cards.
                classicScene && {
                  transform: [{ translateY: insets.top - barHeight }],
                  paddingRight:
                    (hasPairedServer ? 1 : 3) * (HEADER_BUTTON_SIZE + HEADER_BUTTON_GAP),
                },
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
                    hasScene &&
                      !classicCover && {
                        flex: 0,
                        flexShrink: 1,
                        backgroundColor: background(theme.colors.background),
                        padding: 10,
                        borderRadius: 14,
                        overflow: 'hidden',
                      },
                  ]}>
                  {hasScene && !classicCover ? (
                    <SurfaceDecoration
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

        {/* The pack's own illustration, between the header and the machines.
            Absent while the "Pair your first computer" card is up: that card
            already carries `emptyState.illustration`, and two pictures stacked
            on an otherwise empty screen is a gallery rather than an invitation.
            It is also independent of the logo pill above -- a reader can keep
            the mark and drop the picture, or the other way round -- because the
            two answer different questions: what the app is called, and what the
            theme looks like. */}
        {classicArtwork ? (
          <View
            style={classicCover ? { height: classicCoverRemainder } : undefined}
            onLayout={(event) => {
              const height = event.nativeEvent.layout.height;
              setClassicArtworkHeight((current) => (current === height ? current : height));
            }}>
            {classicCover ? null : (
              <HomeArtwork
                resolution={classicArtwork}
                scrollY={scrollY}
                onAvailabilityChange={(available) => {
                  if (!available) setFailedClassicArtworkSource(classicArtwork.source);
                }}
              />
            )}
          </View>
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
            accessibilityLabel={t`Loading computers`}>
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
            layout goes back to being an ordinary column. There is no `Computers`
            eyebrow above them and no `Add server` beside it: the list is the
            only thing on the screen, so labelling it says nothing, and pairing
            -- which happens once per machine, ever -- belongs in the drawer,
            not in the corner furthest from a thumb. */}
        {!loading && !artworkOverlap ? (
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

        {/* The work block. Under a pack's artwork it starts over the slot's
            bottom third, so the figure's lower edge fades under the first
            card instead of leaving a band of nothing above the heading. */}
        {/* The overlap is measured, so it lands a frame after the artwork:
            the shared layout transition carries the block up rather than
            letting it jump (instant under reduce-motion). */}
        <Animated.View
          layout={listLayout()}
          style={artworkOverlap ? { marginTop: -artworkOverlap } : undefined}>
          {/* The shared work and session sections keep their actions in both
              layouts. Classic's connection cards remain underneath them. */}
          {/* Mounted while empty, as on the editorial page, so its first row
              arrives with its pulse; spaced only with a row. */}
          {attentionSection ? (
            <View
              style={
                hasAttention ? { marginBottom: metrics.cardGap, gap: theme.spacing.sm } : undefined
              }>
              {attentionSection}
            </View>
          ) : null}
          {progressSection ? (
            <View style={[{ marginBottom: metrics.cardGap, gap: theme.spacing.sm }]}>
              <SectionLabel
                title={<Trans>Computers</Trans>}
                color={theme.colors.textMuted}
                style={labelFill ? [styles.classicLabel, labelFill] : styles.classicLabel}
              />
              {progressSection}
            </View>
          ) : null}
          {recentSection ? (
            <View style={{ marginBottom: metrics.cardGap }}>
              <View style={{ marginBottom: theme.spacing.sm }}>
                {recentHeading ?? (
                  <SectionLabel
                    title={<Trans>Recent</Trans>}
                    color={theme.colors.textMuted}
                    style={labelFill ? [styles.classicLabel, labelFill] : styles.classicLabel}
                  />
                )}
              </View>
              {recentSection}
            </View>
          ) : null}
          {(progressSection || recentSection) && records.length > 0 ? (
            <SectionLabel
              title={<Trans>Connections</Trans>}
              color={theme.colors.textMuted}
              style={[
                styles.classicLabel,
                { marginBottom: theme.spacing.sm },
                ...(labelFill ? [labelFill] : []),
              ]}
            />
          ) : null}

          {!loading && !hydrationError && records.length === 0 ? (
            <EmptyState
              isPad={isPad}
              onPair={() => void commands.pairGateway()}
              onDemo={openDemo}
            />
          ) : null}

          <View style={[styles.serverList, { gap: metrics.cardGap }]}>
            {records.map((server) => (
              <ServerCard
                key={server.serverId}
                server={server}
                metrics={metrics}
                selected={server.serverId === record?.serverId}
                showAddress={addressNeeded.has(server.serverId)}
                reachability={padReachabilityByServer[server.serverId] ?? 'unknown'}
                onOpen={() => openServer(server.serverId)}
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
                {/* The settings page's pill shape, with Home's plate fill. This
                    screen's whole point is the wallpaper behind it, so the one
                    heading it has is the one that most needs the plate. The row
                    keeps its `Manage` opposite; only the label hugs. */}
                <SectionLabel
                  title={<Trans>SSH hosts</Trans>}
                  color={theme.colors.textMuted}
                  style={labelFill ? [styles.sshHeadingLabel, labelFill] : styles.sshHeadingLabel}
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
                  <ThemeIcon
                    name="home.arrow"
                    fallback={NextIcon}
                    size={14}
                    color={theme.colors.textMuted}
                  />
                </PressableScale>
              </View>
              <View style={styles.sshList}>
                {sshRows.map((host) => (
                  <SshHostRow
                    key={host.id}
                    record={host}
                    showAddress={false}
                    onOpen={() => openSshHost(host)}
                  />
                ))}
              </View>
            </Animated.View>
          ) : null}
        </Animated.View>

        {!loading ? <View style={[styles.spacerBelow, isPad && styles.padSpacer]} /> : null}
      </HomeScrollViewport>
      {dock}
      {devAmbientControls}
      {devIconGallery}
    </View>
  );
  return embedded ? (
    classicContent
  ) : (
    <AppDrawer wallpaperEffectsEnabled={!hasScene && !hasDevEffectOverride}>
      {classicContent}
    </AppDrawer>
  );
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
  stage = false,
  bare = false,
}: {
  testID?: string;
  label: string;
  onPress: () => void;
  children: ReactNode;
  editorial?: boolean;
  /** Stage's HUD: a small round of the theme's surface at low alpha over the world. */
  stage?: boolean;
  bare?: boolean;
}) {
  const profile = useAppearanceProfile();
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
        {
          backgroundColor: bare ? 'transparent' : background(theme.colors.surface),
          overflow: 'hidden',
        },
        editorial && {
          backgroundColor: bare ? 'transparent' : background(theme.colors.surface),
          width: HOME_TOOLBAR_BUTTON_SIZE,
          height: HOME_TOOLBAR_BUTTON_SIZE,
          borderRadius: profile.chrome.control,
        },
        stage && {
          backgroundColor: bare ? 'transparent' : withAlpha(theme.colors.surface, 0.42),
          width: STAGE_HEADER_BUTTON_SIZE,
          height: STAGE_HEADER_BUTTON_SIZE,
          borderRadius: STAGE_HEADER_BUTTON_SIZE / 2,
        },
      ]}>
      {!bare && !stage && (
        <SurfaceDecoration slot="navigation.background" baseColor={theme.colors.surface} />
      )}
      {children}
    </PressableScale>
  );
}

/** Classic's computer and agent entry points; individual panes live in Continue. */
function ServerCard({
  server,
  metrics,
  selected,
  showAddress,
  reachability,
  onOpen,
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
  onOpen: () => void;
}) {
  const { t } = useLingui();
  // The runtime `_`, for the message descriptors in `@/i18n/labels`. Same
  // reason as `t` above: it comes from the context, so React Compiler can see
  // it change.
  const { _ } = useLinguiRuntime();

  const theme = useThemeTokens();
  const background = useSurfaceBackground();
  const { fontScale } = useWindowDimensions();

  return (
    <View collapsable={false}>
      <Surface
        collapsable={false}
        slot="cards.decoration"
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
              unpairing all moved to Settings > Computers once that screen could
              do everything a card's old `...` menu could -- see the note on
              `SettingsServers`. A card is a link now, and nothing else. */}
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={t`Open ${server.label}`}
            onPress={onOpen}
            style={[styles.identityMain, { flexBasis: 160 * Math.max(1, fontScale) }]}>
            {/* The one place the accent is spent on this card. It used to be
                spent twice -- here and on the loom -- and with the loom gone the
                avatar is the whole answer to "which machine is the app attached
                to", which is what a single accent per screen is for. */}
            <View
              style={[
                styles.serverAvatar,
                {
                  // Opacity audit: selection -- the selected tile is solid:
                  // `onPrimary` ink is proven against the full primary, and
                  // running it through the
                  // artwork opacity left a faint tile with a glyph nobody
                  // could read on an image pack, next to an unselected tile
                  // whose muted ink still read fine.
                  backgroundColor: selected
                    ? theme.colors.primary
                    : background(theme.colors.surfaceRaised),
                },
              ]}>
              {/* Every computer wears the computer glyph; the fill alone says
                  which one the app is attached to. Swapping the attached one to
                  a terminal glyph read as a different kind of device. The
                  unselected ink is the pack's primary, like every other glyph
                  here: a grey glyph read as a machine that was switched off. */}
              <ComputerIcon
                size={17}
                color={selected ? theme.colors.onPrimary : theme.colors.primary}
              />
            </View>

            <View style={styles.serverCopy}>
              {/* A machine's name is a proper noun; keep its sentence case. */}
              <Text variant="subheading" weight="semibold" numberOfLines={1}>
                {server.label}
              </Text>

              {/* The connection is a quiet subtitle, paired with a still dot
                  so colour alone never has to explain the machine's state. */}
              <View
                accessibilityLabel={_(reachabilityDescription[reachability])}
                style={styles.statusLine}>
                <StatusDot
                  color={reachability === 'live' ? theme.colors.success : theme.colors.textSubtle}
                  filled={reachability !== 'unknown'}
                  pulse={false}
                  size={STATUS_DOT_SIZE}
                />
                <Text
                  variant="caption"
                  color={theme.colors.textSubtle}
                  numberOfLines={1}
                  style={styles.statusLabel}>
                  {_(reachabilityLabel[reachability])}
                </Text>
              </View>

              {/* Only when a second machine answers to the same name. On every
                  other install this line was a constant the reader had already
                  read -- and on a one-server screen it was the address of the
                  only address there is. It is not lost: Settings > Computers
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
        </View>
        {reachability === 'live' || Boolean(server.sshTunnel) ? (
          <NewTaskAction server={server} serverId={server.serverId} label={server.label} />
        ) : null}
      </Surface>
    </View>
  );
}

/**
 * An empty screen is an invitation to act, so it shows the shape of the thing
 * the user is about to do: the corner brackets are the viewfinder they are
 * going to point at the QR code their Gateway prints.
 */
function EmptyState({
  compact = false,
  isPad,
  onPair,
  onDemo,
}: {
  compact?: boolean;
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
  const hasIllustration = useHasThemeArtwork('empty.artwork');

  return (
    // It had an entrance and no exit, so pairing the first server made this
    // card vanish on one frame while the new one faded in underneath it -- the
    // one moment in the app where two things are meant to hand over cleanly.
    <Animated.View entering={fadeIn('medium')} exiting={fadeOut('short')}>
      <Card
        slot="cards.plain"
        padding="none"
        style={[styles.emptyCard, isPad && styles.padEmptyCard]}>
        {/* The same mark as the pairing screen's aperture, in the same colour,
            at a sixth of the size: this is the shape the reader is about to
            point at their machine. It is drawn in `borderStrong` rather than
            the accent because the accent on this card belongs to the button --
            spending it twice, once on a picture of the action and once on the
            action, is what made the card read as two invitations. */}
        {compact ? null : hasIllustration ? (
          <View
            style={{
              width: isPad ? 180 : 128,
              aspectRatio: 1,
              alignSelf: 'center',
              borderRadius: 24,
              overflow: 'hidden',
            }}>
            <ThemeArtwork slot="empty.artwork" />
          </View>
        ) : (
          <View style={styles.scanFrame}>
            {corners.map((corner) => (
              <View
                key={corner.id}
                style={[styles.corner, corner.style, { borderColor: theme.colors.borderStrong }]}
              />
            ))}
            <ComputerIcon size={26} color={theme.colors.textMuted} />
          </View>
        )}
        <View style={[styles.emptyCopy, isPad && styles.padEmptyCopy]}>
          <Text variant="subheading">
            <Trans>Pair your first computer</Trans>
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
          leftIcon="chrome.scan"
          accessibilityLabel={t`Pair a computer`}
          testID="home-pair-server"
          onPress={onPair}
          style={isPad ? styles.padEmptyAction : styles.emptyAction}>
          {/* `t` rather than `<Trans>`: the design system's Button types its
              children as a string, so the translation has to arrive already
              rendered rather than as an element. */}
          {t`Pair a computer`}
        </Button>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t`Try the demo`}
          onPress={onDemo}
          style={styles.demoAction}>
          <StartIcon size={14} color={theme.colors.textMuted} />
          <Text variant="bodySmall" color={theme.colors.textMuted}>
            <Trans>Try the demo</Trans>
          </Text>
        </PressableScale>
      </Card>
    </Animated.View>
  );
}

/**
 * A quiet machine mark; the name and connection subtitle carry its identity.
 */
const AVATAR_SIZE = 36;

/**
 * The machine's status light, in the identity block.
 *
 * The same size as the lights leading each pane row. It used to be larger,
 * because it was the root the tree grew out of and had to read as a different
 * kind of mark from the bullets hanging off it. There is no tree, so there is
 * nothing to be the root of: the machine is already told apart from its panes by
 * a 36pt tile and 18pt type, and a dot two points wider than the ones below it
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
/** Stage's toolbar rounds: smaller, so the world shows; the hit slop keeps the target. */
const STAGE_HEADER_BUTTON_SIZE = 36;
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
  // The labels hug their text in the classic column.
  classicLabel: { alignSelf: 'flex-start' },
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
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 8,
    rowGap: 4,
  },
  identityMain: {
    flex: 1,
    minHeight: 44,
    minWidth: 0,
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  serverAvatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: 11,
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
    gap: 6,
  },
  statusLabel: {
    letterSpacing: 0.3,
    flexShrink: 1,
    minWidth: 0,
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
