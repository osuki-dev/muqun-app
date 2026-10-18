import { Trans, useLingui } from '@lingui/react/macro';
import { useThemeMode, useThemeTokens } from '@osuki-dev/ui';
import { Text } from '@/components/text';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { ChevronLeft, ChevronRight, ScanLine, Settings, SquareTerminal } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { HomeRecentSessions, useHomeRecentEntries } from '@/components/home-recent-sessions';
import { useHomeCommands, type HomeCommandOptions } from '@/hooks/use-home-commands';
import { useHomeRecentsStore } from '@/stores/home-recents';
import { SectionLabel } from '@/components/settings-chrome';
import { HomeConnections } from '@/components/home-connections';
import { ThemedSurfaceArtwork } from '@/components/themed-surface';
import { useThemeLibrary } from '@/stores/theme-library';
import type { GatewayRecord } from '@/lib/gateway-storage';
import { type ActiveServerConnection, type ServerReachability } from '@/lib/server-reachability';
import type { SshHostRecord } from '@/lib/ssh-hosts';
import { homeArtworkPreference } from '@/theme/repository';
import { resolvePadRailArtwork } from '@/theme/pad-rail-artwork';
import { Canvas, Image, LinearGradient, Mask, Rect, useImage, vec } from 'react-native-skia';
import { coveredImageRect } from '@/lib/hero-feather';
import { withAlpha } from '@/lib/color';

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
  /** Returns to the retained Home overview without discarding the detail. */
  onBack: () => void;
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
  onBack,
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
  const recentEntries = useHomeRecentEntries({
    servers,
    hosts: sshHosts ?? [],
    selectedServerId: selectedServerId ?? undefined,
    activeConnection,
    reachabilityByServer,
  });

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
      <PadRailHeader onBack={onBack} testID={`${testID}-back`} />

      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { gap: profile.rail.contentGap }]}
        keyboardShouldPersistTaps="handled">
        {recentEntries.length > 0 ? (
          <>
            <SectionLabel title={<Trans>Continue</Trans>} color={theme.colors.textMuted} />
            <HomeRecentSessions
              compact
              servers={servers}
              hosts={sshHosts ?? []}
              selectedServerId={selectedServerId ?? undefined}
              selectedPaneId={workbenchSelected ? undefined : (selectedPaneId ?? undefined)}
              selectedAsid={workbenchSelected ? undefined : selectedAsid}
              available={recentEntries}
              onOpen={(command) => {
                void commands.dispatch(command);
              }}
            />
          </>
        ) : null}
        {compactActions ? (
          <>
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
          </>
        ) : null}
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
          <RailGlyphAction label={t`Pair a computer`} icon={ScanLine} onPress={onPairServer} />
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
            label={t`Pair a computer`}
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

/** Full-bleed theme art fades into the rail; Back keeps its own readable surface. */
function PadRailHeader({ onBack, testID }: { onBack: () => void; testID: string }) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();
  const active = useThemeLibrary((state) => state.active);
  const assets = useThemeLibrary((state) => state.activeAssets);
  const preference = useThemeLibrary((state) => {
    const installed = state.library.themes.find((entry) => entry.id === active?.installationId);
    return installed ? homeArtworkPreference(installed) : 'theme';
  });
  const { resolvedMode } = useThemeMode();
  const { height } = useWindowDimensions();
  const [width, setWidth] = useState(0);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const artwork = resolvePadRailArtwork({
    manifest: active?.manifest,
    assets,
    mode: resolvedMode,
    preference,
  });
  const source = artwork && artwork.source !== failedSource ? artwork.source : null;
  const image = useImage(source, () => setFailedSource(source));
  const artworkHeight = Math.min(220, height * 0.26);
  const box = { width, height: artworkHeight };
  const imageRect = image
    ? coveredImageRect(
        box,
        { width: image.width(), height: image.height() },
        artwork?.image.focalPoint
      )
    : null;
  return (
    <View
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={[
        styles.railHeader,
        {
          height: source ? artworkHeight : 68,
          borderTopLeftRadius: profile.chrome.workspaceRail,
          borderTopRightRadius: profile.chrome.workspaceRail,
        },
      ]}>
      {image && imageRect ? (
        <View
          testID="pad-rail-artwork"
          pointerEvents="none"
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          style={StyleSheet.absoluteFill}>
          <Canvas style={StyleSheet.absoluteFill}>
            <Mask
              mode="alpha"
              mask={
                <Rect x={0} y={0} width={width} height={artworkHeight}>
                  <LinearGradient
                    start={vec(0, 0)}
                    end={vec(0, artworkHeight)}
                    colors={['white', 'white', 'transparent']}
                    positions={[0, 0.35, 1]}
                  />
                </Rect>
              }>
              <Image
                image={image}
                x={imageRect.x}
                y={imageRect.y}
                width={imageRect.width}
                height={imageRect.height}
                fit="fill"
                opacity={artwork?.image.opacity ?? 1}
              />
            </Mask>
          </Canvas>
        </View>
      ) : null}
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={t`Back to Home`}
        onPress={onBack}
        style={({ pressed }) => [
          styles.backButton,
          { borderRadius: profile.chrome.railItem },
          {
            backgroundColor: withAlpha(
              pressed ? theme.colors.surfaceRaised : theme.colors.surface,
              0.94
            ),
          },
        ]}>
        <ChevronLeft size={20} color={theme.colors.text} strokeWidth={2} />
        <Text variant="bodySmall" color={theme.colors.text}>
          <Trans>Back</Trans>
        </Text>
      </Pressable>
    </View>
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
  railHeader: {
    width: '100%',
    overflow: 'hidden',
    marginBottom: 12,
    borderCurve: 'continuous',
  },
  backButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    gap: 4,
    margin: 12,
    paddingHorizontal: 12,
    borderCurve: 'continuous',
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
});
