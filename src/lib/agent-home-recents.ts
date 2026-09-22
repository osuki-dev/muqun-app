import type { AgentRunStatus, AgentSessionInfo } from './agent-protocol';
import type { HomeRecentsState } from './home-recents-state';

/** Parent identity, never a title or pane mirror, excludes a subagent visit. */
export function isRootSessionRecent(
  info: Pick<AgentSessionInfo, 'parent_id' | 'deleted'>
): boolean {
  return !info.parent_id && !info.deleted;
}

/** Status-only events may update Home only for a root already in authoritative inventory. */
export function rootSessionWithStatus(
  inventory: readonly AgentSessionInfo[],
  asid: string,
  status: AgentRunStatus
): AgentSessionInfo | null {
  const root = inventory.find((info) => info.asid === asid && isRootSessionRecent(info));
  return root ? { ...root, status } : null;
}

/** Remove older child visits even if their directory has since changed. */
export async function removeChildSessionRecents(
  getRecents: () => HomeRecentsState,
  serverId: string,
  inventory: readonly Pick<AgentSessionInfo, 'asid' | 'parent_id'>[]
): Promise<void> {
  const children = new Set(inventory.filter((info) => info.parent_id).map((info) => info.asid));
  if (!serverId || children.size === 0) return;
  await getRecents().hydrate();
  const targets = getRecents().entries.flatMap(({ target }) =>
    target.kind === 'opencode-session' && target.serverId === serverId && children.has(target.asid)
      ? [target]
      : []
  );
  await Promise.all(targets.map((target) => getRecents().remove(target)));
}
