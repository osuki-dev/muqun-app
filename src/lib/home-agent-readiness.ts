import type { GatewayEndpoint } from '@/lib/gateway-client';
import type { AgentCatalog, AgentProject } from '@/lib/agent-session';
import type { AgentStatusInfo, GatewayDiscovery } from '@/lib/agent-protocol';
import type { GatewayRecord } from '@/lib/gateway-storage';
import {
  DEFAULT_AGENT_ID,
  findAgent,
  agentReadiness,
  hasMultiAgent,
  normalizeAgentId,
  resolveSelectedAgent,
} from '@/lib/agent-discovery';

export const OPENCODE_CAPABILITY = 'agent_sessions';
export const OPENCODE_READINESS_TIMEOUT_MS = 5000;

/**
 * What every readiness answer carries besides its status: the capability
 * list the probe paid for, the agent the answer is about, and -- when the
 * gateway drives more than one -- the discovery document, so the caller can
 * mirror it rather than ask again.
 */
type ReadinessCommon = {
  capabilities: readonly string[];
  /** The agentId this answer describes; the default on a single-engine gateway. */
  agentId: string;
  discovery?: GatewayDiscovery;
};

export type AgentReadiness =
  | ({ status: 'ready' } & ReadinessCommon)
  | ({ status: 'unsupported' } & ReadinessCommon)
  | ({ status: 'not-installed' } & ReadinessCommon)
  /** Listed and answering, but the host has not finished setting it up (`unconfigured`). */
  | ({ status: 'needs-setup' } & ReadinessCommon)
  | ({ status: 'offline'; cause: 'health' | 'catalog' | 'service' } & ReadinessCommon);

/**
 * Which sentence the guide leads with. `setup` is the kind's own start
 * sentence (`agentGuideFor(kind).start`), for an agent that needs setup and for
 * a service that is installed but not answering; the rest are the guide's.
 */
export type AgentGuideBlurb =
  | 'ready'
  | 'unsupported'
  | 'not-installed'
  | 'health'
  | 'setup'
  | 'unconfirmed';

export function agentGuideBlurb(readiness: AgentReadiness): AgentGuideBlurb {
  switch (readiness.status) {
    case 'ready':
    case 'unsupported':
    case 'not-installed':
      return readiness.status;
    case 'needs-setup':
      return 'setup';
    case 'offline':
      return readiness.cause === 'health'
        ? 'health'
        : readiness.cause === 'service'
          ? 'setup'
          : 'unconfirmed';
  }
}

/**
 * The command the guide offers for this readiness: the kind's setup step when
 * the agent is running but needs setup, else the command that starts it.
 */
export function agentGuideCommand(
  copy: { command?: string; setupCommand?: string },
  status: AgentReadiness['status']
): string | undefined {
  return (status === 'needs-setup' ? copy.setupCommand : undefined) ?? copy.command;
}

/** Whether the guide offers the kind's command to copy, when it has one. */
export function showsAgentSetupCommand(readiness: AgentReadiness): boolean {
  if (readiness.status === 'needs-setup') return true;
  return readiness.status === 'offline' && readiness.cause !== 'health';
}

export type AgentReadinessPorts = {
  probeHealth: () => Promise<{ ok: boolean; capabilities?: unknown }>;
  loadStatus?: () => Promise<AgentStatusInfo | null>;
  loadCatalog: () => Promise<AgentCatalog>;
  loadProjects: () => Promise<AgentProject[]>;
  /**
   * `GET /api/discovery`, asked only when the capability list says it has a
   * agent plane. `null` -- the port's answer for a refusal or a document
   * without one -- keeps the single-engine path below.
   */
  loadDiscovery?: (capabilities: readonly string[]) => Promise<GatewayDiscovery | null>;
};

/**
 * Capability and transport are separate facts. A healthy gateway that does not
 * advertise agent sessions is unsupported; a gateway that advertises them but
 * cannot answer its catalog is temporarily offline. No gateway version is
 * inferred here.
 *
 * A gateway that also advertises agent discovery is asked which agents
 * it drives, and the answer is about `agent` -- the one asked for, or the
 * gateway's own choice (`resolveSelectedAgent`) -- read through
 * `agentReadiness`. A discovery that fails, or that does not list the
 * agent, falls through to the single-engine checks exactly as before.
 */
