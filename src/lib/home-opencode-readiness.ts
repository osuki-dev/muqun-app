import type { GatewayEndpoint } from '@/lib/gateway-client';
import type { AgentCatalog, AgentProject } from '@/lib/agent-session';
import type { AgentEngineInfo } from '@/lib/agent-protocol';
import type { GatewayRecord } from '@/lib/gateway-storage';

export const OPENCODE_CAPABILITY = 'agent_sessions';
export const OPENCODE_READINESS_TIMEOUT_MS = 5000;

export type OpenCodeReadiness =
  | { status: 'ready'; capabilities: readonly string[] }
  | { status: 'unsupported'; capabilities: readonly string[] }
  | { status: 'not-installed'; capabilities: readonly string[] }
  | {
      status: 'offline';
      capabilities: readonly string[];
      cause: 'health' | 'catalog' | 'service';
    };

export type OpenCodeReadinessPorts = {
  probeHealth: () => Promise<{ ok: boolean; capabilities?: unknown }>;
  loadEngine?: () => Promise<AgentEngineInfo | null>;
  loadCatalog: () => Promise<AgentCatalog>;
  loadProjects: () => Promise<AgentProject[]>;
};

/**
 * Capability and transport are separate facts. A healthy gateway that does not
 * advertise agent sessions is unsupported; a gateway that advertises them but
 * cannot answer its catalog is temporarily offline. No gateway version is
 * inferred here.
 */
export async function checkOpenCodeReadiness(
  ports: OpenCodeReadinessPorts
): Promise<OpenCodeReadiness> {
  let health: { ok: boolean; capabilities?: unknown };
  try {
    health = await ports.probeHealth();
  } catch {
    return { status: 'offline', capabilities: [], cause: 'health' };
  }
  const capabilities = normalizeReadinessCapabilities(health.capabilities);
  if (!health.ok) return { status: 'offline', capabilities, cause: 'health' };
  if (!capabilities.includes(OPENCODE_CAPABILITY)) {
    return { status: 'unsupported', capabilities };
  }

  if (ports.loadEngine) {
    try {
      const engine = await ports.loadEngine();
      if (engine?.available) return { status: 'ready', capabilities };
      if (engine?.installation === 'not_found') {
        return { status: 'not-installed', capabilities };
      }
      if (engine?.installation === 'installed') {
        return { status: 'offline', capabilities, cause: 'service' };
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
    if (!loaded) return { status: 'offline', capabilities, cause: 'catalog' };
    const [catalog, projects] = loaded;
    if (catalog.models.length === 0 && catalog.agents.length === 0 && projects.length === 0) {
      return { status: 'offline', capabilities, cause: 'catalog' };
    }
  } catch {
    return { status: 'offline', capabilities, cause: 'catalog' };
  } finally {
    if (timer) clearTimeout(timer);
  }
  return { status: 'ready', capabilities };
}

/** Check one stored server through its own endpoint and credentials. */
export function checkOpenCodeServer(
  record: GatewayRecord | undefined | null
): Promise<OpenCodeReadiness> {
  if (!record) {
    return Promise.resolve({ status: 'offline', capabilities: [], cause: 'health' });
  }
  return (async () => {
    // Keep native transport modules out of the pure classifier's import graph.
    // This lets command and readiness tests run in Bun without React Native,
    // while this adapter still uses the real server-scoped APIs.
    try {
      const [gatewayClient, agentSession] = await Promise.all([
        import('@/lib/gateway-client'),
        import('@/lib/agent-session'),
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
      return checkOpenCodeReadiness({
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
        loadCatalog: () =>
          agentSession.getAgentCatalog(undefined, catalogEndpoint, {
            forceRefresh: true,
            requireFresh: true,
          }),
        loadProjects: () =>
          agentSession.getAgentProjects(undefined, catalogEndpoint, { forceRefresh: true }),
        loadEngine: () => agentSession.getAgentEngine(endpoint),
      });
    } catch {
      return { status: 'offline', capabilities: [], cause: 'health' };
    }
  })();
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
