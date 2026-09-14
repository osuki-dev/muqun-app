import { useLingui as useLinguiRuntime } from '@lingui/react';
import { Trans, useLingui } from '@lingui/react/macro';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { Image, type ImageSource } from 'expo-image';
import {
  ChevronRight,
  Fingerprint,
  KeyRound,
  Lock,
  ScanLine,
  Server,
  Settings,
  ShieldCheck,
  SquareTerminal,
} from 'lucide-react-native';
import { useMemo, useState } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SectionLabel } from '@/components/settings-chrome';
import { ServerAgentRows } from '@/components/server-agent-rows';
import { useSshHostAgeLabel } from '@/components/ssh-host-row';
import { StatusDot } from '@/components/status-dot';
import { ThemedSurfaceArtwork } from '@/components/themed-surface';
import { useThemeLibrary } from '@/stores/theme-library';
import { resolveHomeIdentity } from '@/theme/resolve';
import { reachabilityDescription, reachabilityLabel } from '@/i18n/labels';
import type { GatewayRecord } from '@/lib/gateway-storage';
import { duplicatePadServerRailLabels } from '@/lib/pad-server-rail';
import { type ServerAgent, type ServerAgentsSnapshot } from '@/lib/server-agents';
import { type ServerReachability } from '@/lib/server-reachability';
import { sshHomeAge, sshHomeSubtitle } from '@/lib/ssh-home';
import type { SshHostRecord } from '@/lib/ssh-hosts';

const brandMark = require('../../assets/images/loading-mark.png');

