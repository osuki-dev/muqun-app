import { useLingui } from '@lingui/react/macro';
import { useLingui as useLinguiRuntime } from '@lingui/react';
import { useThemeTokens } from '@osuki-dev/ui';
import { ChevronRight, Server, SquareTerminal } from 'lucide-react-native';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { Text } from '@/components/text';
import { ThemeIcon } from '@/components/theme-icon';
import { useHomeScenePlate } from '@/hooks/use-home-scene-plate';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { connectionStatusDescription } from '@/i18n/labels';
import type { GatewayRecord } from '@/lib/gateway-storage';
import { serverIdsNeedingAddress } from '@/lib/server-address';
import { resolveConnectionStatus, type ActiveServerConnection } from '@/lib/server-reachability';
import type { SshHostRecord } from '@/lib/ssh-hosts';
import { activeTaskCount } from '@/lib/server-tasks-state';
import { hasTaskLedger } from '@/lib/task-ledger';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import { useServerCapabilities } from '@/stores/server-capabilities';
import { useServerChannels } from '@/stores/server-channels';
import { useServerReachability } from '@/stores/server-reachability';
import { useServerTasksStore } from '@/stores/server-tasks';

/** Saved destinations, independent of task status and the selected Home layout. */
export function HomeConnections({
  servers,
  hosts,
  onOpenServer,
  onSelectServer,
  onOpenHost,
  onManage,
  activeConnection,
  nowMs,
  linkStyle,
}: {
  servers: readonly GatewayRecord[];
  hosts: readonly SshHostRecord[];
  onOpenServer: (serverId: string) => void;
  /**
   * When given, a tap makes the computer the composer's target and a long
   * press opens it; without it (the Pad rail) a tap opens it, as before.
   */
  onSelectServer?: (serverId: string) => void;
  onOpenHost: (hostId: string) => void;
  onManage: () => void;
  activeConnection?: ActiveServerConnection;
  nowMs?: number;
  /** Overrides the `Manage connections` link's box, e.g. to inset it like the rows. */
  linkStyle?: StyleProp<ViewStyle>;
}) {
  const { t } = useLingui();
  const profile = useAppearanceProfile();
  const theme = useThemeTokens();
  const background = useSurfaceBackground();
  const addresses = serverIdsNeedingAddress(servers);
  const hasConnections = servers.length > 0 || hosts.length > 0;
  const emptyPlate = useHomeScenePlate();
  const plated = !hasConnections && emptyPlate.backgroundColor !== undefined;
  return (
    <View testID="home-connections" style={styles.list}>
      {hasConnections ? (
        <View style={[styles.connectionGroup, { borderRadius: profile.chrome.surface }]}>
          {servers.map((server, index) => (
            <GatewayConnectionRow
              key={server.serverId}
              server={server}
              showAddress={addresses.has(server.serverId)}
              hasSeparator={index < servers.length + hosts.length - 1}
              onOpen={onOpenServer}
              onSelect={onSelectServer}
              activeConnection={activeConnection}
              nowMs={nowMs}
            />
          ))}
          {hosts.map((host, index) => (
            <PressableScale
              key={host.id}
              testID={`home-connection-ssh-${host.id}`}
              accessibilityRole="button"
              accessibilityLabel={`${host.label}, ${t`Saved SSH host`}`}
              onPress={() => onOpenHost(host.id)}
              style={[
                styles.row,
                index < hosts.length - 1 && {
                  borderBottomColor: theme.colors.border,
                  borderBottomWidth: StyleSheet.hairlineWidth,
                },
                {
                  backgroundColor: background(theme.colors.surface),
                },
              ]}>
              <SquareTerminal size={21} color={theme.colors.primary} />
              <View style={styles.copy}>
                <Text weight="semibold" variant="bodySmall" numberOfLines={2}>
                  {host.label}
                </Text>
                <Text variant="caption" color={theme.colors.textMuted}>
                  {t`Saved SSH host`}
                </Text>
              </View>
              <ThemeIcon
                name="home.arrow"
                fallback={ChevronRight}
                size={16}
                color={theme.colors.textMuted}
              />
            </PressableScale>
          ))}
        </View>
      ) : null}
      {/* Over a pack's scene the empty caption and its link stand on one
          plate, the same shape as the heading above them. */}
      <View style={hasConnections ? undefined : emptyPlate}>
        {hasConnections ? null : (
          <Text variant="bodySmall" color={theme.colors.textMuted}>
            {t`Add a computer or an SSH host to start working.`}
          </Text>
        )}
        <PressableScale
          testID="home-manage-connections"
          accessibilityRole="button"
          onPress={onManage}
          hitSlop={plated ? 12 : undefined}
          style={[
            styles.manage,
            // On the plate the link sits under the caption, not inset from it.
            plated ? styles.manageOnPlate : linkStyle,
          ]}>
          <Text variant="bodySmall" color={theme.colors.primary}>
            {t`Manage connections`}
          </Text>
          <ThemeIcon
            name="home.arrow"
            fallback={ChevronRight}
            size={16}
            color={theme.colors.primary}
          />
        </PressableScale>
      </View>
    </View>
  );
}

