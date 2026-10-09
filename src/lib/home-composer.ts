/**
 * Home's dock: which computer a typed goal goes to, which agent starts it,
 * and what the new session is created with.
 *
 * Pure, so the rules are pinned by Bun tests; `home-composer-dock.tsx` is the
 * view, and it hosts the session screen's own `AgentComposer`.
 */

import type { AgentClientCommandId } from '@/lib/agent-commands';
import type { AgentFeatures } from '@/lib/agent-protocol';
import type { CatalogDefaults, ModeInfo, ModelInfo, ModelRef } from '@/lib/agent-session';
import {
  resolveNewSessionDefaults,
  type RememberedAgentChoice,
  type RememberedAgentDefaults,
} from '@/lib/agent-session-defaults';
import type { GatewayRecord } from '@/lib/gateway-storage';
import type { LaunchEntry } from '@/lib/home-launch-model';
import type { ServerReachability } from '@/lib/server-reachability';

type Reachability = Readonly<Record<string, ServerReachability | undefined>>;

export type HomeComposerTarget =
  /** Send starts a session here. */
  | { kind: 'ready'; server: GatewayRecord }
  /** The chosen computer is not answering; send opens the target picker instead. */
  | { kind: 'offline'; server: GatewayRecord }
  /** Nothing paired is reachable: the bar says so and send is disabled. */
  | { kind: 'none' };

function reachabilityOf(reachability: Reachability, serverId: string): ServerReachability {
  return reachability[serverId] ?? 'unknown';
}

/**
 * Where a goal goes. The chosen computer when there is one (the selection, or
 * the only one paired), else the first computer that may answer -- `live`
 * before `unknown`. A computer that is `offline` is never picked on its own,
 * and when every computer is offline there is no target at all.
 */
export function resolveHomeComposerTarget(input: {
  servers: readonly GatewayRecord[];
  chosen?: GatewayRecord;
  reachabilityByServer: Reachability;
}): HomeComposerTarget {
  const { servers, chosen, reachabilityByServer } = input;
  const reachable = servers.filter(
    (server) => reachabilityOf(reachabilityByServer, server.serverId) !== 'offline'
  );
  if (reachable.length === 0) return { kind: 'none' };
  if (chosen) {
    return reachabilityOf(reachabilityByServer, chosen.serverId) === 'offline'
      ? { kind: 'offline', server: chosen }
      : { kind: 'ready', server: chosen };
  }
  const first =
    reachable.find((server) => reachabilityOf(reachabilityByServer, server.serverId) === 'live') ??
    reachable[0]!;
  return { kind: 'ready', server: first };
}

/** The agent a goal starts: the first agent tile Home's launch row shows for that computer. */
export function homeComposerAgent(
  entries: readonly LaunchEntry[]
): { agentId?: string; name: string } | null {
  for (const entry of entries) {
    if (entry.kind === 'agent')
      return { name: entry.name, ...(entry.agentId ? { agentId: entry.agentId } : {}) };
  }
  return null;
}

/**
 * The gateway session Home's new agent sessions are made under: the one the
 * `/agent` route and the Pad detail default to when a link names none, so the
 * session Home starts is the session those screens then open.
 */
export const HOME_AGENT_SESSION_ID = 'herdr';

/**
 * The app's own `/` commands Home leaves out: every one of them acts on a
 * session that exists (undo, compact, export...) or on the session screen's own
 * sheets. `/models` stays, because Home has the model picker -- unless the
 * agent cannot switch models at all.
 */
export function homeHiddenClientCommands(
  features: Pick<AgentFeatures, 'modelSelection'>
): AgentClientCommandId[] {
  const hidden: AgentClientCommandId[] = [
    'new',
    'sessions',
    'agents',
    'undo',
    'keep',
    'compact',
    'clear',
    'export',
  ];
  if (!features.modelSelection) hidden.push('models');
  return hidden;
}

/**
 * What `POST /api/agent-sessions` carries for a goal sent from Home, which is
 * also what the dock's mode and model pills show before it is sent.
 *
 * The workbench's own ladder (`resolveNewSessionDefaults`): the reader's pick
 * in the dock, then what this server remembers, then the catalog's defaults.
 * The agent is named only on a gateway that has said which agents it drives;
 * an older gateway has one and no `agent_id` to read.
 */
export function homeSessionParams(input: {
  picked: RememberedAgentChoice;
  remembered: RememberedAgentDefaults;
  catalogDefaults: CatalogDefaults;
  models: readonly ModelInfo[];
  modes: readonly ModeInfo[];
  agentId?: string;
  agentsDiscovered: boolean;
}): { mode?: string; model?: ModelRef; agentId?: string } {
  const resolved = resolveNewSessionDefaults({
    picked: input.picked,
    ...input.remembered,
    catalogDefaults: input.catalogDefaults,
    models: input.models,
    modes: input.modes,
  });
  return {
    ...resolved,
    ...(input.agentsDiscovered && input.agentId ? { agentId: input.agentId } : {}),
  };
}
