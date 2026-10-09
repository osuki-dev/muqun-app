import { useLingui } from '@lingui/react/macro';
import { Tag, useThemeTokens } from '@osuki-dev/ui';
import { Bot, Cpu, Hammer, SquareTerminal, Target, TriangleAlert } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { LADDER, SettingsInfoRow, SettingsSection } from '@/components/settings-chrome';
import { StatusDot } from '@/components/status-dot';
import { Text } from '@/components/text';
import { Skeleton } from '@/components/themed-skeleton';
import { getFleetManifest, hasFleet, type FleetManifest } from '@/lib/fleet-manifest';
import { useServerCapabilities } from '@/stores/server-capabilities';

type Load =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; manifest: FleetManifest };

/**
 * What this computer can do for the reader's agents, as its gateway reports it:
 * system, the work it suits, toolchains, agents and terminal backends.
 *
 * Absent entirely on a gateway without `fleet`: an older gateway would 404 here,
 * and a section that can only ever say "could not load" is worse than none.
 */
export function ServerCapabilities({
  serverId,
  capabilities,
}: {
  serverId: string;
  /** Gates on this list instead of the store, for the demo server. */
  capabilities?: readonly string[];
}) {
  const stored = useServerCapabilities((state) => state.byServer[serverId]);
  if (!hasFleet(capabilities ?? stored)) return null;
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
          <SettingsInfoRow
            icon={TriangleAlert}
            label={t`Could not load capabilities`}
            detail={t`Try again once the computer responds.`}
            testID="server-capabilities-error"
          />
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

  // A map rather than a lookup of wire words: an id the app has no sentence for
  // is shown as the gateway wrote it.
  function suitableLabel(id: string): string {
    switch (id) {
      case 'ios-build':
        return t`iOS builds`;
      case 'android-build':
        return t`Android builds`;
      case 'web':
        return t`Web`;
      case 'rust':
        return t`Rust`;
      case 'terminal':
        return t`Terminal`;
      default:
        return id;
    }
  }

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
        <SettingsInfoRow
          icon={Cpu}
          label={t`System`}
          detail={system}
          testID="server-capabilities-system"
        />
      ) : null}
      {manifest.suitableFor.length > 0 ? (
        <SettingsInfoRow
          icon={Target}
          label={t`Suitable for`}
          testID="server-capabilities-suitable"
          detail={
            <View style={styles.chips}>
              {manifest.suitableFor.map((id) => (
                <Tag key={id}>{suitableLabel(id)}</Tag>
              ))}
            </View>
          }
        />
      ) : null}
      {manifest.toolchains.length > 0 ? (
        <SettingsInfoRow
          icon={Hammer}
          label={t`Toolchains`}
          testID="server-capabilities-toolchains"
          detail={
            <View style={styles.chips}>
              {manifest.toolchains.map((toolchain) => (
                <Tag key={toolchain.id}>
                  {toolchain.version ? `${toolchain.id} ${toolchain.version}` : toolchain.id}
                </Tag>
              ))}
            </View>
          }
        />
      ) : null}
      {manifest.agents.length > 0 ? (
        <SettingsInfoRow
          icon={Bot}
          label={t`Agents`}
          testID="server-capabilities-agents"
          detail={
            <View style={styles.lines}>
              {manifest.agents.map((agent) => {
                const up = agent.status === 'connected' || agent.status === 'reachable';
                return (
                  <View key={agent.id} style={styles.line}>
                    <StatusDot
                      color={
                        agent.status === 'connected'
                          ? theme.colors.success
                          : theme.colors.textSubtle
                      }
                      filled={up}
                    />
                    <Text variant="caption" color={theme.colors.textMuted} style={styles.lineText}>
                      {`${agent.name} · ${agentStatus(agent.status)}`}
                    </Text>
                  </View>
                );
              })}
            </View>
          }
        />
      ) : null}
      {manifest.terminal.length > 0 ? (
        <SettingsInfoRow
          icon={SquareTerminal}
          label={t`Terminal`}
          testID="server-capabilities-terminal"
          detail={
            <View style={styles.lines}>
              {manifest.terminal.map((backend) => (
                <View key={backend.sessionId} style={styles.line}>
                  <StatusDot
                    color={backend.connected ? theme.colors.success : theme.colors.textSubtle}
                    filled={backend.connected}
                  />
                  <Text variant="caption" color={theme.colors.textMuted} style={styles.lineText}>
                    {`${backend.kind} · ${backendStatus(backend.connected)}`}
                  </Text>
                </View>
              ))}
            </View>
          }
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  skeleton: { padding: LADDER.gutter, gap: LADDER.snug },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: LADDER.gap, paddingTop: 2 },
  lines: { gap: LADDER.tight },
  line: { flexDirection: 'row', alignItems: 'center', gap: LADDER.gap },
  lineText: { flexShrink: 1 },
});
