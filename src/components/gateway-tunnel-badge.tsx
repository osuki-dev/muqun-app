import { Trans, useLingui } from '@lingui/react/macro';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { Waypoints } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { StatusDot } from '@/components/status-dot';
import { useGatewayTunnel } from '@/hooks/use-gateway-tunnel';
import type { GatewayRecord } from '@/lib/gateway-storage';
import { sanitizeServerText } from '@/lib/ssh-server-text';
import { useSshHostsStore } from '@/stores/ssh-hosts';

/**
 * The tunnel's status where a reader can see it: a compact badge on a server
 * card, and a fuller notice with a reconnect on the workspace. Renders nothing
 * for a direct (non-tunnelled) gateway, so callers can drop it in unconditionally.
 *
 * The host label is server/user-controlled text, so it goes through
 * `sanitizeServerText` before it is shown.
 */
export function GatewayTunnelBadge({
  record,
  variant = 'badge',
}: {
  record: GatewayRecord | null | undefined;
  variant?: 'badge' | 'notice';
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  // Observe, do not hold: this is a status view. The screens that need the
  // forward *up* hold it through `useGatewayTunnel(record, true)`.
  const tunnel = useGatewayTunnel(record, false);
  const hostLabel = useSshHostsStore((state) =>
    record?.sshTunnel ? state.hosts.find((item) => item.id === record.sshTunnel!.hostId)?.label : undefined
  );

  if (!record?.sshTunnel) return null;
  const host = sanitizeServerText(hostLabel ?? '', 48) || t`SSH host`;

  const connecting = tunnel.phase === 'connecting';
  const open = tunnel.phase === 'open';
  const down = tunnel.phase === 'down';
  // `idle` (nobody is using the record) is neutral, not "connecting": the badge
  // observes the tunnel, it does not open it.
  const color = down
    ? theme.colors.danger
    : connecting
      ? theme.colors.warning
      : open
        ? theme.colors.success
        : theme.colors.textMuted;

  const label = down
    ? t`Tunnel down`
    : connecting
      ? t`Connecting through SSH…`
      : t`Through ${host}`;
  const a11y = down
    ? t`SSH tunnel through ${host} is down`
    : connecting
      ? t`Connecting through SSH host ${host}`
      : open
        ? t`Connected through SSH host ${host}`
        : t`Reached through SSH host ${host}`;

  if (variant === 'notice') {
    return (
      <View
        accessibilityLabel={a11y}
        style={[styles.notice, { backgroundColor: theme.colors.surfaceRaised }]}>
        <StatusDot color={color} filled={!connecting} pulse={connecting} size={7} />
        <Text variant="caption" color={theme.colors.textMuted} style={styles.noticeText}>
          {label}
        </Text>
        {down ? (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={t`Reconnect the SSH tunnel`}
            onPress={tunnel.retry}
            hitSlop={8}>
            <Text variant="caption" color={theme.colors.primary}>
              <Trans>Reconnect</Trans>
            </Text>
          </PressableScale>
        ) : null}
      </View>
    );
  }

  return (
    <View accessibilityLabel={a11y} style={styles.badge}>
      <Waypoints size={12} color={color} strokeWidth={2} />
      <Text variant="caption" color={color} numberOfLines={1} style={styles.badgeText}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  badgeText: { flexShrink: 1 },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  noticeText: { flexShrink: 1 },
});
