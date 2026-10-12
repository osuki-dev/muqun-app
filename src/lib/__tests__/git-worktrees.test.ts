import { describe, expect, test } from 'bun:test';
import { gatewaySupportsGitWorktrees, parseGitWorktrees } from '../git-worktrees';

const current = '/repo';
const linked = { path: '/checkouts/linked', branch: 'feature', head: 'abc', detached: false };
const inventory = { current, worktrees: [{ ...linked, path: current }, linked] };

describe('Git worktree inventory', () => {
  test('uses the optional capability without guessing from other worktree support', () => {
    expect(gatewaySupportsGitWorktrees(['git_worktrees'])).toBe(true);
    expect(gatewaySupportsGitWorktrees(['git_diff', 'agent_worktrees'])).toBe(false);
    expect(gatewaySupportsGitWorktrees(undefined)).toBe(false);
  });
  test('accepts enveloped, detached and empty inventories', () => {
    expect(parseGitWorktrees({ data: inventory })).toEqual(inventory);
    expect(
      parseGitWorktrees({
        current: linked.path,
        worktrees: [{ ...linked, branch: null, detached: true }],
      })?.worktrees[0].detached
    ).toBe(true);
    expect(parseGitWorktrees({ current: null, worktrees: [] })).toEqual({
      current: null,
      worktrees: [],
    });
  });
  test('rejects partial, duplicate and mismatched inventories', () => {
    for (const value of [
      null,
      [],
      {},
      { current, worktrees: [] },
      { current, worktrees: [linked, linked] },
      { current: null, worktrees: [{ ...linked, path: '' }] },
      { current: null, worktrees: [{ ...linked, detached: 'false' }] },
      { current: null, worktrees: [{ path: linked.path }] },
    ]) {
      expect(parseGitWorktrees(value)).toBeNull();
    }
  });
});
