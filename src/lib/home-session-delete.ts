import type { HomeContinueEntry } from './home-continue';
import type { HomeTarget } from './home-recents';

export const AGENT_SESSION_DELETE_SCOPED_CAPABILITY = 'agent_session_delete_scoped';
export type HomeDeletableTarget = Extract<HomeTarget, { kind: 'agent-session' }>;

/** Freeze the provider and conversation named by the row, before selection can change. */
export function homeSessionDeleteTarget(entry: HomeContinueEntry): HomeDeletableTarget | undefined {
  const destination = entry.destination;
  if (destination.type === 'pane' || destination.target.kind !== 'agent-session') return undefined;
  const agentId = destination.target.agentId?.trim();
  if (!agentId) return undefined;
  return { ...destination.target, agentId };
}

export class HomeSessionDeleteUnavailableError extends Error {
  constructor(readonly reason: 'capability' | 'provider' = 'capability') {
    super();
  }
}

/** One provider-scoped remote write, then local cleanup only after confirmed success. */
export async function deleteHomeSession({
  target,
  capabilities,
  remove,
  forget,
}: {
  target: HomeDeletableTarget;
  capabilities: readonly string[] | undefined;
  remove: (path: string) => Promise<void>;
  forget: (target: HomeDeletableTarget) => Promise<void>;
}): Promise<void> {
  const agentId = target.agentId?.trim();
  if (!agentId) throw new HomeSessionDeleteUnavailableError('provider');
  if (!capabilities?.includes(AGENT_SESSION_DELETE_SCOPED_CAPABILITY))
    throw new HomeSessionDeleteUnavailableError();
  const path = `/api/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(target.asid)}`;
  await remove(path);
  await forget(target);
}
