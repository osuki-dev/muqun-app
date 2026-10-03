import { describe, expect, test } from 'bun:test';

import {
  gatewaySupportsVcsFiles,
  parseAgentVcsDiscard,
  parseAgentVcsFilePatch,
  parseAgentVcsFiles,
} from '../agent-protocol';

describe('gatewaySupportsVcsFiles', () => {
  test('is the capability, and nothing else', () => {
    expect(gatewaySupportsVcsFiles(['agent_sessions', 'agent_vcs_files'])).toBe(true);
    expect(gatewaySupportsVcsFiles(['agent_vcs'])).toBe(false);
    expect(gatewaySupportsVcsFiles(undefined)).toBe(false);
    expect(gatewaySupportsVcsFiles(null)).toBe(false);
  });
});

describe('parseAgentVcsFiles', () => {
  test('reads the documented body', () => {
    expect(
      parseAgentVcsFiles({
        vcs: 'git',
        mode: 'branch',
        base: 'origin/main',
        truncated: true,
        files: [
          { path: 'a/b.ts', status: 'modified', additions: 3, deletions: 1, binary: false },
          {
            path: 'c.png',
            old_path: 'd.png',
            status: 'renamed',
            additions: 0,
            deletions: 0,
            binary: true,
          },
        ],
      })
    ).toEqual({
      files: [
        { path: 'a/b.ts', status: 'modified', additions: 3, deletions: 1, binary: false },
        {
          path: 'c.png',
          oldPath: 'd.png',
          status: 'renamed',
          additions: 0,
          deletions: 0,
          binary: true,
        },
      ],
      mode: 'branch',
      base: 'origin/main',
      truncated: true,
      vcs: 'git',
    });
  });

  test('a non-repository says so; a clean one does not', () => {
    expect(
      parseAgentVcsFiles({
        vcs: null,
        reason: 'not_a_repository',
        mode: 'working',
        truncated: false,
        files: [],
      })
    ).toEqual({
      files: [],
      mode: 'working',
      truncated: false,
      vcs: null,
      reason: 'not_a_repository',
    });
    expect(parseAgentVcsFiles({ vcs: 'git', mode: 'working', files: [] })?.reason).toBeUndefined();
  });

  test('defaults what an answer leaves out, and drops entries with no path', () => {
    expect(parseAgentVcsFiles({ files: [{ path: 'x' }, { status: 'added' }, 7] })).toEqual({
      files: [{ path: 'x', additions: 0, deletions: 0, binary: false }],
      mode: 'working',
      truncated: false,
      vcs: 'git',
    });
  });

  test('anything without a file list is no answer, which means fall back', () => {
    for (const value of [null, undefined, [], {}, { files: 'nope' }, 'files']) {
      expect(parseAgentVcsFiles(value)).toBeNull();
    }
  });
});

describe('parseAgentVcsFilePatch', () => {
  test('reads one file with its patch', () => {
    expect(
      parseAgentVcsFilePatch({
        path: 'a.ts',
        status: 'added',
        additions: 2,
        deletions: 0,
        binary: false,
        patch: '@@ -0,0 +1,2 @@\n+a\n+b',
        truncated: false,
      })
    ).toEqual({
      path: 'a.ts',
      status: 'added',
      additions: 2,
      deletions: 0,
      binary: false,
      patch: '@@ -0,0 +1,2 @@\n+a\n+b',
      truncated: false,
    });
  });

  test('no path is no answer', () => {
    expect(parseAgentVcsFilePatch({ patch: '@@' })).toBeNull();
    expect(parseAgentVcsFilePatch(null)).toBeNull();
  });
});

describe('parseAgentVcsDiscard', () => {
  test('reads both actions', () => {
    expect(parseAgentVcsDiscard({ path: 'a', action: 'restored' })).toEqual({
      path: 'a',
      action: 'restored',
    });
    expect(parseAgentVcsDiscard({ path: 'b', action: 'deleted' })?.action).toBe('deleted');
  });

  test('an unknown action is not an answer', () => {
    expect(parseAgentVcsDiscard({ path: 'a', action: 'stashed' })).toBeNull();
    expect(parseAgentVcsDiscard({ action: 'restored' })).toBeNull();
  });
});
