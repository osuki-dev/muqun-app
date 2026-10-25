import { asRecord } from './record';
import { fetchCapabilities, fetchFleetPeers } from './fleet-peers';
import { gatewayEndpointFetch } from './gateway-client';
import type { GatewayRecord } from './gateway-storage';
import {
  HOME_COLLECTOR_CAPABILITY,
  HOME_SUMMARY_CAPABILITY,
  type Collector,
  type HomeSummaryConfig,
} from './home-summary';
import { useServerCapabilities } from '@/stores/server-capabilities';
import { HOME_OVERVIEW_CAPABILITY } from './home-overview';

async function request(
  record: GatewayRecord,
  path: string,
  method: string,
  body?: unknown
): Promise<Response> {
  return gatewayEndpointFetch(
    record,
    `${record.url.replace(/\/$/, '')}${path}`,
    {
      method,
      headers: { Authorization: `Bearer ${record.token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    8000
  );
}

/** Runs only after an explicit choice; existing peer links and credentials are reused. */
export async function provisionHomeSummary(
  records: readonly GatewayRecord[],
  preferred: string,
  backups: boolean,
  checkpoint: (config: HomeSummaryConfig) => void
): Promise<HomeSummaryConfig> {
  const supported: GatewayRecord[] = [];
  for (const record of records) {
    if (record.sshTunnel || !record.deviceId) continue;
    const capabilities = await fetchCapabilities(record);
    if (capabilities) await useServerCapabilities.getState().record(record.serverId, capabilities);
    if (capabilities?.includes(HOME_SUMMARY_CAPABILITY)) supported.push(record);
  }
  const chosen = supported.find((record) => record.serverId === preferred);
  if (
    !chosen ||
    !useServerCapabilities.getState().byServer[preferred]?.includes(HOME_COLLECTOR_CAPABILITY)
  ) {
    throw new Error('The selected Gateway does not support Home summaries.');
  }
  const collectors: Collector[] = [];
  supported.sort((a, b) => Number(b.serverId === preferred) - Number(a.serverId === preferred));
  for (const collector of supported.slice(0, 16)) {
    if (!backups && collector.serverId !== preferred) continue;
    if (
      !useServerCapabilities
        .getState()
        .byServer[collector.serverId]?.includes(HOME_COLLECTOR_CAPABILITY)
    )
      continue;
    const peers = await fetchFleetPeers(collector, 8000);
    const sources: Collector['sources'] = {};
    collectors.push({ serverId: collector.serverId, sources });
    if (peers.ok)
      for (const source of supported
        .filter((entry) => entry.serverId !== collector.serverId)
        .slice(0, 16)) {
        if (source.serverId === collector.serverId) continue;
        const matches = peers.peers.peers.filter(
          (peer) => peer.serverId === source.serverId && !peer.unauthorized
        );
        if (matches.length !== 1) continue;
        try {
          const response = await request(source, '/api/home/grants', 'POST', {
            collector_server_id: collector.serverId,
            audience: collector.deviceId,
            ...(useServerCapabilities
              .getState()
              .byServer[source.serverId]?.includes(HOME_OVERVIEW_CAPABILITY)
              ? { overview: true }
              : {}),
          });
          if (!response.ok) continue;
          const answer = asRecord(await response.json());
          if (typeof answer?.grant_id === 'string')
            sources[source.serverId] = { peer_id: matches[0]!.peerId, grant_id: answer.grant_id };
          checkpoint({
            preferred: null,
            collectors: collectors.map((entry) => ({ ...entry, sources: { ...entry.sources } })),
          });
        } catch {
          // This source remains direct. Another source's authorization is not rolled back.
        }
      }
  }
  return { preferred, collectors, overview: true };
}

/** Keep failed revocations so the user can retry; stopping collection is immediate. */
export async function revokeHomeSummary(
  records: readonly GatewayRecord[],
  config: HomeSummaryConfig
): Promise<HomeSummaryConfig> {
  const collectors: Collector[] = [];
  for (const collector of config.collectors) {
    const sources: Collector['sources'] = {};
    for (const [id, grant] of Object.entries(collector.sources)) {
      const record = records.find((record) => record.serverId === id);
      if (!record) continue; // Unpairing revoked this App's grant authority.
      try {
        const result = await request(
          record,
          `/api/home/grants/${encodeURIComponent(grant.grant_id)}`,
          'DELETE'
        );
        if (!result.ok) sources[id] = grant;
      } catch {
        sources[id] = grant;
      }
    }
    if (Object.keys(sources).length) collectors.push({ ...collector, sources });
  }
  return { preferred: null, collectors };
}
