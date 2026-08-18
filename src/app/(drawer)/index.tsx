import { Button, Card, Skeleton, Text, useThemeTokens } from '@osuki-dev/ui';
import { Image } from 'expo-image';
import { type Href, useFocusEffect, useRouter } from 'expo-router';
import { Play, ScanLine, Server, Settings, SquareTerminal } from 'lucide-react-native';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, StyleSheet, useWindowDimensions, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Trans, useLingui } from '@lingui/react/macro';
import { useLingui as useLinguiRuntime } from '@lingui/react';

import AppDrawer from '@/components/app-drawer';
import { NewTaskAction } from '@/components/new-task-action';
import { PadServerRail } from '@/components/pad-server-rail';
import { PressableScale } from '@/components/pressable-scale';
import { ServerTerminalWorkspace } from '@/components/server-terminal-workspace';
import { ServerAgentRows } from '@/components/server-agent-rows';
import { StatusDot } from '@/components/status-dot';
import { NAV_HEADER_TOP_GAP } from '@/constants/nav-header';
import { reachabilityDescription, reachabilityLabel } from '@/i18n/labels';
import { DEMO_SERVER_ID } from '@/lib/demo-gateway';
import type { GatewayRecord } from '@/lib/gateway-storage';
import { fadeIn, fadeOut, listLayout, riseIn, STAGGER } from '@/lib/motion';
import {
  homeServerListLayout,
  responsiveWorkspaceLayout,
  type HomeServerListLayout,
} from '@/lib/responsive-layout';
import { serverIdsNeedingAddress } from '@/lib/server-address';
import type { ServerAgent, ServerAgentsSnapshot } from '@/lib/server-agents';
import {
  reachabilityFromProbe,
  type ServerReachability,
} from '@/lib/server-reachability';
import { useGatewayRecord } from '@/hooks/use-gateway-record';
import { useServerAgents } from '@/stores/server-agents';
import { useServerReachability } from '@/stores/server-reachability';

const brandMark = require('../../../assets/images/loading-mark.png');

export default function HomeScreen() {
  const { width } = useWindowDimensions();
  const { record, loading } = useGatewayRecord();
  const workspaceLayout = responsiveWorkspaceLayout(width);

  // Wide windows are one persistent workspace. The selected record changes
  // the detail in place; it does not push a second copy of this hierarchy.
  // The key keeps every server-scoped draft, attachment, pane, and request
  // inside the workspace instance that created it.
  if (workspaceLayout.mode === 'pad' && !loading && record) {
    return <ServerTerminalWorkspace key={record.serverId} serverId={record.serverId} />;
  }

  return <ServerList width={width} layoutMode={workspaceLayout.mode} />;
}

