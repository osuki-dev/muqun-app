import { useLingui } from '@lingui/react/macro';
import { useLingui as useLinguiRuntime } from '@lingui/react';
import { useThemeTokens } from '@osuki-dev/ui';
import { ChevronRight, Server, SquareTerminal } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { Text } from '@/components/text';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { reachabilityDescription } from '@/i18n/labels';
import type { GatewayRecord } from '@/lib/gateway-storage';
import { serverIdsNeedingAddress } from '@/lib/server-address';
import { resolveServerReachability, type ActiveServerConnection } from '@/lib/server-reachability';
import type { SshHostRecord } from '@/lib/ssh-hosts';
import { useServerReachability } from '@/stores/server-reachability';

/** Saved destinations, independent of task status and the selected Home layout. */
export function HomeConnections({
  servers,
  hosts,
  onOpenServer,
  onOpenHost,
  onManage,
  activeConnection,
  nowMs,
}: {
  servers: readonly GatewayRecord[];
  hosts: readonly SshHostRecord[];
  onOpenServer: (serverId: string) => void;
  onOpenHost: (hostId: string) => void;
  onManage: () => void;
  activeConnection?: ActiveServerConnection;
  nowMs?: number;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const background = useSurfaceBackground();
  const addresses = serverIdsNeedingAddress(servers);
  const hasConnections = servers.length > 0 || hosts.length > 0;
  return (
    <View testID="home-connections" style={styles.list}>
      {hasConnections ? (
        <View style={styles.connectionGroup}>
          {servers.map((server) => (
            <GatewayConnectionRow
              key={server.serverId}
              server={server}
              showAddress={addresses.has(server.serverId)}
              onOpen={onOpenServer}
              activeConnection={activeConnection}
              nowMs={nowMs}
            />
          ))}
          {hosts.map((host) => (
            <PressableScale
              key={host.id}
              testID={`home-connection-ssh-${host.id}`}
              accessibilityRole="button"
              accessibilityLabel={`${host.label}, ${t`Saved SSH host`}`}
              onPress={() => onOpenHost(host.id)}
              pressedScale={1}
              style={[
                styles.row,
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
              <ChevronRight size={16} color={theme.colors.textMuted} />
            </PressableScale>
          ))}
        </View>
      ) : (
        <Text variant="bodySmall" color={theme.colors.textMuted}>
          {t`Add a gateway or an SSH host to start working.`}
        </Text>
      )}
      <PressableScale
        testID="home-manage-connections"
        accessibilityRole="button"
        onPress={onManage}
        style={styles.manage}>
        <Text variant="bodySmall" color={theme.colors.primary}>
          {t`Manage connections`}
        </Text>
        <ChevronRight size={16} color={theme.colors.primary} />
      </PressableScale>
    </View>
  );
}

/** A probe refresh updates its own row, not every section on the workbench. */
function GatewayConnectionRow({
  server,
  showAddress,
  onOpen,
  activeConnection,
  nowMs,
}: {
  server: GatewayRecord;
  showAddress: boolean;
  onOpen: (serverId: string) => void;
  activeConnection?: ActiveServerConnection;
  nowMs?: number;
}) {
  const { _ } = useLinguiRuntime();
  const theme = useThemeTokens();
  const background = useSurfaceBackground();
  const probe = useServerReachability((state) => state.probes[server.serverId]);
  const reachability = resolveServerReachability(server.serverId, probe, activeConnection, nowMs);
  const status = _(reachabilityDescription[reachability]);
  return (
    <PressableScale
      testID={`home-connection-gateway-${server.serverId}`}
      accessibilityRole="button"
      accessibilityLabel={`${server.label}, ${status}`}
      onPress={() => onOpen(server.serverId)}
      pressedScale={1}
      style={[
        styles.row,
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
      </View>
      <ChevronRight size={16} color={theme.colors.textMuted} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  list: { minWidth: 0 },
  connectionGroup: { minWidth: 0, borderRadius: 6, overflow: 'hidden' },
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
});
