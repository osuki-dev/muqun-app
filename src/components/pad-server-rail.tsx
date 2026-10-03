import { Trans, useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { Text } from '@/components/text';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { Image, type ImageSource } from 'expo-image';
import { ChevronRight, House, ScanLine, Settings, SquareTerminal } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { HomeRecentSessions } from '@/components/home-recent-sessions';
import { useHomeCommands, type HomeCommandOptions } from '@/hooks/use-home-commands';
import { useHomeRecentsStore } from '@/stores/home-recents';
import { SectionLabel } from '@/components/settings-chrome';
import { HomeConnections } from '@/components/home-connections';
import { ThemedSurfaceArtwork } from '@/components/themed-surface';
import { useThemeLibrary } from '@/stores/theme-library';
import { resolveHomeIdentity } from '@/theme/resolve';
import type { GatewayRecord } from '@/lib/gateway-storage';
import { type ActiveServerConnection, type ServerReachability } from '@/lib/server-reachability';
import type { SshHostRecord } from '@/lib/ssh-hosts';
import { useBrandMark } from '@/components/brand-mark';

export type PadServerRailProps = {
  /** Paired servers in the order the rail should display them. */
  servers: readonly GatewayRecord[];
  reachabilityByServer: Readonly<Record<string, ServerReachability | undefined>>;
  selectedServerId: string | null;
  selectedPaneId?: string | null;
  selectedAsid?: string;
  activeConnection?: ActiveServerConnection;
  /** Whether the retained task owner is currently showing its overview. */
  workbenchSelected?: boolean;
  /** Opens the retained task owner's overview surface. */
  onOpenWorkbench?: () => void;
  onSelectServer: (server: GatewayRecord) => void;
  onPairServer: () => void;
  onOpenSettings: () => void;
  /**
   * The SSH hosts, a plain shell on any machine with sshd. Beside the
   * gateway actions rather than among the servers: it pairs nothing and needs
   * no herdr. Optional so a caller that has no such door renders none.
   */
  onOpenSsh?: () => void;
  /**
   * The saved SSH hosts, already in the order the rail should list them
   * (`sshHomeRows`). Under the gateway servers rather than among them, for
   * the reason `onOpenSsh` gives. Empty or absent renders no group at all.
   */
  sshHosts?: readonly SshHostRecord[];
  /**
   * Opens a host's shell. The rail cannot show the shell in the detail column
   * beside it -- that column is the gateway workspace, keyed by the selected
   * record -- so the caller navigates to the shell's own screen.
   */
  onSelectSshHost?: (host: SshHostRecord) => void;
  /** One clock for every group, so snapshots age consistently. */
  nowMs?: number;
  commandOptions?: HomeCommandOptions;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  /**
   * An identity the caller has already resolved, for a caller that has one.
   *
   * Omitting it no longer means "use the product's own name". This used to be
   * a home-only override, and the result on a tablet was one rail wearing two
   * identities: the home screen said what the pack asked it to say, and the
   * moment the reader opened a terminal the same strip beside them went back
   * to the Muqun mark and the Muqun name. The rail resolves the pack itself
   * now, so every rail agrees without the caller having to remember.
   */
  homeBrand?: { name: string | null; logo: ImageSource | number | null; visible: boolean };
};

/**
 * Persistent master rail for wide layouts.
 *
 * Records and pane mirrors come from the existing owner. Continue uses the
 * shared Home command controller and its read-only session refresh.
 * The ScrollView is local to the rail, so a long server list does not move the
 * terminal detail beside it.
 */
export function PadServerRail({
  servers,
  reachabilityByServer,
  selectedServerId,
  selectedPaneId,
  selectedAsid,
  activeConnection,
  workbenchSelected = false,
  onOpenWorkbench,
  onSelectServer,
  onPairServer,
  onOpenSettings,
  onOpenSsh,
  sshHosts,
  onSelectSshHost,
  // oxlint-disable-next-line react/purity -- a shared render-time freshness boundary.
  nowMs = Date.now(),
  style,
  testID = 'pad-server-rail',
  homeBrand,
  commandOptions,
}: PadServerRailProps) {
  const { t } = useLingui();
  const commands = useHomeCommands(commandOptions);
  const hydrateRecents = useHomeRecentsStore((state) => state.hydrate);
  useEffect(() => {
    void hydrateRecents();
  }, [hydrateRecents]);
  const profile = useAppearanceProfile();
  const theme = useThemeTokens();
  const background = useSurfaceBackground();
  /** Anything in the rail at all -- a paired gateway, or a saved SSH host. */
  const compactActions = servers.length > 0 || (sshHosts?.length ?? 0) > 0;
  const activeTheme = useThemeLibrary((state) => state.active);
  const themeAssets = useThemeLibrary(
    (state) =>
      state.library.themes.find((entry) => entry.id === state.active?.installationId)?.assets
  );
  const [failedLogo, setFailedLogo] = useState<string | null>(null);
  const brandMark = useBrandMark();
  // The caller's answer when it has one, the pack's otherwise. Resolved here so
  // the workspace rail cannot differ from the home rail by omission.
  const brand = useMemo(() => {
    if (homeBrand) return homeBrand;
    const identity = resolveHomeIdentity(activeTheme?.manifest);
    const custom =
      identity.logo?.mode === 'custom' ? themeAssets?.[identity.logo.asset] : undefined;
    return {
      name: identity.name,
      logo: identity.logo ? (custom && custom !== failedLogo ? { uri: custom } : brandMark) : null,
      visible: identity.showBrand,
    };
  }, [homeBrand, activeTheme, themeAssets, failedLogo, brandMark]);

  return (
    <SafeAreaView
      edges={['bottom']}
      testID={testID}
      style={[
        styles.shell,
        { borderRadius: profile.chrome.workspaceRail },
        { backgroundColor: background(theme.colors.surface) },
        {
          borderRightWidth: profile.rail.showsDivider ? StyleSheet.hairlineWidth : 0,
          borderRightColor: theme.colors.border,
        },
        style,
      ]}>
      <ThemedSurfaceArtwork slot="navigation.background" baseColor={theme.colors.surface} />
      {brand.visible !== false ? (
        <View testID={homeBrand ? 'home-brand-rail' : undefined} style={styles.brand}>
          {brand.logo !== null ? (
            <View
              style={[
                styles.brandIconFrame,
                { backgroundColor: background(theme.colors.surfaceRaised) },
                { borderRadius: profile.rail.brandIconRadius },
              ]}>
              <Image
                source={brand.logo ?? brandMark}
                onError={() => {
                  const uri = brand.logo;
                  if (uri && typeof uri === 'object' && 'uri' in uri && uri.uri)
                    setFailedLogo(uri.uri);
                }}
                contentFit="contain"
                style={styles.brandIcon}
              />
            </View>
          ) : null}
          {brand.name !== null ? (
            <View style={styles.brandCopy}>
              <Text
                variant="heading"
                style={{
                  fontSize: profile.rail.brandTitleFontSize,
                  lineHeight: profile.rail.brandTitleLineHeight,
                  letterSpacing: profile.rail.brandTitleLetterSpacing,
                }}>
                {brand.name ?? <Trans>Muqun</Trans>}
              </Text>
              {profile.rail.showsTagline ? (
                <Text variant="caption" color={theme.colors.textMuted}>
                  <Trans>Your agents, anywhere.</Trans>
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}

      {onOpenWorkbench ? (
        <Pressable
          testID={`${testID}-workbench`}
          accessibilityRole="button"
          accessibilityLabel={t`Home`}
          accessibilityState={{ selected: workbenchSelected }}
          onPress={onOpenWorkbench}
          style={({ pressed }) => [
            styles.serverPill,
            { marginBottom: 12 },
            { marginHorizontal: profile.rail.workbenchMarginHorizontal },
            { borderRadius: profile.chrome.railItem },
            {
              borderLeftWidth: profile.rail.selectionBarWidth,
              borderLeftColor: workbenchSelected ? theme.colors.primary : 'transparent',
              paddingLeft: profile.rail.selectionPaddingLeft,
            },
            {
              backgroundColor: background(
                workbenchSelected || pressed ? theme.colors.primarySubtle : 'transparent'
              ),
            },
          ]}>
          <View
            style={[
              styles.serverIcon,
              { backgroundColor: background(theme.colors.surfaceRaised) },
              { borderRadius: profile.rail.itemIconRadius },
            ]}>
            <House size={17} color={theme.colors.primary} strokeWidth={2} />
          </View>
          <View style={styles.serverCopy}>
            <Text variant="bodySmall" numberOfLines={1}>
              <Trans>Home</Trans>
            </Text>
          </View>
        </Pressable>
      ) : null}

      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { gap: profile.rail.contentGap }]}
        keyboardShouldPersistTaps="handled">
        <SectionLabel title={<Trans>Continue</Trans>} color={theme.colors.textMuted} />
        <HomeRecentSessions
          compact
          servers={servers}
          hosts={sshHosts ?? []}
          selectedServerId={selectedServerId ?? undefined}
          selectedPaneId={workbenchSelected ? undefined : (selectedPaneId ?? undefined)}
          selectedAsid={workbenchSelected ? undefined : selectedAsid}
          activeConnection={activeConnection}
          reachabilityByServer={reachabilityByServer}
          onOpen={(command) => {
            void commands.dispatch(command);
          }}
        />
        <SectionLabel title={<Trans>Connections</Trans>} color={theme.colors.textMuted} />
        <HomeConnections
          servers={servers}
          hosts={sshHosts ?? []}
          onOpenServer={(serverId) => {
            const server = servers.find((item) => item.serverId === serverId);
            if (server) onSelectServer(server);
          }}
          onOpenHost={(hostId) => {
            const host = sshHosts?.find((item) => item.id === hostId);
            if (host && onSelectSshHost) onSelectSshHost(host);
          }}
          onManage={() => void commands.manageConnections()}
          nowMs={nowMs}
          activeConnection={activeConnection}
        />
      </ScrollView>

      {/* Three explained rows while the rail is empty, three glyphs once it is
          not.

          On a rail with nothing in it these are the only things to do, and the
          second line under each one is what tells a first-time reader what a
          gateway is and how it differs from an SSH host -- that is onboarding
          and it earns its height. The moment there is a machine in the list,
          the same block is three lines of explanation under the thing the
          reader actually came for, and it is the list that should have the
          room. So it collapses: same three destinations, same order, one row. */}
      {compactActions ? (
        <View
          style={[
            styles.actionBar,
            {
              borderTopWidth: profile.rail.actionsShowDivider ? StyleSheet.hairlineWidth : 0,
              borderTopColor: theme.colors.border,
              paddingTop: profile.rail.actionsPaddingTop,
            },
          ]}>
          <RailGlyphAction label={t`Pair a server`} icon={ScanLine} onPress={onPairServer} />
          {onOpenSsh ? (
            <RailGlyphAction label={t`SSH`} icon={SquareTerminal} onPress={onOpenSsh} />
          ) : null}
          <RailGlyphAction label={t`Settings`} icon={Settings} onPress={onOpenSettings} />
        </View>
      ) : (
        <View
          style={[
            styles.actions,
            {
              borderTopWidth: profile.rail.actionsShowDivider ? StyleSheet.hairlineWidth : 0,
              borderTopColor: theme.colors.border,
              paddingTop: profile.rail.actionsPaddingTop,
            },
          ]}>
          <RailAction
            label={t`Pair a server`}
            detail={t`Scan a gateway QR`}
            icon={ScanLine}
            onPress={onPairServer}
          />
          {onOpenSsh ? (
            <RailAction
              label={t`SSH`}
              detail={t`A shell on any machine with sshd`}
              icon={SquareTerminal}
              onPress={onOpenSsh}
            />
          ) : null}
          <RailAction
            label={t`Settings`}
            detail={t`Appearance, terminal, security`}
            icon={Settings}
            onPress={onOpenSettings}
          />
        </View>
      )}
    </SafeAreaView>
  );
}

/**
 * The same destination as `RailAction`, with the explanation taken away.
 *
 * Its label survives as the accessibility name and nothing is dropped from the
 * rail but the second line, so the reader who needed the sentence -- the one
 * with an empty rail -- still gets it.
 */
function RailGlyphAction({
  label,
  icon: Icon,
  onPress,
}: {
  label: string;
  icon: typeof ScanLine;
  onPress: () => void;
}) {
  const profile = useAppearanceProfile();
  const theme = useThemeTokens();
  const background = useSurfaceBackground();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.glyphAction,
        { borderRadius: profile.chrome.railGlyph },
        {
          backgroundColor: background(
            pressed ? theme.colors.surfaceRaised : theme.colors.background
          ),
        },
      ]}>
      <Icon size={18} color={theme.colors.textMuted} strokeWidth={2} />
    </Pressable>
  );
}

function RailAction({
  label,
  detail,
  icon: Icon,
  onPress,
}: {
  label: string;
  detail: string;
  icon: typeof ScanLine;
  onPress: () => void;
}) {
  const profile = useAppearanceProfile();
  const theme = useThemeTokens();
  const background = useSurfaceBackground();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        { borderRadius: profile.chrome.railAction },
        { backgroundColor: background(pressed ? theme.colors.surfaceRaised : 'transparent') },
      ]}>
      <View
        style={[
          styles.actionIcon,
          { backgroundColor: background(theme.colors.background) },
          { borderRadius: profile.rail.itemIconRadius },
        ]}>
        <Icon size={18} color={theme.colors.textMuted} strokeWidth={2} />
      </View>
      <View style={styles.actionCopy}>
        <Text variant="bodySmall" numberOfLines={1}>
          {label}
        </Text>
        <Text variant="caption" color={theme.colors.textMuted} numberOfLines={1}>
          {detail}
        </Text>
      </View>
      <ChevronRight size={16} color={theme.colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    minWidth: 0,
    borderCurve: 'continuous',
  },
  // 12, not 16: `SectionLabel` carries the remaining 4 itself, so the rail's
  // eyebrow starts on the same x it always did -- and starts there with a
  // wallpaper as well as without one, because the plate gives its extra
  // padding back as a negative margin rather than moving the word.
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
  },
  brandIconFrame: {
    width: 48,
    height: 48,
    borderRadius: 15,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  brandIcon: {
    width: '70%',
    height: '70%',
  },
  brandCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  content: {
    flexGrow: 1,
    gap: 20,
    paddingHorizontal: 10,
    paddingBottom: 24,
  },
  actions: {
    gap: 7,
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 4,
  },
  // The collapsed form: the same padding box as `actions`, so the rail's
  // bottom edge does not move when the first machine arrives -- only the
  // height inside it does.
  actionBar: {
    flexDirection: 'row',
    gap: 7,
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 4,
  },
  glyphAction: {
    flex: 1,
    height: 44,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  action: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderCurve: 'continuous',
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  actionIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionCopy: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  // Inset to the pill's own text edge, so the eyebrow sits over the names
  // rather than over the icons. 2 here plus `SectionLabel`'s own 4 is the 6 it
  // was before the label started carrying its own indent, and a pack's plate
  // does not add to it: the plate's padding is cancelled by its own margin.
  // The pill insets its own icon by `serverPill.paddingHorizontal`, so the pane
  // lights below have to be inset by the same amount to share that left edge.
  // With no loom drawn between the two, that shared edge is the only thing
  // saying the panes belong to the server above them.
  serverPill: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderCurve: 'continuous',
  },
  serverIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  serverCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  // Both gaps are clearance for the live dot's ring rather than optical
  // spacing: `StatusDot` sends it out to 2.6x the dot, past its own box on
  // every side, so at 8 and 5 it crossed the machine's name on one side and the
  // first letter of ONLINE on the other every two and a half seconds.
});
