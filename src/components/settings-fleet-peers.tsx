import { useLingui } from '@lingui/react/macro';
import { useThemeTokens, useToast } from '@osuki-dev/ui';
import { StyleSheet, View } from 'react-native';

import { LADDER, SettingsSection, SettingsToggleRow } from '@/components/settings-chrome';
import { Text } from '@/components/text';
import { reconcileFleet } from '@/hooks/use-fleet-link';
import { useStableHandler } from '@/hooks/use-render-refs';
import { recordEndpoint } from '@/hooks/use-server-tasks';
import { hasFleetPeers, linkLines, setAcceptDelegations } from '@/lib/fleet-peers';
import type { GatewayRecord } from '@/lib/gateway-storage';
import { useFleetPeers } from '@/stores/fleet-peers';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import { useServerCapabilities } from '@/stores/server-capabilities';

/**
 * This computer among the reader's others: whether it takes work from them,
 * and which ones it is linked with. Linking itself is automatic (the Home
 * reconciler); there is nothing to press here but the switch.
 */
export function FleetPeersSection({ server }: { server: GatewayRecord }) {
  const enabled = useServerCapabilities((state) => hasFleetPeers(state.byServer[server.serverId]));
  if (!enabled || server.sshTunnel) return null;
  return <FleetPeersBody server={server} />;
}

function FleetPeersBody({ server }: { server: GatewayRecord }) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const { showToast } = useToast();
  const byServer = useFleetPeers((state) => state.byServer);
  const failures = useFleetPeers((state) => state.failures);
  // A failure counts while it is within the retry window of the latest run,
  // which is when the reconciler last looked; pure, unlike a clock read.
  const lastRunMs = useFleetPeers((state) => state.lastRunMs);
  const setPeers = useFleetPeers((state) => state.setPeers);
  const records = useGatewayConnectionStore((state) => state.records);
  const answer = byServer[server.serverId];
  const computers = records.map((record) => ({
    serverId: record.serverId,
    label: record.label,
    url: record.url,
    peers: byServer[record.serverId] ?? null,
  }));
  const { linked, cannotReach } = linkLines(server.serverId, computers, failures, lastRunMs);

  const toggle = useStableHandler((accept: boolean) => {
    if (!answer) return;
    setPeers(server.serverId, { ...answer, acceptDelegations: accept });
    void setAcceptDelegations(recordEndpoint(server), accept)
      .catch(() => null)
      .then((saved) => {
        const latest = useFleetPeers.getState().byServer[server.serverId] ?? answer;
        if (saved === null) {
          setPeers(server.serverId, { ...latest, acceptDelegations: answer.acceptDelegations });
          showToast({
            variant: 'danger',
            title: t`Could not change this setting`,
            message: t`Make sure the computer is reachable, then try again.`,
          });
          return;
        }
        setPeers(server.serverId, { ...latest, acceptDelegations: saved });
        // Taking work again: the others link to it now rather than on the schedule.
        if (saved) void reconcileFleet({ reason: 'settings' });
      });
  });

  const linkedNames = linked.join(', ');
  const quietNames = cannotReach.join(', ');
  return (
    <View testID="fleet-peers">
      <SettingsSection title={t`Other computers`}>
        <View>
          <SettingsToggleRow
            label={t`Accept work from other computers`}
            detail={t`Agents on your other computers can hand part of a task to this one.`}
            value={answer?.acceptDelegations ?? true}
            disabled={!answer}
            onValueChange={toggle}
          />
          {linked.length > 0 || cannotReach.length > 0 ? (
            <View style={styles.lines}>
              {linked.length > 0 ? (
                <Text testID="fleet-peers-linked" variant="caption" color={theme.colors.textMuted}>
                  {t`Linked with: ${linkedNames}`}
                </Text>
              ) : null}
              {cannotReach.length > 0 ? (
                <Text
                  testID="fleet-peers-unreachable"
                  variant="caption"
                  color={theme.colors.warning}>
                  {t`Cannot reach ${quietNames}`}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
      </SettingsSection>
    </View>
  );
}

const styles = StyleSheet.create({
  // Under the switch's own text column, closing the row with its bottom inset.
  lines: {
    paddingHorizontal: LADDER.gutter,
    paddingBottom: LADDER.snug,
    gap: LADDER.tight,
  },
});
