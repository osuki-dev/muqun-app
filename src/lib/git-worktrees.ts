/** Read-only inventory of Git's linked checkouts, scoped to one pane's repository. */
export interface GitWorktree {
  path: string;
  branch: string | null;
  head: string | null;
  detached: boolean;
}

export interface GitWorktreeInventory {
  current: string | null;
  worktrees: GitWorktree[];
}

export function gatewaySupportsGitWorktrees(
  capabilities: readonly string[] | undefined | null
): boolean {
  return capabilities?.includes('git_worktrees') === true;
}

/** Reject an invalid inventory rather than offering an unverified checkout. */
export function parseGitWorktrees(value: unknown): GitWorktreeInventory | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = 'data' in value ? value.data : value;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  if (!('current' in data) || !('worktrees' in data) || !Array.isArray(data.worktrees)) return null;
  if (data.current !== null && (typeof data.current !== 'string' || !data.current)) return null;
  const worktrees: GitWorktree[] = [];
  const paths = new Set<string>();
  for (const entry of data.worktrees) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    if (typeof entry.path !== 'string' || !entry.path || paths.has(entry.path)) return null;
    if (entry.branch !== null && typeof entry.branch !== 'string') return null;
    if (entry.head !== null && typeof entry.head !== 'string') return null;
    if (typeof entry.detached !== 'boolean') return null;
    paths.add(entry.path);
    worktrees.push({
      path: entry.path,
      branch: entry.branch,
      head: entry.head,
      detached: entry.detached,
    });
  }
  if (data.current !== null && !paths.has(data.current)) return null;
  return { current: data.current, worktrees };
}