function ServerList({ width, layoutMode }: { width: number; layoutMode: 'compact' | 'pad' }) {
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
  const isPad = layoutMode === 'pad';
  // Renaming and unpairing live in Settings, not here: the owner asked for one
  // place that manages servers, and the tablet branch's long-press row menu was
  // a second answer to the same question. The layout work from that branch is
  // kept; its row menu is not.
  const { record, records, loading, selectRecord, enterDemo } = useGatewayRecord();
  const [refreshing, setRefreshing] = useState(false);
  const scrollY = useSharedValue(0);
  // Gutter, measure, card geometry and row density in one answer -- see
  // `homeServerListLayout` for why room, not server count alone, decides it.
  const metrics = homeServerListLayout(width, records.length);

  // Which panes a card lists -- agents only, or every one -- is decided where
  // the mirror is written (`/servers/[serverId]`, gated on `serverCardPanes`),
  // not here: the list always draws whatever the mirror holds.
  const agentsByServer = useServerAgents((state) => state.byServer);
  const hydrateServerAgents = useServerAgents((state) => state.hydrate);
  const keepServerAgents = useServerAgents((state) => state.keepOnly);

  const probes = useServerReachability((state) => state.probes);
  const refreshReachability = useServerReachability((state) => state.refresh);
  const keepReachability = useServerReachability((state) => state.keepOnly);
  const padReachabilityByServer = useMemo(
    () =>
      Object.fromEntries(
        records.map((server) => [server.serverId, reachabilityFromProbe(probes[server.serverId])])
      ),
    [probes, records]
  );

  useEffect(() => {
    void hydrateServerAgents();
  }, [hydrateServerAgents]);

  // Unpairing a server has to take its agent names and its status with it, and
  // this catches every route to that -- Settings > SERVERS, the drawer, a
  // wiped install -- because it follows the record list rather than any one
  // action.
  const serverIds = useMemo(() => records.map((server) => server.serverId), [records]);

  // An address is a disambiguator, so it is on screen exactly when it is
  // disambiguating -- which for most installs is never. See
  // `lib/server-address.ts`; Settings > SERVERS lists every address regardless.
  const addressNeeded = useMemo(() => serverIdsNeedingAddress(records), [records]);

  useEffect(() => {
    if (loading) return;
    void keepServerAgents(serverIds);
    keepReachability(serverIds);
  }, [keepReachability, keepServerAgents, loading, serverIds]);

  // Ask the one server the app is already configured for whether it is there.
  // On focus rather than on an interval: the answer is only worth having while
  // someone is looking at it, and the store rate-limits repeat asks. Every
  // other card says `NOT CONNECTED`, which is the honest description of a
  // machine nobody asked -- see `stores/server-reachability.ts` for why the
  // list does not fan out.
  useFocusEffect(
    useCallback(() => {
      if (!record || record.serverId === DEMO_SERVER_ID) return;
      void refreshReachability({
        serverId: record.serverId,
        url: record.url,
        token: record.token,
        deviceId: record.deviceId,
        transportKey: record.transportKey,
        transport: record.transport,
      });
    }, [record, refreshReachability])
  );

  // A pull is someone asking, so it overrides the store's own rate limit. The
  // focus probe deliberately does not -- it fires on every return to the
  // screen, and honouring all of those would put the pairing token on the wire
  // for a fact the app already has.
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (record && record.serverId !== DEMO_SERVER_ID) {
        await refreshReachability(
          {
            serverId: record.serverId,
            url: record.url,
            token: record.token,
            deviceId: record.deviceId,
            transportKey: record.transportKey,
            transport: record.transport,
          },
          { force: true }
        );
      }
    } finally {
      setRefreshing(false);
    }
  }, [record, refreshReachability]);

  const onScroll = useAnimatedScrollHandler({
    onScroll(event) {
      scrollY.value = event.contentOffset.y;
    },
  });
  const compactTitleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [82, 112], [0, 1], Extrapolation.CLAMP),
    transform: [
      { translateY: interpolate(scrollY.value, [82, 112], [5, 0], Extrapolation.CLAMP) },
    ],
  }));

  function openServer(serverId: string, paneId?: string) {
    // Push straight away so the slide-in is immediate; the server screen
    // selects the record on mount. Awaiting the SecureStore write here left a
    // dead beat that read as no transition at all.
    void selectRecord(serverId);
    router.navigate({
      pathname: '/servers/[serverId]',
      // The same deep link an approval notification uses. Without a pane id the
      // server screen opens on whatever it was last showing, which is the right
      // answer for a tap on the card itself.
      params: paneId ? { serverId, paneId } : { serverId },
    } as Href);
  }

  function openDemo() {
    enterDemo();
    router.navigate({ pathname: '/servers/[serverId]', params: { serverId: DEMO_SERVER_ID } } as Href);
  }

  return (
    <AppDrawer
      padRail={
        isPad ? (
          <PadServerRail
            servers={records}
            agentsByServer={agentsByServer}
            reachabilityByServer={padReachabilityByServer}
            selectedServerId={record?.serverId ?? null}
            onSelectAgent={(server, agent) => openServer(server.serverId, agent.paneId)}
            onPairServer={() => router.push('/explore')}
            onOpenSettings={() => router.push('/settings')}
          />
        ) : undefined
      }>
    <View style={[styles.page, { backgroundColor: theme.colors.background }]}>
      {/* The bar and the brand block below it are one header in two states, not
          two rows. At rest the bar's left half is deliberately empty -- no
          hamburger, no title, no rule, no blur -- because the brand block ten
          points below *is* the title, and repeating it up here is what made the
          batch4 header read as chrome. Past 82pt of scroll the brand walks up
          into the bar and the bar earns its left half. The controls never move,
          so the only thing that changes is where the brand is. */}
        {!isPad ? <SafeAreaView edges={['top']} style={styles.topBar}>
        <Animated.View pointerEvents="none" style={[styles.compactTitle, compactTitleStyle]}>
          <View style={[styles.compactIcon, { backgroundColor: theme.colors.surfaceRaised }]}>
            <Image source={brandMark} contentFit="contain" style={styles.compactMark} />
          </View>
          <Text variant="bodySmall" numberOfLines={1} style={styles.compactTitleText}>
            {t`Muqun`}
          </Text>
        </Animated.View>

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
        <View style={styles.headerActions}>
          <HeaderButton
            label={t`Scan a gateway QR`}
            onPress={() => router.push('/explore')}>
            {/* The same mark as the empty card's corner brackets, at a fifth of
                the size: the one productive gesture on this screen looks the
                same whether it is a 64pt viewfinder in the middle of an empty
                screen or a 20pt glyph in the corner of a full one. */}
            <ScanLine size={20} color={theme.colors.textMuted} strokeWidth={2} />
          </HeaderButton>
          <HeaderButton label={t`Settings`} onPress={() => router.push('/settings')}>
            <Settings size={20} color={theme.colors.textMuted} strokeWidth={2} />
          </HeaderButton>
        </View>
      </SafeAreaView> : null}

      <KeyboardAwareScrollView
        bottomOffset={24}
        extraKeyboardSpace={12}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[
          styles.content,
          isPad && styles.padContent,
          {
            paddingHorizontal: metrics.contentGutter,
            maxWidth: metrics.contentMaxWidth,
          },
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
        {/* The app's name, at the weight the screen's own content leaves for
            it. On an empty screen this block *is* the content and is set as
            such; once a machine is paired the card below is what the reader
            came for, and the name steps back to being the top of the page.
            `listLayout` carries the one change between them, so pairing a first
            server folds the poster down rather than cutting to a smaller one. */}
        {!isPad ? <Animated.View
          entering={riseIn()}
          layout={listLayout('medium')}
          style={[styles.brandBlock, { minHeight: metrics.brand.minHeight, gap: metrics.brand.gap }]}>
          <View
            style={[
              styles.appIconFrame,
              {
                width: metrics.brand.tileSize,
                height: metrics.brand.tileSize,
                borderRadius: metrics.brand.tileRadius,
                boxShadow: metrics.brand.tileShadow,
                backgroundColor: theme.colors.surfaceRaised,
              },
            ]}>
            <Image source={brandMark} contentFit="contain" style={styles.appIcon} />
          </View>
          <View style={styles.titleCopy}>
            <Text
              style={[
                styles.brandTitle,
                {
                  color: theme.colors.text,
                  fontSize: metrics.brand.titleSize,
                  lineHeight: metrics.brand.titleLineHeight,
                  letterSpacing: metrics.brand.titleTracking,
                },
              ]}>
              {t`Muqun`}
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
        </Animated.View> : null}

        {loading ? (
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
                    backgroundColor: theme.colors.surface,
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
              metrics.brand.weight === 'hero' && styles.spacerAboveEmpty,
            ]}
          />
        ) : null}

        {!loading && records.length === 0 ? (
          <EmptyState isPad={isPad} onPair={() => router.push('/explore')} onDemo={openDemo} />
        ) : null}

        <View style={[styles.serverList, { gap: metrics.cardGap }]}>
          {records.map((server, index) => (
            <ServerCard
              key={server.serverId}
              server={server}
              index={index}
              metrics={metrics}
              selected={server.serverId === record?.serverId}
              showAddress={addressNeeded.has(server.serverId)}
              reachability={reachabilityFromProbe(probes[server.serverId])}
              agents={agentsByServer[server.serverId]}
              onOpen={() => openServer(server.serverId)}
              onOpenAgent={(agent) => openServer(server.serverId, agent.paneId)}
            />
          ))}
        </View>

        {!loading ? <View style={[styles.spacerBelow, isPad && styles.padSpacer]} /> : null}
      </KeyboardAwareScrollView>
    </View>
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
  label,
  onPress,
  children,
}: {
  label: string;
  onPress: () => void;
  children: ReactNode;
}) {
  const theme = useThemeTokens();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={onPress}
      style={[
        styles.headerButton,
        { backgroundColor: theme.colors.surface },
      ]}>
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
  index,
  metrics,
  selected,
  showAddress,
  reachability,
  agents,
  onOpen,
  onOpenAgent,
}: {
  server: GatewayRecord;
  index: number;
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

  // Read at render because freshness is relative to *now*, not to whenever the
  // last state change happened: a card sitting untouched has to keep telling the
  // truth about a snapshot ageing under it. The alternative is a ticking clock
  // in state, which re-renders the whole list to change one label.
  // eslint-disable-next-line react-hooks/purity -- deliberate: see above.
  const nowMs = Date.now();
  const statusColor =
    reachability === 'live' ? theme.colors.success : theme.colors.textSubtle;
  // The card arrives, then its panes fill in under it. One sequence per machine,
  // offset so two machines do not narrate at once.
  const cardDelay = index * STAGGER.card;

  return (
    <Animated.View entering={riseIn(cardDelay)} layout={listLayout()}>
      <View
        style={[
          styles.serverSection,
          {
            padding: metrics.cardPadding,
            borderRadius: metrics.cardRadius,
            backgroundColor: theme.colors.surface,
          },
        ]}>
        <View style={styles.identityRow}>
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
                  backgroundColor: selected ? theme.colors.primary : theme.colors.surfaceRaised,
                },
              ]}>
              {selected ? (
                <SquareTerminal size={20} color={theme.colors.onPrimary} strokeWidth={2} />
              ) : (
                <Server size={19} color={theme.colors.textMuted} strokeWidth={2} />
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
                <Text selectable variant="caption" color={theme.colors.textSubtle} numberOfLines={1}>
                  {server.url}
                </Text>
              ) : null}
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
              nothing on this slot. `listLayout` still carries the width
              change between "nothing" and "a button" once capabilities
              finish loading, rather than the slot popping into existence. */}
          <Animated.View style={styles.serverTrailing} layout={listLayout()}>
            <NewTaskAction serverId={server.serverId} label={server.label} />
          </Animated.View>
        </View>

        {/* `listGap` is the whole grouping device now, so it belongs to the
            list rather than to a spacer between the two: a machine with no
            mirrored panes renders no rows, and a standalone spacer would leave
            that card with a gap under its name separating it from nothing. */}
        <ServerAgentRows
          style={{ marginTop: metrics.listGap }}
          snapshot={agents}
          reachability={reachability}
          rowMinHeight={metrics.rowMinHeight}
          entranceDelay={cardDelay + STAGGER.row}
          nowMs={nowMs}
          onOpenAgent={onOpenAgent}
        />
      </View>
    </Animated.View>
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
  const corners = [styles.cornerTL, styles.cornerTR, styles.cornerBL, styles.cornerBR];

  return (
    // It had an entrance and no exit, so pairing the first server made this
    // card vanish on one frame while the new one faded in underneath it -- the
    // one moment in the app where two things are meant to hand over cleanly.
    <Animated.View entering={fadeIn('medium')} exiting={fadeOut('short')}>
      <Card
        padding="none"
        style={[
          styles.emptyCard,
          isPad && styles.padEmptyCard,
        ]}>
        {/* The same mark as the pairing screen's aperture, in the same colour,
            at a sixth of the size: this is the shape the reader is about to
            point at their machine. It is drawn in `borderStrong` rather than
            the accent because the accent on this card belongs to the button --
            spending it twice, once on a picture of the action and once on the
            action, is what made the card read as two invitations. */}
        <View style={styles.scanFrame}>
          {corners.map((corner, index) => (
            <View
              key={index}
              style={[styles.corner, corner, { borderColor: theme.colors.borderStrong }]}
            />
          ))}
          <Server size={26} color={theme.colors.textMuted} strokeWidth={1.8} />
        </View>
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

const styles = StyleSheet.create({
  page: {
    flex: 1,
    overflow: 'hidden',
  },
  topBar: {
    zIndex: 10,
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
    // Clear of both controls and the gap before them.
    right: HEADER_GUTTER + HEADER_BUTTON_SIZE * 2 + HEADER_BUTTON_GAP * 2,
    bottom: 10,
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
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
  compactTitleText: {
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
  // The one place on the screen that spends type, with the tracking pulled in
  // hard so the name reads as a mark rather than as a heading. The size and the
  // tracking travel together in `homeBrandWeight`; the weight does not, because
  // a wordmark that changes stroke weight stops being the same wordmark.
  brandTitle: {
    fontWeight: '700',
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
  emptyDetail: { textAlign: 'center', lineHeight: 20 },
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
});