export async function checkAgentReadiness(
  ports: AgentReadinessPorts,
  agentId?: string
): Promise<AgentReadiness> {
  const wanted = agentId ? normalizeAgentId(agentId) : undefined;
  const fallbackAgentId = wanted ?? DEFAULT_AGENT_ID;
  let health: { ok: boolean; capabilities?: unknown };
  try {
    health = await ports.probeHealth();
  } catch {
    return { status: 'offline', capabilities: [], agentId: fallbackAgentId, cause: 'health' };
  }
  const capabilities = normalizeReadinessCapabilities(health.capabilities);
  if (!health.ok) {
    return { status: 'offline', capabilities, agentId: fallbackAgentId, cause: 'health' };
  }
  if (!capabilities.includes(OPENCODE_CAPABILITY)) {
    return { status: 'unsupported', capabilities, agentId: fallbackAgentId };
  }

  if (ports.loadDiscovery && hasMultiAgent(capabilities)) {
    let discovery: GatewayDiscovery | null = null;
    try {
      discovery = await ports.loadDiscovery(capabilities);
    } catch {
      // A discovery that cannot be read is a gateway to treat as single-agent.
    }
    const plane = discovery?.agents;
    if (discovery && plane) {
      // The agent asked for, or the one a new session would go to: the first
      // ready agent in the gateway's order.
      const found = wanted
        ? findAgent(plane.agents, wanted)
        : findAgent(plane.agents, resolveSelectedAgent(undefined, plane));
      if (found) {
        const common = { capabilities, agentId: found.id, discovery };
        switch (agentReadiness(found)) {
          case 'ready':
            return { status: 'ready', ...common };
          case 'not-installed':
            return { status: 'not-installed', ...common };
          case 'needs-setup':
            return { status: 'needs-setup', ...common };
          case 'unsupported':
            return { status: 'unsupported', ...common };
          default:
            return { status: 'offline', ...common, cause: 'service' };
        }
      }
      // An agent the gateway does not list is not one it can run. A caller
      // that asked for nothing in particular falls through to the status
      // checks, which describe the primary.
      if (wanted) return { status: 'unsupported', capabilities, agentId: wanted, discovery };
    }
  }

  if (ports.loadStatus) {
    try {
      const status = await ports.loadStatus();
      const answered = status?.agent_id ? normalizeAgentId(status.agent_id) : fallbackAgentId;
      if (status?.available) return { status: 'ready', capabilities, agentId: answered };
      if (status?.installation === 'not_found') {
        return { status: 'not-installed', capabilities, agentId: answered };
      }
      if (status?.installation === 'installed') {
        return { status: 'offline', capabilities, agentId: answered, cause: 'service' };
      }
    } catch {
      // Older Gateways and inconclusive status reads keep the catalog fallback.
    }
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const loaded = await Promise.race([
      Promise.all([ports.loadCatalog(), ports.loadProjects()]),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), OPENCODE_READINESS_TIMEOUT_MS);
      }),
    ]);
    if (!loaded) {
      return { status: 'offline', capabilities, agentId: fallbackAgentId, cause: 'catalog' };
    }
    const [catalog, projects] = loaded;
    if (catalog.models.length === 0 && catalog.modes.length === 0 && projects.length === 0) {
      return { status: 'offline', capabilities, agentId: fallbackAgentId, cause: 'catalog' };
    }
  } catch {
    return { status: 'offline', capabilities, agentId: fallbackAgentId, cause: 'catalog' };
  } finally {
    if (timer) clearTimeout(timer);
  }
  return { status: 'ready', capabilities, agentId: fallbackAgentId };
}

/**
 * Check one stored server through its own endpoint and credentials, for the
 * agent named or for the server's own choice. What discovery says is
 * written to the agent mirror on the way past, so Home and the workbench
 * read it without asking again.
 */