export type PadServerRailProps = {
  /** Paired servers in the order the rail should display them. */
  servers: readonly GatewayRecord[];
  /** Mirrored snapshots only. Supplying them never opens another connection. */
  agentsByServer: Readonly<Record<string, ServerAgentsSnapshot | undefined>>;
  reachabilityByServer: Readonly<Record<string, ServerReachability | undefined>>;
  selectedServerId: string | null;
  selectedPaneId?: string | null;
  onSelectAgent: (server: GatewayRecord, agent: ServerAgent) => void;
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
 * It owns no stores, effects, or connections: the screen passes its existing
 * records and mirrors in, then handles selection through the two callbacks.
 * The ScrollView is local to the rail, so a long server list does not move the
 * terminal detail beside it.
 */
export function PadServerRail({
  servers,
  agentsByServer,
  reachabilityByServer,
  selectedServerId,
  selectedPaneId,
  onSelectAgent,
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
}: PadServerRailProps) {
  const { t } = useLingui();
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
  }, [homeBrand, activeTheme, themeAssets, failedLogo]);
  const duplicateLabels = duplicatePadServerRailLabels(servers.map((server) => server.label));
  const showsSshHosts = Boolean(sshHosts && sshHosts.length > 0 && onSelectSshHost);

  return (
    <SafeAreaView
      edges={['bottom']}
      testID={testID}
      style={[styles.shell, { backgroundColor: background(theme.colors.surface) }, style]}>
      <ThemedSurfaceArtwork slot="navigation.background" baseColor={theme.colors.surface} />
      {brand.visible !== false ? (
        <View testID={homeBrand ? 'home-brand-rail' : undefined} style={styles.brand}>
          {brand.logo !== null ? (
            <View
              style={[
                styles.brandIconFrame,
                { backgroundColor: background(theme.colors.surfaceRaised) },
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
              <Text variant="heading">{brand.name ?? <Trans>Muqun</Trans>}</Text>
              <Text variant="caption" color={theme.colors.textMuted}>
                <Trans>Your agents, anywhere.</Trans>
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={styles.heading}>
        <SectionLabel title={<Trans>Servers</Trans>} color={theme.colors.textMuted} />
      </View>

      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled">
        {servers.length === 0 ? (
          <Text variant="bodySmall" color={theme.colors.textMuted} style={styles.railEmpty}>
            <Trans>No servers paired yet</Trans>
          </Text>
        ) : (
          servers.map((server) => {
            const reachability = reachabilityByServer[server.serverId] ?? 'unknown';
            const snapshot = agentsByServer[server.serverId];
            return (
              <ServerGroup
                key={server.serverId}
                server={server}
                snapshot={snapshot}
                reachability={reachability}
                selectedServerId={selectedServerId}
                selectedPaneId={selectedPaneId}
                showAddress={duplicateLabels.has(server.label.trim().toLocaleLowerCase())}
                nowMs={nowMs}
                testID={testID}
                onSelectAgent={onSelectAgent}
              />
            );
          })
        )}

        {/* The SSH hosts, as their own group under the servers with their own
            eyebrow: same pill, different door. A gateway entry selects a
            workspace in the column beside this; an SSH entry leaves for the
            shell's own screen, and the reader should not be surprised by
            that. The group is absent until there is a host to list -- the
            `SSH` action below is where a first one is added. */}
        {showsSshHosts && sshHosts && onSelectSshHost ? (
          <View style={styles.group} testID={`${testID}-ssh`}>
            <View style={styles.groupHeading}>
              <SectionLabel title={<Trans>SSH hosts</Trans>} color={theme.colors.textMuted} />
            </View>
            {sshHosts.map((host) => (
              <SshHostPill
                key={host.id}
                host={host}
                nowMs={nowMs}
                testID={`${testID}-ssh-${host.id}`}
                onPress={() => onSelectSshHost(host)}
              />
            ))}
          </View>
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
        <View style={styles.actionBar}>
          <RailGlyphAction label={t`Pair a server`} icon={ScanLine} onPress={onPairServer} />
          {onOpenSsh ? (
            <RailGlyphAction label={t`SSH`} icon={SquareTerminal} onPress={onOpenSsh} />
          ) : null}
          <RailGlyphAction label={t`Settings`} icon={Settings} onPress={onOpenSettings} />
        </View>
      ) : (
        <View style={styles.actions}>
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
  const theme = useThemeTokens();
  const background = useSurfaceBackground();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.glyphAction,
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
  const theme = useThemeTokens();
  const background = useSurfaceBackground();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        { backgroundColor: background(pressed ? theme.colors.surfaceRaised : 'transparent') },
      ]}>
      <View style={[styles.actionIcon, { backgroundColor: background(theme.colors.background) }]}>
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

function ServerGroup({
  server,
  snapshot,
  reachability,
  selectedServerId,
  selectedPaneId,
  showAddress,
  nowMs,
  testID,
  onSelectAgent,
}: {
  server: GatewayRecord;
  snapshot: ServerAgentsSnapshot | undefined;
  reachability: ServerReachability;
  selectedServerId: string | null;
  selectedPaneId: string | null | undefined;
  showAddress: boolean;
  nowMs: number;
  testID: string;
  onSelectAgent: (server: GatewayRecord, agent: ServerAgent) => void;
}) {
  const { _ } = useLinguiRuntime();
  const theme = useThemeTokens();
  const background = useSurfaceBackground();
  const statusColor = reachability === 'live' ? theme.colors.success : theme.colors.textSubtle;
  const selectedServer = server.serverId === selectedServerId;

  return (
    <View style={styles.group}>
      <View
        accessibilityLabel={`${server.label}, ${_(reachabilityDescription[reachability])}`}
        testID={`${testID}-server-${server.serverId}`}
        style={[
          styles.serverPill,
          {
            backgroundColor: background(
              selectedServer ? theme.colors.primarySubtle : 'transparent'
            ),
          },
        ]}>
        <View
          style={[styles.serverIcon, { backgroundColor: background(theme.colors.surfaceRaised) }]}>
          <Server size={17} color={theme.colors.textMuted} strokeWidth={2} />
        </View>
        <View style={styles.serverCopy}>
          <View style={styles.serverHeadline}>
            <Text variant="bodySmall" weight="semibold" numberOfLines={1} style={styles.serverName}>
              {server.label}
            </Text>
            <View style={styles.serverReachability}>
              <StatusDot
                color={statusColor}
                filled={reachability !== 'unknown'}
                pulse={reachability === 'live'}
                size={7}
              />
              <Text variant="caption" color={statusColor} numberOfLines={1}>
                {_(reachabilityLabel[reachability])}
              </Text>
            </View>
          </View>
          {showAddress ? (
            <Text variant="caption" color={theme.colors.textSubtle} numberOfLines={1}>
              {server.url}
            </Text>
          ) : null}
        </View>
      </View>

      <ServerAgentRows
        snapshot={snapshot}
        reachability={reachability}
        rowMinHeight={RAIL_ROW_HEIGHT}
        style={styles.railPanes}
        nowMs={nowMs}
        selectedPaneId={server.serverId === selectedServerId ? selectedPaneId : null}
        showsPressBackground={false}
        compactLabels
        onOpenAgent={(agent) => onSelectAgent(server, agent)}
      />
    </View>
  );
}

/**
 * One SSH host, in the server pill's chassis.
 *
 * The same 34pt circle and two-line copy as a server pill, so the group reads
 * as part of the rail rather than a list pasted under it; what differs is
 * what the parts say. The glyph is the login method (a key, a fingerprint for
 * keyboard-interactive, a lock for a password), the shield beside the name is
 * a pinned host key, and the caption is the address -- which every host shows,
 * since a host with no address is not a host, where a server shows its URL
 * only to tell two of the same name apart. The age is spoken, not drawn: a
 * rail row has one caption line and the address is the one that identifies.
 */
function SshHostPill({
  host,
  nowMs,
  testID,
  onPress,
}: {
  host: SshHostRecord;
  nowMs: number;
  testID: string;
  onPress: () => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const background = useSurfaceBackground();
  const address = sshHomeSubtitle(host);
  const trusted = Boolean(host.trustedHostKey);
  const lastConnected = useSshHostAgeLabel(sshHomeAge(host, nowMs));
  const hint = trusted
    ? `${address} · ${lastConnected} · ${t`Host key trusted`}`
    : `${address} · ${lastConnected}`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t`Open SSH host ${host.label}`}
      accessibilityHint={hint}
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [
        styles.serverPill,
        { backgroundColor: background(pressed ? theme.colors.surfaceRaised : 'transparent') },
      ]}>
      <View
        style={[styles.serverIcon, { backgroundColor: background(theme.colors.surfaceRaised) }]}>
        {host.auth.type === 'privateKey' ? (
          <KeyRound size={17} color={theme.colors.textMuted} strokeWidth={2} />
        ) : host.auth.type === 'keyboardInteractive' ? (
          <Fingerprint size={17} color={theme.colors.textMuted} strokeWidth={2} />
        ) : (
          <Lock size={17} color={theme.colors.textMuted} strokeWidth={2} />
        )}
      </View>
      <View style={styles.serverCopy}>
        <View style={styles.serverHeadline}>
          <Text variant="bodySmall" weight="semibold" numberOfLines={1} style={styles.serverName}>
            {host.label}
          </Text>
          {trusted ? (
            <View importantForAccessibility="no" accessibilityElementsHidden>
              <ShieldCheck size={13} color={theme.colors.success} strokeWidth={2.2} />
            </View>
          ) : null}
        </View>
        {/* No `user@host` here. The rail is a list of things to open, and every
            gateway above it is identified by its name alone; an address under
            one of them is a second line of detail on a row nobody came to
            inspect. It stays in `accessibilityHint` above, because two hosts
            can share a label and a reader who cannot see the row is the one
            who needs the thing that tells them apart. The host list at `/ssh`
            is where an address belongs, and it still shows one. */}
      </View>
      <ChevronRight size={16} color={theme.colors.textMuted} />
    </Pressable>
  );
}

/**
 * A rail row is a navigator entry, not a card row: one line, no cwd, and short
 * enough that a machine with a dozen panes still fits the window.
 */
const RAIL_ROW_HEIGHT = 34;

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    minWidth: 0,
    borderRadius: 28,
    borderCurve: 'continuous',
  },
  // 12, not 16: `SectionLabel` carries the remaining 4 itself, so the rail's
  // eyebrow starts on the same x it always did -- and starts there with a
  // wallpaper as well as without one, because the plate gives its extra
  // padding back as a negative margin rather than moving the word.
  heading: {
    paddingHorizontal: 12,
    paddingTop: 16,
    paddingBottom: 8,
  },
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
  railEmpty: {
    paddingHorizontal: 6,
    paddingVertical: 16,
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
    borderRadius: 12,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  action: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 18,
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
  group: {
    gap: 6,
  },
  // Inset to the pill's own text edge, so the eyebrow sits over the names
  // rather than over the icons. 2 here plus `SectionLabel`'s own 4 is the 6 it
  // was before the label started carrying its own indent, and a pack's plate
  // does not add to it: the plate's padding is cancelled by its own margin.
  groupHeading: {
    paddingHorizontal: 2,
    paddingBottom: 2,
  },
  // The pill insets its own icon by `serverPill.paddingHorizontal`, so the pane
  // lights below have to be inset by the same amount to share that left edge.
  // With no loom drawn between the two, that shared edge is the only thing
  // saying the panes belong to the server above them.
  railPanes: {
    paddingLeft: 10,
  },
  serverPill: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 18,
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
  serverHeadline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  serverName: {
    flexShrink: 1,
  },
  serverReachability: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
});
