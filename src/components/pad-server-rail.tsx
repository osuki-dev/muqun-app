import { useLingui as useLinguiRuntime } from '@lingui/react';
import { Trans, useLingui } from '@lingui/react/macro';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { Image } from 'expo-image';
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
import type { StyleProp, ViewStyle } from 'react-native';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ServerAgentRows } from '@/components/server-agent-rows';
import { useSshHostAgeLabel } from '@/components/ssh-host-row';
import { StatusDot } from '@/components/status-dot';
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
}: PadServerRailProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const duplicateLabels = duplicatePadServerRailLabels(servers.map((server) => server.label));
  const showsSshHosts = Boolean(sshHosts && sshHosts.length > 0 && onSelectSshHost);

  return (
    <SafeAreaView
      edges={['bottom']}
      testID={testID}
      style={[
        styles.shell,
        { backgroundColor: theme.colors.surface },
        style,
      ]}>
      <View style={styles.brand}>
        <View
          style={[
            styles.brandIconFrame,
            { backgroundColor: theme.colors.surfaceRaised },
          ]}>
          <Image source={brandMark} contentFit="contain" style={styles.brandIcon} />
        </View>
        <View style={styles.brandCopy}>
          <Text variant="heading"><Trans>Muqun</Trans></Text>
          <Text variant="caption" color={theme.colors.textMuted}>
            <Trans>Your agents, anywhere.</Trans>
          </Text>
        </View>
      </View>

      <View style={styles.heading}>
        <Text variant="label" color={theme.colors.textMuted}>
          <Trans>Servers</Trans>
        </Text>
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
              <Text variant="label" color={theme.colors.textMuted}>
                <Trans>SSH hosts</Trans>
              </Text>
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
    </SafeAreaView>
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
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        { backgroundColor: pressed ? theme.colors.surfaceRaised : 'transparent' },
      ]}>
      <View style={[styles.actionIcon, { backgroundColor: theme.colors.background }]}>
        <Icon size={18} color={theme.colors.textMuted} strokeWidth={2} />
      </View>
      <View style={styles.actionCopy}>
        <Text variant="bodySmall" numberOfLines={1}>{label}</Text>
        <Text variant="caption" color={theme.colors.textMuted} numberOfLines={1}>{detail}</Text>
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
  const statusColor = reachability === 'live' ? theme.colors.success : theme.colors.textSubtle;
  const selectedServer = server.serverId === selectedServerId;

  return (
    <View style={styles.group}>
      <View
        accessibilityLabel={`${server.label}, ${_(reachabilityDescription[reachability])}`}
        testID={`${testID}-server-${server.serverId}`}
        style={[
          styles.serverPill,
          { backgroundColor: selectedServer ? theme.colors.primarySubtle : 'transparent' },
        ]}>
        <View
          style={[
            styles.serverIcon,
            { backgroundColor: theme.colors.surfaceRaised },
          ]}>
          <Server size={17} color={theme.colors.textMuted} strokeWidth={2} />
        </View>
        <View style={styles.serverCopy}>
          <View style={styles.serverHeadline}>
            <Text
              variant="bodySmall"
              weight="semibold"
              numberOfLines={1}
              style={styles.serverName}>
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
  const address = sshHomeSubtitle(host);
  const trusted = Boolean(host.trustedHostKey);
  const lastConnected = useSshHostAgeLabel(sshHomeAge(host, nowMs));
  const hint = trusted ? `${address} · ${lastConnected} · ${t`Host key trusted`}` : `${address} · ${lastConnected}`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t`Open SSH host ${host.label}`}
      accessibilityHint={hint}
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [
        styles.serverPill,
        { backgroundColor: pressed ? theme.colors.surfaceRaised : 'transparent' },
      ]}>
      <View style={[styles.serverIcon, { backgroundColor: theme.colors.surfaceRaised }]}>
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
        <Text variant="caption" color={theme.colors.textSubtle} numberOfLines={1}>
          {address}
        </Text>
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
  heading: {
    paddingHorizontal: 16,
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
  // rather than over the icons.
  groupHeading: {
    paddingHorizontal: 6,
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
