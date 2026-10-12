import { isServerAgentsStale, type ServerAgentsSnapshot } from './server-agents';

/** Read one confirmed native question without inferring it from agent status. */
export function terminalPendingUserInput(
  snapshot: ServerAgentsSnapshot | undefined,
  sessionId: string,
  paneId: string,
  nowMs: number,
  expectedShellPid: number | undefined
): boolean {
  if (
    !expectedShellPid ||
    !snapshot ||
    snapshot.sessionId !== sessionId ||
    isServerAgentsStale(snapshot, nowMs)
  )
    return false;
  return snapshot.agents.some(
    (agent) =>
      agent.paneId === paneId &&
      agent.shellPid === expectedShellPid &&
      Boolean(agent.instanceId) &&
      agent.hasAgent &&
      agent.pendingUserInput === true
  );
}
