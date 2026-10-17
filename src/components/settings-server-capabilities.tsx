import { useLingui } from '@lingui/react/macro';
import { useThemeTokens, Skeleton, Text } from '@osuki-dev/ui';
import { Bot, Cpu, SquareTerminal, TriangleAlert, type LucideIcon } from 'lucide-react-native';
import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { LADDER, SettingsSection } from '@/components/settings-chrome';
import { StatusDot } from '@/components/status-dot';
import { getFleetManifest, hasFleet, type FleetManifest } from '@/lib/fleet-manifest';
import { useServerCapabilities } from '@/stores/server-capabilities';

type Load =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; manifest: FleetManifest };

/**
 * What this computer can do for the reader's agents, as its gateway reports it:
 * system, agents and terminal backends.
 *
 * Absent entirely on a gateway without `fleet`: an older gateway would 404 here,
 * and a section that can only ever say "could not load" is worse than none.
 */
export function ServerCapabilities({ serverId }: { serverId: string }) {
  const fleet = useServerCapabilities((state) => hasFleet(state.byServer[serverId]));
  if (!fleet) return null;
  return <CapabilitiesSection />;
}

function CapabilitiesSection() {
  const { t } = useLingui();
  const [load, setLoad] = useState<Load>({ status: 'loading' });

  useEffect(() => {
    // Set by the cleanup, so an answer that lands after the row has closed is
    // dropped rather than set on an unmounted component.
    let live = true;
    void getFleetManifest()
      .catch(() => null)
      .then((manifest) => {
        if (!live) return;
        setLoad(manifest ? { status: 'ready', manifest } : { status: 'error' });
      });
    return () => {
      live = false;
    };
  }, []);

  return (
    <View testID="server-capabilities">
      <SettingsSection title={t`Capabilities`}>
        {load.status === 'loading' ? (
          <CapabilitiesSkeleton />
        ) : load.status === 'error' ? (
          <CapabilityGroup
            icon={TriangleAlert}
            label={t`Could not load capabilities`}
            testID="server-capabilities-error">
            <Text variant="caption">{t`Try again once the computer responds.`}</Text>
          </CapabilityGroup>
        ) : (
          <CapabilityRows manifest={load.manifest} />
        )}
      </SettingsSection>
    </View>
  );
}

function CapabilitiesSkeleton() {
  return (
    <View testID="server-capabilities-loading" style={styles.skeleton}>
      <Skeleton variant="text" width="60%" height={16} />
      <Skeleton variant="text" width="40%" height={16} />
      <Skeleton variant="text" width="50%" height={16} />
    </View>
  );
}

function CapabilityRows({ manifest }: { manifest: FleetManifest }) {
  const { t } = useLingui();
  const theme = useThemeTokens();

  function agentStatus(status: string): string {
    switch (status) {
      case 'connected':
        return t`Connected`;
      case 'reachable':
        return t`Reachable`;
      case 'online':
        return t`Online`;
      case 'offline':
        return t`Offline`;
      case 'disabled':
        return t`Not configured`;
      default:
        return t`Unavailable`;
    }
  }

  function backendStatus(connected: boolean): string {
    return connected ? t`Connected` : t`Not connected`;
  }

  const gatewayVersion = manifest.gatewayVersion;
  const system = [manifest.os, manifest.arch, gatewayVersion ? t`gateway v${gatewayVersion}` : '']
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      {system ? (
        <CapabilityGroup icon={Cpu} label={t`System`} testID="server-capabilities-system">
          <Text variant="caption" color={theme.colors.textMuted}>
            {system}
          </Text>
        </CapabilityGroup>
      ) : null}
      {manifest.agents.length > 0 ? (
        <CapabilityGroup icon={Bot} label={t`Agents`} testID="server-capabilities-agents">
          <View style={styles.lines}>
            {manifest.agents.map((agent) => {
              const up = agent.status === 'connected' || agent.status === 'reachable';
              return (
                <View key={agent.id} style={styles.line}>
                  <StatusDot
                    color={
                      agent.status === 'connected' ? theme.colors.success : theme.colors.textSubtle
                    }
                    filled={up}
                  />
                  <Text variant="caption" style={styles.lineText}>
                    {agent.name}
                  </Text>
                  <Text variant="caption" color={theme.colors.textMuted} style={styles.valueText}>
                    {agentStatus(agent.status)}
                  </Text>
                </View>
              );
            })}
          </View>
        </CapabilityGroup>
      ) : null}
      {manifest.terminal.length > 0 ? (
        <CapabilityGroup
          icon={SquareTerminal}
          label={t`Terminal`}
          testID="server-capabilities-terminal">
          <View style={styles.lines}>
            {manifest.terminal.map((backend) => (
              <View key={backend.sessionId} style={styles.line}>
                <StatusDot
                  color={backend.connected ? theme.colors.success : theme.colors.textSubtle}
                  filled={backend.connected}
                />
                <Text variant="caption" style={styles.lineText}>
                  {backend.kind}
                </Text>
                <Text variant="caption" color={theme.colors.textMuted} style={styles.valueText}>
                  {backendStatus(backend.connected)}
                </Text>
              </View>
            ))}
          </View>
        </CapabilityGroup>
      ) : null}
    </>
  );
}

function CapabilityGroup({
  icon: Icon,
  label,
  testID,
  children,
}: {
  icon: LucideIcon;
  label: string;
  testID: string;
  children: ReactNode;
}) {
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();
  return (
    <View
      testID={testID}
      style={[styles.group, { paddingVertical: profile.settingsRowPaddingVertical }]}>
      <View style={styles.heading}>
        <Icon size={16} color={theme.colors.textMuted} />
        <Text variant="bodySmall" style={styles.lineText}>
          {label}
        </Text>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: { padding: LADDER.gutter, gap: LADDER.snug },
  group: { paddingHorizontal: LADDER.gutter, gap: LADDER.gap },
  heading: { flexDirection: 'row', alignItems: 'center', gap: LADDER.gap },
  lines: { gap: LADDER.gap },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: LADDER.gap },
  lineText: { flex: 1, minWidth: 0 },
  valueText: { flexShrink: 1, maxWidth: '55%', textAlign: 'right' },
});