/** A probe refresh updates its own row, not every section on the workbench. */
function GatewayConnectionRow({
  server,
  showAddress,
  hasSeparator,
  onOpen,
  onSelect,
  activeConnection,
  nowMs,
}: {
  server: GatewayRecord;
  showAddress: boolean;
  hasSeparator: boolean;
  onOpen: (serverId: string) => void;
  onSelect?: (serverId: string) => void;
  activeConnection?: ActiveServerConnection;
  nowMs?: number;
}) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const theme = useThemeTokens();
  const background = useSurfaceBackground();
  const probe = useServerReachability((state) => state.probes[server.serverId]);
  // Steps when a probe goes stale, so the row stops saying Online on time.
  const freshnessNowMs = useServerReachability((state) => state.freshnessNowMs);
  // The live channels count as much as the probe: a computer streaming a
  // session right now is online whatever a 45-second-old probe says.
  const socket = useServerChannels((state) => state.sockets[server.serverId]);
  const stream = useServerChannels((state) => state.streams[server.serverId]);
  const selected = useGatewayConnectionStore((state) => state.record?.serverId === server.serverId);
  const connection = resolveConnectionStatus({
    serverId: server.serverId,
    probe,
    activeConnection,
    channels: { socket, stream },
    selected,
    nowMs: Math.max(nowMs ?? 0, freshnessNowMs),
  });
  const status = _(connectionStatusDescription[connection]);
  return (
    <PressableScale
      testID={`home-connection-gateway-${server.serverId}`}
      accessibilityRole="button"
      accessibilityLabel={`${server.label}, ${status}`}
      accessibilityHint={
        onSelect ? t`Sends your next goal here. Long press to open it.` : undefined
      }
      onPress={() => (onSelect ? onSelect(server.serverId) : onOpen(server.serverId))}
      onLongPress={onSelect ? () => onOpen(server.serverId) : undefined}
      // The long press as a named action, so a screen reader can reach it
      // without performing the gesture.
      accessibilityActions={onSelect ? [{ name: 'longpress', label: t`Open` }] : undefined}
      onAccessibilityAction={
        onSelect
          ? (event) => {
              if (event.nativeEvent.actionName === 'longpress') onOpen(server.serverId);
            }
          : undefined
      }
      style={[
        styles.row,
        hasSeparator && {
          borderBottomColor: theme.colors.border,
          borderBottomWidth: StyleSheet.hairlineWidth,
        },
        {
          backgroundColor: background(theme.colors.surface),
        },
      ]}>
      <Server size={21} color={theme.colors.primary} />
      <View style={styles.copy}>
        <Text weight="semibold" variant="bodySmall" numberOfLines={2}>
          {server.label}
        </Text>
        <Text variant="caption" color={theme.colors.textMuted}>
          {status}
        </Text>
        {showAddress ? (
          <Text variant="caption" color={theme.colors.textSubtle} numberOfLines={2}>
            {server.url}
          </Text>
        ) : null}
        <GatewayTasksPill serverId={server.serverId} />
      </View>
      <ThemeIcon
        name="home.arrow"
        fallback={ChevronRight}
        size={16}
        color={theme.colors.textMuted}
      />
    </PressableScale>
  );
}

/**
 * How many tasks the selected server's ledger has open, as last seen.
 *
 * A store read only: Home does not fetch the ledger. The pill appears once the
 * tasks sheet or a socket frame has filled the store, only for the selected
 * server, and only on a gateway that keeps a ledger.
 */
function GatewayTasksPill({ serverId }: { serverId: string }) {
  const { t } = useLingui();
  const profile = useAppearanceProfile();
  const theme = useThemeTokens();
  const background = useSurfaceBackground();
  const selected = useGatewayConnectionStore((state) => state.record?.serverId === serverId);
  const ledger = useServerCapabilities((state) => hasTaskLedger(state.byServer[serverId]));
  const count = useServerTasksStore((state) => activeTaskCount(state.index[serverId]?.tasks ?? []));
  if (!selected || !ledger || count === 0) return null;
  return (
    <View
      testID={`home-connection-tasks-${serverId}`}
      style={[
        styles.pill,
        {
          borderRadius: profile.chrome.control,
          backgroundColor: background(theme.colors.primarySubtle),
        },
      ]}>
      <Text variant="caption" weight="semibold" color={theme.colors.primary}>
        {t`${count} in progress`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2 },
  list: { minWidth: 0 },
  connectionGroup: { minWidth: 0, overflow: 'hidden' },
  row: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  copy: { flex: 1, minWidth: 0, gap: 4 },
  manage: {
    minHeight: 44,
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  // Text-high on the plate (a wrapping row tops its line, so a 44 box left a
  // blank strip under the link); the tap target comes back as hitSlop.
  manageOnPlate: { marginTop: 0, minHeight: 0, paddingTop: 4 },
});
