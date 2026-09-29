import { useCallback, useEffect } from 'react';

import {
  DEFAULT_AGENT_ID,
  agentFeaturesFor,
  normalizeAgentId,
  readyAgents,
  selectHomeAgents,
  selectedAgentFor,
  serverOffersAgentChoice,
  type AgentFeatures,
  type HomeAgentEntry,
  type MirroredAgent,
} from '@/lib/agent-discovery';
import { getAgentsDiscovery } from '@/lib/agent-session';
import type { GatewayEndpoint } from '@/lib/gateway-client';
import { useAgents } from '@/stores/agents';
import { useServerCapabilities } from '@/stores/server-capabilities';

/**
 * What one agent on one server can do, for the screen that draws it.
 *
 * Reads the discovery mirror, so it answers on the first render and never
 * fetches. With nothing mirrored for the server -- a gateway too old to be
 * asked, or one not asked yet -- the answer is the agent kind's own default,
 * and for OpenCode that is everything: a control is only ever taken away by a
 * gateway that said so.
 */
export function useAgentFeatures(
  serverId: string | undefined,
  agentId: string | undefined | null
): AgentFeatures {
  return useAgents(
    useCallback(
      (state) =>
        agentFeaturesFor(
          serverId ? state.index.servers[serverId]?.agents?.agents : undefined,
          agentId
        ),
      [serverId, agentId]
    )
  );
}

/** What a new-session path needs to know: the choice, and whether there is one. */
export interface AgentChoice {
  /** Every mirrored agent, in the gateway's order. */
  agents: HomeAgentEntry[];
  /** The ones a session can be created on right now. */
  ready: MirroredAgent[];
  /** Where a new session goes unless the reader says otherwise. */
  selected: string;
  /** Whether `ready` has more than one entry, i.e. whether to ask. */
  offersChoice: boolean;
  select: (agentId: string) => void;
}

export function useSelectedAgent(serverId: string | undefined): AgentChoice {
  const agents = useAgents(
    useCallback(
      (state) => (serverId ? selectHomeAgents(state.index, serverId) : NO_AGENTS),
      [serverId]
    )
  );
  const selected = useAgents(
    useCallback(
      (state) => (serverId ? selectedAgentFor(state.index, serverId) : DEFAULT_AGENT_ID),
      [serverId]
    )
  );
  const offersChoice = useAgents(
    useCallback(
      (state) => (serverId ? serverOffersAgentChoice(state.index, serverId) : false),
      [serverId]
    )
  );
  const selectInStore = useAgents((state) => state.select);
  const select = useCallback(
    (agentId: string) => {
      if (serverId) selectInStore(serverId, normalizeAgentId(agentId));
    },
    [selectInStore, serverId]
  );
  return { agents, ready: readyAgents(agents), selected, offersChoice, select };
}

const NO_AGENTS: HomeAgentEntry[] = [];

/**
 * Asks `serverId` what it drives and writes the answer to the mirror.
 *
 * Only a gateway whose mirrored `/health` capabilities say discovery exists is
 * asked (`getAgentsDiscovery` checks); every other server is left as the
 * single-agent gateway the app already knows how to drive. Safe to call on
 * every mount: an answer that could not be read changes nothing.
 */
export async function refreshAgentsDiscovery(
  serverId: string,
  endpoint?: GatewayEndpoint
): Promise<void> {
  if (!serverId) return;
  const capabilities = useServerCapabilities.getState().byServer[serverId];
  const discovery = await getAgentsDiscovery({ capabilities, ...(endpoint ? { endpoint } : {}) });
  if (discovery) useAgents.getState().record(serverId, discovery);
}

/**
 * Refreshes the mirror for the server a screen is on, once per server.
 *
 * `enabled` is the screen's own gate -- the workbench passes whether its
 * connection is up -- so a refresh is never sent to a server that is not yet
 * selected or whose tunnel is still opening.
 */
export function useAgentsDiscoveryRefresh(serverId: string | undefined, enabled = true): void {
  useEffect(() => {
    if (!serverId || !enabled) return;
    void refreshAgentsDiscovery(serverId);
  }, [serverId, enabled]);
}
