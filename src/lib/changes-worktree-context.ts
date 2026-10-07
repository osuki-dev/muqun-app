import {
  isManagedWorktree,
  sameDirectory,
  worktreeDisplayName,
  type AgentSessionInfo,
  type WorktreeDirectory,
} from './agent-protocol';

export interface ChangesWorktreeContext {
  name: string;
  directory: string;
}

/** Never borrow the currently open workspace for a different diff route. */
export function changesSessionDirectory(
  sessionId: string,
  asid: string,
  bridge: {
    sessionId: string;
    sessionInfo?: AgentSessionInfo;
    sessions: readonly AgentSessionInfo[];
  }
): string | undefined {
  if (!asid || sessionId !== bridge.sessionId) return undefined;
  const info =
    bridge.sessionInfo?.asid === asid
      ? bridge.sessionInfo
      : bridge.sessions.find((session) => session.asid === asid);
  return info?.directory;
}

/**
 * OpenCode's inventory names managed checkouts by their directory, not branch.
 * Only a matching managed entry proves this is a worktree; a different path
 * from the project's root, or a directory basename alone, proves nothing.
 */
export function changesWorktreeContext(
  directory: string | undefined,
  inventory:
    | { directory: string; entries: readonly WorktreeDirectory[]; revision: number }
    | undefined,
  revision = 0
): ChangesWorktreeContext | undefined {
  if (
    !directory ||
    !inventory ||
    inventory.revision !== revision ||
    !sameDirectory(directory, inventory.directory)
  )
    return undefined;
  const entry = inventory.entries.find((item) => sameDirectory(item.directory, directory));
  if (!entry || !isManagedWorktree(entry)) return undefined;
  return { name: worktreeDisplayName(entry.directory), directory: entry.directory };
}
