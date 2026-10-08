import { describe, expect, test } from 'bun:test';

import { parseAgentSessionInfo } from '../agent-protocol';
import { changesSessionDirectory, changesWorktreeContext } from '../changes-worktree-context';

const directory = '/checkouts/quiet-river';
const inventory = {
  directory,
  revision: 0,
  entries: [{ directory: '/repo' }, { directory, strategy: 'git' }],
};

describe('changesWorktreeContext', () => {
  test('names only the inventory-confirmed managed checkout, with its own path', () => {
    expect(changesWorktreeContext(directory, inventory)).toEqual({
      name: 'quiet-river',
      directory,
    });
    expect(changesWorktreeContext(`${directory}/`, inventory)?.name).toBe('quiet-river');
  });

  test('does not label the main repository as a worktree', () => {
    expect(changesWorktreeContext('/repo', { ...inventory, directory: '/repo' })).toBeUndefined();
  });

  test('does not guess from an arbitrary directory name or absent inventory', () => {
    expect(changesWorktreeContext('/repo/subdir', inventory)).toBeUndefined();
    expect(changesWorktreeContext(directory, undefined)).toBeUndefined();
    expect(
      changesWorktreeContext(directory, { directory, entries: [], revision: 0 })
    ).toBeUndefined();
  });

  test('hides the old worktree immediately after a directory switch', () => {
    const nextDirectory = '/checkouts/new-worktree';
    expect(changesWorktreeContext(nextDirectory, inventory)).toBeUndefined();
    expect(
      changesWorktreeContext(nextDirectory, {
        directory: nextDirectory,
        revision: 0,
        entries: [{ directory: nextDirectory, strategy: 'git' }],
      })
    ).toEqual({ name: 'new-worktree', directory: nextDirectory });
  });

  test('invalidates a removed worktree during a same-context inventory refresh', () => {
    expect(changesWorktreeContext(directory, inventory, 1)).toBeUndefined();
    expect(
      changesWorktreeContext(directory, { ...inventory, revision: 1, entries: [] }, 1)
    ).toBeUndefined();
    expect(changesWorktreeContext(directory, { ...inventory, revision: 1 }, 1)?.name).toBe(
      'quiet-river'
    );
  });
});

describe('changesSessionDirectory', () => {
  const info = parseAgentSessionInfo({ asid: 'a', directory });
  if (!info) throw new Error('Invalid session fixture');
  const bridge = { sessionId: 'gateway-a', sessionInfo: info, sessions: [info] };

  test('uses the route-selected session rather than another active workspace', () => {
    expect(changesSessionDirectory('gateway-a', 'a', bridge)).toBe(directory);
    expect(changesSessionDirectory('gateway-a', 'b', bridge)).toBeUndefined();
    expect(changesSessionDirectory('gateway-b', 'a', bridge)).toBeUndefined();
    expect(changesSessionDirectory('gateway-a', '', bridge)).toBeUndefined();
  });

  test('finds a non-active session without borrowing the active directory', () => {
    const other = { ...info, asid: 'b', directory: '/repo' };
    expect(changesSessionDirectory('gateway-a', 'b', { ...bridge, sessions: [info, other] })).toBe(
      '/repo'
    );
  });
});
