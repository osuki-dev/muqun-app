import type { GatewayAgentSession } from './home-continue';
import { asRecord } from './record';
import type { ServerAgent } from './server-agents';

export const HOME_OVERVIEW_CAPABILITY = 'home_overview_v1';
export type HomeOverview = {
  workspaces: { sessionId: string; agents: ServerAgent[] }[];
  sessions: GatewayAgentSession[];
};
const id = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 256 &&
  !/[\u0000-\u001f]/.test(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.length <= 4096;
const optionalText = (value: unknown) => value === undefined || text(value);

/** Validate the Gateway's ready-to-display projection; do not sort or infer identities. */
export function parseHomeOverview(value: unknown): HomeOverview | null {
  const row = asRecord(value);
  if (
    !row ||
    !Array.isArray(row.workspaces) ||
    row.workspaces.length > 16 ||
    !Array.isArray(row.sessions) ||
    row.sessions.length > 50
  )
    return null;
  const workspaceIds = new Set<string>();
  for (const value of row.workspaces) {
    const workspace = asRecord(value);
    if (
      !workspace ||
      !id(workspace.sessionId) ||
      workspaceIds.has(workspace.sessionId) ||
      !Array.isArray(workspace.agents) ||
      workspace.agents.length > 100
    )
      return null;
    workspaceIds.add(workspace.sessionId);
    const ids = new Set<string>();
    for (const value of workspace.agents) {
      const agent = asRecord(value);
      if (
        !agent ||
        !id(agent.id) ||
        !id(agent.paneId) ||
        ids.has(agent.paneId) ||
        !text(agent.name) ||
        typeof agent.hasAgent !== 'boolean' ||
        !['working', 'blocked', 'idle', 'done', 'unknown'].includes(String(agent.status))
      )
        return null;
      if (
        ![agent.instanceId, agent.agentLabel, agent.cwd].every(optionalText) ||
        (agent.shellPid !== undefined &&
          (!Number.isSafeInteger(agent.shellPid) || Number(agent.shellPid) <= 0)) ||
        (agent.pendingUserInput !== undefined && typeof agent.pendingUserInput !== 'boolean')
      )
        return null;
      ids.add(agent.paneId);
    }
  }
  const identities = new Set<string>();
  for (const value of row.sessions) {
    const session = asRecord(value);
    if (
      !session ||
      !id(session.asid) ||
      !id(session.agentId) ||
      !text(session.title) ||
      !text(session.directory) ||
      !Number.isSafeInteger(session.updatedMs) ||
      Number(session.updatedMs) < 0 ||
      !['idle', 'busy', 'retry', 'failed', 'interrupted', 'unknown'].includes(
        String(session.status)
      )
    )
      return null;
    if (session.terminal !== undefined) {
      const terminal = asRecord(session.terminal);
      if (
        !terminal ||
        !id(terminal.sessionId) ||
        !id(terminal.paneId) ||
        !optionalText(terminal.instanceId)
      )
        return null;
    }
    const key = JSON.stringify([session.agentId, session.asid]);
    if (identities.has(key)) return null;
    identities.add(key);
  }
  return row as HomeOverview;
}
