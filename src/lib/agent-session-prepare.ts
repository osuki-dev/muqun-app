import { gatewayEndpointFetch, type GatewayEndpoint } from './gateway-client';
import { SessionPreparationFlights } from './foreground-session-activation';

const flights = new SessionPreparationFlights();

/** Include pairing credentials in memory identity; never persist or display this key. */
export function sessionPreparationSource(
  serverId: string,
  endpoint: GatewayEndpoint,
  restart = 0
): string {
  return JSON.stringify([
    serverId,
    endpoint.url,
    endpoint.token,
    endpoint.deviceId,
    endpoint.transportKey,
    endpoint.transport,
    restart,
  ]);
}

/** Explicit activation is a write, separate from every history or watcher read. */
export function prepareAgentSessionAt(options: {
  serverId: string;
  endpoint: GatewayEndpoint;
  agentId: string;
  asid: string;
  capabilities: readonly string[] | undefined;
  restart?: number;
}): Promise<void> {
  if (!options.capabilities?.includes('agent_session_resume_v1')) return Promise.resolve();
  const endpoint = { ...options.endpoint };
  const path = `/api/agents/${encodeURIComponent(options.agentId)}/sessions/${encodeURIComponent(options.asid)}/prepare`;
  const key = JSON.stringify([
    sessionPreparationSource(options.serverId, endpoint, options.restart),
    options.agentId,
    options.asid,
  ]);
  return flights.run(key, async () => {
    // Session preparation can wait for native startup, like an agent prompt.
    const response = await gatewayEndpointFetch(
      endpoint,
      endpoint.url.replace(/\/$/, '') + path,
      { method: 'POST', headers: { Authorization: `Bearer ${endpoint.token}` } },
      60_000
    );
    if (!response.ok)
      throw new Error(`Failed to resume session: ${response.status} ${await response.text()}`);
    const json = (await response.json()) as {
      data?: { prepared?: unknown };
      prepared?: unknown;
    } | null;
    if ((json?.data ?? json)?.prepared !== true)
      throw new Error('Failed to resume session: unreadable response');
  });
}
