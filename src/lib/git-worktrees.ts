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
  /**
   * The gateway cut the list at its cap (512): `worktrees` is the start of
   * it, `total` is how many git reported. Both absent on an older gateway.
   */
  truncated?: boolean;
  total?: number;
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
  // The cut is optional on the wire; a malformed cut is no cut, not a refusal,
  // because the entries themselves are still verified.
  const truncated = 'truncated' in data && data.truncated === true;
  const total =
    'total' in data && typeof data.total === 'number' && Number.isInteger(data.total)
      ? data.total
      : undefined;
  return {
    current: data.current,
    worktrees,
    ...(truncated ? { truncated } : {}),
    ...(total !== undefined && total >= worktrees.length ? { total } : {}),
  };
}

/** The current checkout first, the others in git's order. */
export function orderWorktrees(inventory: GitWorktreeInventory): GitWorktree[] {
  const { current, worktrees } = inventory;
  if (current === null) return worktrees;
  const index = worktrees.findIndex((item) => item.path === current);
  if (index <= 0) return worktrees;
  return [worktrees[index], ...worktrees.slice(0, index), ...worktrees.slice(index + 1)];
}

/** How many characters a chip shows of a branch before it is cut in the middle. */
export const WORKTREE_CHIP_CHARS = 24;

/**
 * A branch name short enough for a chip: cut in the middle, so both the
 * prefix (`feat/`) and the tail that tells two branches apart survive. The
 * full name is in the chip's accessibility label.
 */
export function compactWorktreeLabel(label: string, max = WORKTREE_CHIP_CHARS): string {
  const chars = Array.from(label);
  if (chars.length <= max) return label;
  const head = Math.ceil((max - 1) / 2);
  const tail = max - 1 - head;
  return `${chars.slice(0, head).join('')}…${chars.slice(chars.length - tail).join('')}`;
}
