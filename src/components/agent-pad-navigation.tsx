import { useEffect } from 'react';
import { useRouter } from 'expo-router';

import { PadServerRail } from '@/components/pad-server-rail';
import { useGatewayRecord } from '@/hooks/use-gateway-record';
import { useHomeCommands } from '@/hooks/use-home-commands';
import { resolveServerReachability } from '@/lib/server-reachability';
import { useServerAgents } from '@/stores/server-agents';
import { useServerReachability } from '@/stores/server-reachability';
import { useSshHostsStore } from '@/stores/ssh-hosts';

/** The agent route uses the same navigation as Home and the terminal workspace. */
export function AgentPadNavigation({ asid }: { asid?: string }) {
  const router = useRouter();
  const commands = useHomeCommands();
  const { records, record } = useGatewayRecord();
  const probes = useServerReachability((state) => state.probes);
  const refreshReachability = useServerReachability((state) => state.refreshMany);
  const hosts = useSshHostsStore((state) => state.hosts);
  const hydrateHosts = useSshHostsStore((state) => state.hydrate);
  const hydrateAgents = useServerAgents((state) => state.hydrate);
  useEffect(() => {
    void hydrateHosts();
    void hydrateAgents();
  }, [hydrateHosts, hydrateAgents]);
  useEffect(() => {
    void refreshReachability(records);
  }, [records, refreshReachability]);
  // oxlint-disable-next-line react/purity -- reachability freshness is relative to this render.
  const nowMs = Date.now();
  const reachability = Object.fromEntries(
    records.map((server) => [
      server.serverId,
      resolveServerReachability(server.serverId, probes[server.serverId], undefined, nowMs),
    ])
  );
  return (
    <PadServerRail
      servers={records}
      reachabilityByServer={reachability}
      selectedServerId={record?.serverId ?? null}
      selectedAsid={asid}
      onOpenWorkbench={() => router.navigate({ pathname: '/', params: { overview: 'home' } })}
      onSelectServer={(server) => {
        void commands.openServer(server.serverId);
      }}
      onPairServer={() => void commands.pairGateway()}
      onOpenSettings={() => router.push('/settings')}
      onOpenSsh={() => void commands.openSsh()}
      sshHosts={hosts}
      onSelectSshHost={(host) => void commands.openSsh(host.id)}
    />
  );
}
