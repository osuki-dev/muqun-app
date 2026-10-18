import {
  configuredGatewayServerId,
  effectiveGatewayBaseUrl,
  gatewayEndpointFetch,
} from './gateway-client';
import { parseAgentAccountLimits } from './agent-account-limits';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';

/** Capture this server's credentials and live tunnel address before starting the read. */
export async function readAgentAccountLimits(
  serverId: string,
  agentId: string,
  signal: AbortSignal
) {
  if (!agentId || agentId === '.' || agentId === '..') {
    throw new Error('Invalid account limits agent identity');
  }
  const state = useGatewayConnectionStore.getState();
  const record =
    state.record?.serverId === serverId
      ? state.record
      : state.records.find((entry) => entry.serverId === serverId);
  const url = effectiveGatewayBaseUrl(record ?? null);
  if (
    !record ||
    !url ||
    (record.sshTunnel && (configuredGatewayServerId() !== serverId || url === record.url))
  )
    throw new Error('Account limits connection unavailable');
  const endpoint = { ...record, url };
  const response = await gatewayEndpointFetch(
    endpoint,
    `${url.replace(/\/$/, '')}/api/agents/${encodeURIComponent(agentId)}/account-limits`,
    { method: 'GET', headers: { Authorization: `Bearer ${record.token}` }, signal }
  );
  if (!response.ok) throw new Error('Account limits request failed');
  const body: unknown = await response.json();
  return parseAgentAccountLimits(
    body && typeof body === 'object' && 'data' in body ? body.data : body
  );
}
