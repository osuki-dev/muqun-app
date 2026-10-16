import { describe, expect, test } from 'bun:test';

import { parseAgentVcsDiff, parseWorkspaceMissing } from '../agent-protocol';

/** The gateway's answer, verbatim from `docs/agent-api.md`. */
const REFUSAL = {
  error: {
    code: 'workspace_missing',
    message: 'The workspace folder is gone: /home/me/throwaway',
    directory: '/home/me/throwaway',
  },
};

describe('parseWorkspaceMissing', () => {
  test('reads the documented body', () => {
    expect(parseWorkspaceMissing(REFUSAL)).toEqual({
      code: 'workspace_missing',
      message: 'The workspace folder is gone: /home/me/throwaway',
      directory: '/home/me/throwaway',
    });
  });

  test('reads it through the gateway envelope and out of the bare error', () => {
    expect(parseWorkspaceMissing({ data: REFUSAL })?.directory).toBe('/home/me/throwaway');
    expect(parseWorkspaceMissing(REFUSAL.error)?.directory).toBe('/home/me/throwaway');
  });

  test('a message is optional; a directory is not', () => {
    expect(
      parseWorkspaceMissing({ error: { code: 'workspace_missing', directory: '/a' } })
    ).toEqual({ code: 'workspace_missing', message: '', directory: '/a' });
    expect(parseWorkspaceMissing({ error: { code: 'workspace_missing' } })).toBeNull();
  });

  test('every other refusal is not one of these', () => {
    for (const value of [
      null,
      undefined,
      7,
      'workspace_missing',
      [],
      {},
      { error: { code: 'agent_engine_error', message: 'boom', directory: '/a' } },
      { error: { code: 'not_found' } },
    ]) {
      expect(parseWorkspaceMissing(value)).toBeNull();
    }
  });
});

describe('parseAgentVcsDiff', () => {
  const ITEM = { path: 'a.ts', patch: '@@', additions: 1, deletions: 0 };

  test('reads the object gateway d53e8d0 answers with', () => {
    expect(parseAgentVcsDiff({ files: [ITEM], vcs: 'git', reason: null })).toEqual({
      files: [ITEM],
      vcs: 'git',
    });
  });

  test('carries the reason a non-git folder gives', () => {
    expect(parseAgentVcsDiff({ files: [], vcs: null, reason: 'not_a_repository' })).toEqual({
      files: [],
      vcs: null,
      reason: 'not_a_repository',
    });
  });

  test('a clean repository has no reason at all', () => {
    expect(parseAgentVcsDiff({ files: [], vcs: 'git', reason: null })).toEqual({
      files: [],
      vcs: 'git',
    });
  });

  test('an older gateway answers the bare array, and is taken at its word', () => {
    expect(parseAgentVcsDiff([ITEM])).toEqual({ files: [ITEM], vcs: 'git' });
    expect(parseAgentVcsDiff([])).toEqual({ files: [], vcs: 'git' });
    expect(parseAgentVcsDiff({ diff: [ITEM] })).toEqual({ files: [ITEM], vcs: 'git' });
  });

  test('an unreadable body is an empty answer rather than a throw', () => {
    for (const value of [null, undefined, 7, 'diff', {}]) {
      expect(parseAgentVcsDiff(value).files).toEqual([]);
      expect(parseAgentVcsDiff(value).reason).toBeUndefined();
    }
  });

  test('files win over a reason not to have any', () => {
    const answer = parseAgentVcsDiff({ files: [ITEM], vcs: null, reason: 'not_a_repository' });
    expect(answer.files).toHaveLength(1);
    expect(answer.reason).toBeUndefined();
  });

  test('does not list empty file entries, but keeps stat-only and binary diffs', () => {
    const answer = parseAgentVcsDiff({
      files: [
        { path: 'empty.ts', patch: '', additions: 0, deletions: 0 },
        { path: 'stats.ts', patch: '', additions: 2, deletions: 1 },
        {
          path: 'image.png',
          patch: 'Binary files a/image.png and b/image.png differ',
          additions: 0,
          deletions: 0,
        },
      ],
      vcs: 'git',
    });
    expect(answer.files.map((file) => file.path)).toEqual(['stats.ts', 'image.png']);
  });
});
