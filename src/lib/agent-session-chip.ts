import { normalizeAgentId } from './agent-discovery';

/**
 * What a session chip leads with, before its title.
 *
 * The chip used to lead with the session's mode, and with the screen's own
 * selected mode when the session had none -- so a T3 session, which has no
 * modes at all, read "Osuki · Pong Response", an OpenCode mode it never ran.
 * The rule now:
 *
 *  * A session on another agent than the one on screen leads with that
 *    agent's name: what tells it apart is who answers it.
 *  * A session on this agent leads with its mode, when the agent has modes.
 *  * Otherwise nothing leads; the title stands alone.
 *
 * A session with no `agent_id` (an older gateway) is on the screen's agent.
 */
export type SessionChipLead =
  | { kind: 'agent'; agentId: string }
  | { kind: 'mode'; modeId: string }
  | null;

export function sessionChipLead(input: {
  sessionAgentId?: string | null;
  currentAgentId: string;
  sessionMode?: string | null;
  /** The screen's selected mode, for a session that has not said its own. */
  fallbackMode?: string;
  /** Whether the current agent has modes to show: its features and its catalog. */
  agentHasModes: boolean;
}): SessionChipLead {
  const sessionAgent = input.sessionAgentId ? normalizeAgentId(input.sessionAgentId) : undefined;
  if (sessionAgent && sessionAgent !== normalizeAgentId(input.currentAgentId)) {
    return { kind: 'agent', agentId: sessionAgent };
  }
  if (!input.agentHasModes) return null;
  const mode = input.sessionMode || input.fallbackMode;
  return mode ? { kind: 'mode', modeId: mode } : null;
}
