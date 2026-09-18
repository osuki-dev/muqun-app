import { describe, expect, test } from 'bun:test';

import {
  isManagedWorktree,
  isWorktreeForceRequired,
  parseAgentDomainEvent,
  parseCreatedWorktree,
  parseWorktreeDirectory,
  parseWorktreeList,
  sameDirectory,
  sessionWorktreeName,
  worktreeDisplayName,
} from '../agent-protocol';

/** The inventory as 2.0.1 gives it: the project root first, with no strategy. */
const INVENTORY = [
  { directory: '/home/ryu/repo' },
  { directory: '/home/ryu/.local/share/opencode/worktree/016d5f/probe', strategy: 'git' },
];

describe('parseWorktreeDirectory', () => {
  test('keeps the strategy when there is one and omits the key when there is not', () => {
    expect(parseWorktreeDirectory({ directory: '/a', strategy: 'git' })).toEqual({
      directory: '/a',
      strategy: 'git',
    });
    const root = parseWorktreeDirectory({ directory: '/a' });
    expect(root).toEqual({ directory: '/a' });
    expect(root && 'strategy' in root).toBe(false);
  });

  test('answers null rather than throwing for anything that is not an entry', () => {
    for (const value of [null, undefined, 7, 'a', [], {}, { directory: '' }, { strategy: 'git' }]) {
      expect(parseWorktreeDirectory(value)).toBeNull();
    }
  });
});

describe('parseWorktreeList', () => {
  test('reads the documented envelope', () => {
    expect(parseWorktreeList({ items: INVENTORY })).toEqual(INVENTORY);
  });

  test('reads a bare array and a `worktrees` key too', () => {
    expect(parseWorktreeList(INVENTORY)).toEqual(INVENTORY);
    expect(parseWorktreeList({ worktrees: INVENTORY })).toEqual(INVENTORY);
  });

  test('drops entries that are not directories, and never throws', () => {
    expect(
      parseWorktreeList({ items: [null, 3, { strategy: 'git' }, { directory: '/a' }] })
    ).toEqual([{ directory: '/a' }]);
    for (const value of [null, undefined, 'items', 42, { items: 'no' }]) {
      expect(parseWorktreeList(value)).toEqual([]);
    }
  });

  test('a directory listed twice is one row', () => {
    expect(
      parseWorktreeList({ items: [{ directory: '/a' }, { directory: '/a', strategy: 'git' }] })
    ).toEqual([{ directory: '/a' }]);
  });
});

describe('isManagedWorktree', () => {
  test('the project root is not one; an entry with a strategy is', () => {
    expect(isManagedWorktree(INVENTORY[0])).toBe(false);
    expect(isManagedWorktree(INVENTORY[1])).toBe(true);
    expect(isManagedWorktree(undefined)).toBe(false);
    expect(isManagedWorktree({ directory: '/a', strategy: '' })).toBe(false);
  });
});

describe('parseCreatedWorktree', () => {
  test('reads the directory out of the `worktree` envelope', () => {
    expect(parseCreatedWorktree({ worktree: { directory: '/wt/probe' } })).toBe('/wt/probe');
  });

  test('accepts the bare Worktree.Info as well', () => {
    expect(parseCreatedWorktree({ directory: '/wt/probe' })).toBe('/wt/probe');
  });

  test('answers undefined for a reply with no directory in it', () => {
    for (const value of [null, undefined, {}, { worktree: {} }, 'ok', []]) {
      expect(parseCreatedWorktree(value)).toBeUndefined();
    }
  });
});

describe('worktreeDisplayName and sameDirectory', () => {
  test('the name is the last segment, trailing separator or not', () => {
    expect(worktreeDisplayName('/home/ryu/.local/share/opencode/worktree/016d5f/probe')).toBe(
      'probe'
    );
    expect(worktreeDisplayName('/home/ryu/repo/')).toBe('repo');
    expect(worktreeDisplayName('probe')).toBe('probe');
    expect(worktreeDisplayName('/')).toBe('/');
    expect(worktreeDisplayName(undefined)).toBe('');
  });

  test('a trailing separator does not make two directories', () => {
    expect(sameDirectory('/home/ryu/repo', '/home/ryu/repo/')).toBe(true);
    expect(sameDirectory('/home/ryu/repo', '/home/ryu/repo2')).toBe(false);
    expect(sameDirectory(undefined, undefined)).toBe(false);
    expect(sameDirectory('', '')).toBe(false);
  });
});

