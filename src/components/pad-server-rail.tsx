import { useLingui as useLinguiRuntime } from '@lingui/react';
import { Trans, useLingui } from '@lingui/react/macro';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { Image } from 'expo-image';
import { ChevronRight, ScanLine, Server, Settings } from 'lucide-react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ServerAgentRows } from '@/components/server-agent-rows';
import { StatusDot } from '@/components/status-dot';
import { reachabilityDescription, reachabilityLabel } from '@/i18n/labels';
import type { GatewayRecord } from '@/lib/gateway-storage';
import { duplicatePadServerRailLabels } from '@/lib/pad-server-rail';
import { type ServerAgent, type ServerAgentsSnapshot } from '@/lib/server-agents';
import { type ServerReachability } from '@/lib/server-reachability';

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
  // eslint-disable-next-line react-hooks/purity -- a shared render-time freshness boundary.
  nowMs = Date.now(),
  style,
  testID = 'pad-server-rail',
}: PadServerRailProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const duplicateLabels = duplicatePadServerRailLabels(servers.map((server) => server.label));

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
      </ScrollView>

      <View style={styles.actions}>
        <RailAction
          label={t`Pair a server`}
          detail={t`Scan a gateway QR`}
          icon={ScanLine}
          onPress={onPairServer}
        />
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
        keepsAgentDotsFilled
        compactLabels
        onOpenAgent={(agent) => onSelectAgent(server, agent)}
      />
    </View>
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
