import { canAssignToAgent } from './agent-collaboration';
import type { GatewayEntity } from './gateway-entities';
import { field } from './herdr-entity';

export type AgentCommandDestination = {
  serverId: string;
  sessionId: string;
  paneId: string;
  instanceId: string;
  target: string;
};

export class AgentCommandDeliveryError extends Error {
  constructor(readonly code: 'connection' | 'agent' | 'unsupported' | 'ambiguous') {
    super(`Agent command delivery: ${code}`);
  }
}

/** Capture once when opening the command surface, not after the user presses Send. */
export function agentCommandDestination(
  serverId: string,
  sessionId: string,
  paneId: string,
  agents: GatewayEntity[]
): AgentCommandDestination | null {
  const agent = agents.find((item) => (field(item, 'pane_id') || item.id) === paneId);
  const instanceId = field(agent, 'instance_id');
  if (!serverId || !sessionId || !paneId || !agent || !instanceId) return null;
  return { serverId, sessionId, paneId, instanceId, target: field(agent, 'target') || paneId };
}

/**
 * One guard for user-authored instructions and agent slash commands.
 *
 * The destination is captured when the surface opens and re-verified against a
 * fresh read immediately before the send: same pane, same agent instance. That
 * is strictly more than the composer does for the same agent -- `sendInput`
 * checks the pane and not the instance -- and it is what a command sheet can
 * honestly offer. It cannot close a replacement race in the window between the
 * check and the write, and it does not claim to.
 *
 * `requireIdle` is the collaboration rule, not a rule about agents. A new
 * assignment starts at an idle prompt because Herdr cannot correlate its
 * completion with a specific turn (`canAssignToAgent`). A slash command has no
 * completion to correlate -- `/status` asked of a working agent is an ordinary
 * question -- so the surface that sends those passes `false`.
 */
export async function sendVerifiedAgentCommand(
  destination: AgentCommandDestination | null,
  text: string,
  ports: {
    connectedServerId: () => string | undefined;
    loadAgents: (sessionId: string) => Promise<GatewayEntity[]>;
    supportsBoundDelivery: () => Promise<boolean>;
    send: (destination: AgentCommandDestination, text: string) => Promise<void>;
    /** Defaults to the collaboration rule; see above. */
    requireIdle?: boolean;
  }
): Promise<void> {
  if (!destination) throw new AgentCommandDeliveryError('agent');
  const assertConnection = () => {
    if (ports.connectedServerId() !== destination.serverId)
      throw new AgentCommandDeliveryError('connection');
  };
  assertConnection();
  const [agents, supported] = await Promise.all([
    ports.loadAgents(destination.sessionId),
    ports.supportsBoundDelivery(),
  ]);
  assertConnection();
  if (!supported) throw new AgentCommandDeliveryError('unsupported');
  const current = agentCommandDestination(
    destination.serverId,
    destination.sessionId,
    destination.paneId,
    agents
  );
  const agent = agents.find((item) => (field(item, 'pane_id') || item.id) === destination.paneId);
  if (
    !current ||
    current.instanceId !== destination.instanceId ||
    ((ports.requireIdle ?? true) && !canAssignToAgent(agent?.status ?? 'unknown'))
  )
    throw new AgentCommandDeliveryError('agent');
  try {
    await ports.send(current, text);
  } catch {
    // Do not retry a write whose acknowledgement was lost.
    throw new AgentCommandDeliveryError('ambiguous');
  }
}