describe('sessionWorktreeName', () => {
  test('a session in the project root is in no worktree, however deep the path', () => {
    expect(sessionWorktreeName('/home/ryu/repo', '/home/ryu/repo', INVENTORY)).toBeUndefined();
    // The list decides it: the root is listed and carries no strategy, so even
    // a project directory the caller got wrong cannot turn it into a worktree.
    expect(sessionWorktreeName('/home/ryu/repo', '/elsewhere', INVENTORY)).toBeUndefined();
  });

  test('a session in a managed worktree is named by its basename', () => {
    expect(
      sessionWorktreeName(
        '/home/ryu/.local/share/opencode/worktree/016d5f/probe',
        '/home/ryu/repo',
        INVENTORY
      )
    ).toBe('probe');
  });

  test('with no inventory loaded, anything but the project directory is a worktree', () => {
    expect(sessionWorktreeName('/home/ryu/wt/probe', '/home/ryu/repo')).toBe('probe');
    expect(sessionWorktreeName('/home/ryu/repo/', '/home/ryu/repo')).toBeUndefined();
  });

  test('says nothing when there is nothing to compare against', () => {
    expect(sessionWorktreeName(undefined, '/home/ryu/repo', INVENTORY)).toBeUndefined();
    expect(sessionWorktreeName('/home/ryu/wt/probe', undefined)).toBeUndefined();
  });
});

describe('isWorktreeForceRequired', () => {
  test('recognises the flag in the body `writeJson` threw as a message', () => {
    expect(
      isWorktreeForceRequired(
        new Error(
          'Failed to remove worktree: 502 {"error":{"code":"agent_engine_error",' +
            '"message":"WorktreeError","forceRequired":true}}'
        )
      )
    ).toBe(true);
  });

  test('recognises it on a parsed object, nested or not, either spelling', () => {
    expect(isWorktreeForceRequired({ forceRequired: true })).toBe(true);
    expect(isWorktreeForceRequired({ force_required: true })).toBe(true);
    expect(isWorktreeForceRequired({ error: { forceRequired: true } })).toBe(true);
    expect(isWorktreeForceRequired({ data: { error: { forceRequired: true } } })).toBe(true);
  });

  test('every other refusal is a plain failure', () => {
    expect(
      isWorktreeForceRequired(new Error('Failed to remove worktree: 502 {"error":{"code":"x"}}'))
    ).toBe(false);
    expect(isWorktreeForceRequired({ forceRequired: false })).toBe(false);
    expect(isWorktreeForceRequired('forceRequired')).toBe(false);
    expect(isWorktreeForceRequired(null)).toBe(false);
    expect(isWorktreeForceRequired(undefined)).toBe(false);
    expect(isWorktreeForceRequired(42)).toBe(false);
  });
});

describe('agent.worktree.changed', () => {
  test('carries no asid and no seq, and still parses', () => {
    const event = parseAgentDomainEvent('agent.worktree.changed', {
      type: 'agent.worktree.changed',
      state: 'updated',
      directory: '/home/ryu/repo',
      project_id: '016d5ff1',
    });
    expect(event).toEqual({
      type: 'agent.worktree.changed',
      asid: '',
      seq: 0,
      state: 'updated',
      directory: '/home/ryu/repo',
      project_id: '016d5ff1',
    });
  });

  test('`ready` describes what was prepared', () => {
    const event = parseAgentDomainEvent('agent.worktree.changed', {
      state: 'ready',
      directory: '/home/ryu/repo',
      name: 'probe',
      branch: 'main',
    });
    expect(event && event.type === 'agent.worktree.changed' ? event.name : undefined).toBe('probe');
    expect(event && event.type === 'agent.worktree.changed' ? event.branch : undefined).toBe(
      'main'
    );
  });

  test('`failed` carries the message, and no other state does', () => {
    const failed = parseAgentDomainEvent('agent.worktree.changed', {
      state: 'failed',
      directory: '/home/ryu/repo',
      error: 'fatal: invalid reference: nope',
    });
    expect(failed && failed.type === 'agent.worktree.changed' ? failed.error : undefined).toBe(
      'fatal: invalid reference: nope'
    );
    const ready = parseAgentDomainEvent('agent.worktree.changed', {
      state: 'ready',
      error: 'stale',
    });
    expect(ready && ready.type === 'agent.worktree.changed' ? 'error' in ready : true).toBe(false);
  });

  test('a state the app does not know is not an event', () => {
    expect(
      parseAgentDomainEvent('agent.worktree.changed', { state: 'creating', directory: '/a' })
    ).toBeNull();
    expect(parseAgentDomainEvent('agent.worktree.changed', { directory: '/a' })).toBeNull();
    expect(parseAgentDomainEvent('agent.worktree.changed', null)).toBeNull();
  });
});
