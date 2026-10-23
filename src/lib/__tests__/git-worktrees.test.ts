import { describe, expect, test } from 'bun:test';
import {
  compactWorktreeLabel,
  gatewaySupportsGitWorktrees,
  orderWorktrees,
  parseGitWorktrees,
} from '../git-worktrees';

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
  test('reads a cut list, and ignores a cut it cannot trust', () => {
    expect(parseGitWorktrees({ ...inventory, truncated: true, total: 201 })).toEqual({
      ...inventory,
      truncated: true,
      total: 201,
    });
    // An older gateway says nothing about a cut; a total under the list is no total.
    expect(parseGitWorktrees(inventory)).toEqual(inventory);
    expect(parseGitWorktrees({ ...inventory, truncated: 'yes', total: 1 })).toEqual(inventory);
  });
  test('puts the current checkout first and keeps the rest in git order', () => {
    const a = { ...linked, path: '/a' };
    const b = { ...linked, path: '/b' };
    const c = { ...linked, path: '/c' };
    expect(orderWorktrees({ current: '/b', worktrees: [a, b, c] })).toEqual([b, a, c]);
    expect(orderWorktrees({ current: '/a', worktrees: [a, b, c] })).toEqual([a, b, c]);
    expect(orderWorktrees({ current: null, worktrees: [c, a] })).toEqual([c, a]);
  });
  test('cuts a long branch in the middle', () => {
    expect(compactWorktreeLabel('feat/git-diff')).toBe('feat/git-diff');
    expect(compactWorktreeLabel('feature/very-long-branch-name-for-release-42')).toBe(
      'feature/very…-release-42'
    );
    expect(Array.from(compactWorktreeLabel('x'.repeat(80))).length).toBe(24);
  });
});
