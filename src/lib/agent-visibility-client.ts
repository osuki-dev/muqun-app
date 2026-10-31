import {
  configuredGatewayServerId,
  effectiveGatewayBaseUrl,
  gatewayEndpointFetch,
} from './gateway-client';
import type { AgentVisibility } from './agent-protocol';
import { refreshAgentServerDiscovery } from './home-agent-readiness';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';

/**
 * Hides an agent's native-session form from the new-session picker on one
 * computer, or puts it back (`auto`). The host keeps the choice, so every
 * paired device follows it; the mirror is refreshed from discovery afterwards.
 *
 * TODO(feat/agent-visibility): route and body follow the design proposal,
 * `PUT /api/agents/{kind}/visibility` with `{"visibility": ...}`; reconcile
 * with the gateway's docs/agent-api.md when that branch lands.
 */
export async function setAgentVisibility(
  serverId: string,
  agentKind: string,
  visibility: AgentVisibility
): Promise<void> {
  const kind = agentKind.trim();
  if (!kind || kind === '.' || kind === '..') throw new Error('Invalid agent kind');
  const state = useGatewayConnectionStore.getState();
  const record =
    state.record?.serverId === serverId
      ? state.record
      : state.records.find((entry) => entry.serverId === serverId);
  const url = effectiveGatewayBaseUrl(record ?? null);
  // A tunnelled record only has a live address while it is the connected one.
  if (
    !record ||
    !url ||
    (record.sshTunnel && (configuredGatewayServerId() !== serverId || url === record.url))
  )
    throw new Error('Computer unavailable');
  const response = await gatewayEndpointFetch(
    { ...record, url },
    `${url.replace(/\/$/, '')}/api/agents/${encodeURIComponent(kind)}/visibility`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${record.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ visibility }),
    }
  );
  if (!response.ok) throw new Error(`Agent visibility: ${response.status}`);
  await refreshAgentServerDiscovery(record);
}