export function checkAgentServer(
  record: GatewayRecord | undefined | null,
  agentId?: string
): Promise<AgentReadiness> {
  if (!record) {
    return Promise.resolve({
      status: 'offline',
      capabilities: [],
      agentId: agentId ? normalizeAgentId(agentId) : DEFAULT_AGENT_ID,
      cause: 'health',
    });
  }
  return (async () => {
    // Keep native transport modules out of the pure classifier's import graph.
    // This lets command and readiness tests run in Bun without React Native,
    // while this adapter still uses the real server-scoped APIs.
    try {
      const [gatewayClient, agentSession, agentsStore] = await Promise.all([
        import('@/lib/gateway-client'),
        import('@/lib/agent-session'),
        import('@/stores/agents'),
      ]);
      const endpoint: GatewayEndpoint = {
        url: gatewayClient.effectiveGatewayBaseUrl(record),
        token: record.token,
        ...(record.deviceId ? { deviceId: record.deviceId } : {}),
        ...(record.transportKey ? { transportKey: record.transportKey } : {}),
        ...(record.transport ? { transport: record.transport } : {}),
      };
      // The catalog loaders accept an explicit URL/token endpoint; health is
      // the transport-aware probe above. Home's command path selects this
      // record before awaiting the loaders, so encrypted gateway requests use
      // the same configured record as the health check.
      const catalogEndpoint = { url: endpoint.url, token: endpoint.token };
      const result = await checkAgentReadiness(
        {
          probeHealth: async () => {
            let capabilities: unknown;
            const ok = await gatewayClient.probeGatewayReachable(
              endpoint,
              OPENCODE_READINESS_TIMEOUT_MS,
              (body) => {
                if (body && typeof body === 'object' && !Array.isArray(body)) {
                  capabilities = (body as { capabilities?: unknown }).capabilities;
                }
              }
            );
            return { ok, capabilities };
          },
          loadDiscovery: (capabilities) =>
            agentSession.getAgentsDiscovery({ endpoint, capabilities }),
          loadCatalog: () =>
            agentSession.getAgentCatalog(undefined, catalogEndpoint, {
              forceRefresh: true,
              requireFresh: true,
              ...(agentId ? { agentId } : {}),
            }),
          loadProjects: () =>
            agentSession.getAgentProjects(undefined, catalogEndpoint, {
              forceRefresh: true,
              ...(agentId ? { agentId } : {}),
            }),
          loadStatus: () => agentSession.getAgentStatus(endpoint, agentId),
        },
        agentId
      );
      if (result.discovery) {
        agentsStore.useAgents.getState().record(record.serverId, result.discovery);
      }
      return result;
    } catch {
      return {
        status: 'offline',
        capabilities: [],
        agentId: agentId ? normalizeAgentId(agentId) : DEFAULT_AGENT_ID,
        cause: 'health',
      };
    }
  })();
}

/**
 * Asks one stored server what it drives and writes the answer to the agent
 * mirror -- through that server's own endpoint, so a Home that is showing a
 * gateway other than the connected one never mirrors the wrong answer under
 * its id. A gateway whose mirrored capabilities do not list discovery is not
 * asked. Never throws; an answer that could not be read changes nothing.
 */
export async function refreshAgentServerDiscovery(
  record: GatewayRecord | undefined | null
): Promise<void> {
  if (!record) return;
  try {
    const [gatewayClient, agentSession, agentsStore, capabilityStore] = await Promise.all([
      import('@/lib/gateway-client'),
      import('@/lib/agent-session'),
      import('@/stores/agents'),
      import('@/stores/server-capabilities'),
    ]);
    const endpoint: GatewayEndpoint = {
      url: gatewayClient.effectiveGatewayBaseUrl(record),
      token: record.token,
      ...(record.deviceId ? { deviceId: record.deviceId } : {}),
      ...(record.transportKey ? { transportKey: record.transportKey } : {}),
      ...(record.transport ? { transport: record.transport } : {}),
    };
    const capabilities = capabilityStore.useServerCapabilities.getState().byServer[record.serverId];
    const discovery = await agentSession.getAgentsDiscovery({ capabilities, endpoint });
    if (discovery) agentsStore.useAgents.getState().record(record.serverId, discovery);
  } catch {
    // Home renders from the last mirror; a refresh that failed is not news.
  }
}

function normalizeReadinessCapabilities(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const name = entry.trim().slice(0, 48);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
    if (names.length >= 48) break;
  }
  return names;
}
