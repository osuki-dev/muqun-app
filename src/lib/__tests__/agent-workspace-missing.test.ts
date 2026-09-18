import { describe, expect, test } from 'bun:test';

import { parseAgentVcsDiff, parseWorkspaceMissing } from '../agent-protocol';
import {
  badgeLoadsAllowed,
  diffEmptyState,
  listableWorkspaces,
  workspaceMissingState,
  workspaceProjectMissing,
} from '../agent-workspace-missing';
import type { AgentProject } from '../agent-protocol';

/** The gateway's answer, verbatim from `docs/agent-api.md`. */
const REFUSAL = {
  error: {
    code: 'workspace_missing',
    message: 'The workspace folder is gone: /home/ryu/throwaway',
    directory: '/home/ryu/throwaway',
  },
};

describe('parseWorkspaceMissing', () => {
  test('reads the documented body', () => {
    expect(parseWorkspaceMissing(REFUSAL)).toEqual({
      code: 'workspace_missing',
      message: 'The workspace folder is gone: /home/ryu/throwaway',
      directory: '/home/ryu/throwaway',
    });
  });

  test('reads it through the gateway envelope and out of the bare error', () => {
    expect(parseWorkspaceMissing({ data: REFUSAL })?.directory).toBe('/home/ryu/throwaway');
    expect(parseWorkspaceMissing(REFUSAL.error)?.directory).toBe('/home/ryu/throwaway');
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
});

describe('workspaceMissingState', () => {
  test('binds the refusal to the session it was about', () => {
    expect(workspaceMissingState(parseWorkspaceMissing(REFUSAL), 'as_1')).toEqual({
      asid: 'as_1',
      directory: '/home/ryu/throwaway',
      message: 'The workspace folder is gone: /home/ryu/throwaway',
    });
  });

  test('nothing to say without a refusal or without a session', () => {
    expect(workspaceMissingState(null, 'as_1')).toBeNull();
    expect(workspaceMissingState(parseWorkspaceMissing(REFUSAL), undefined)).toBeNull();
  });
});

describe('badgeLoadsAllowed', () => {
  const missing = {
    asid: 'as_1',
    directory: '/home/ryu/throwaway',
    message: 'The workspace folder is gone: /home/ryu/throwaway',
  };

  test('allowed until something refuses', () => {
    expect(badgeLoadsAllowed({ asid: 'as_1', directory: '/home/ryu/throwaway' })).toBe(true);
    expect(
      badgeLoadsAllowed({ asid: 'as_1', directory: '/home/ryu/throwaway', missing: null })
    ).toBe(true);
  });

  test('stopped for the session standing on the folder that is gone', () => {
    expect(badgeLoadsAllowed({ asid: 'as_1', directory: '/home/ryu/throwaway', missing })).toBe(
      false
    );
  });

  test('a trailing slash is the same folder', () => {
    expect(badgeLoadsAllowed({ asid: 'as_1', directory: '/home/ryu/throwaway/', missing })).toBe(
      false
    );
  });

  test('another session on the same host loads as usual', () => {
    expect(badgeLoadsAllowed({ asid: 'as_2', directory: '/home/ryu/throwaway', missing })).toBe(
      true
    );
  });

  test('a move to a worktree resumes the reads', () => {
    expect(
      badgeLoadsAllowed({ asid: 'as_1', directory: '/home/ryu/repo/.worktree/x', missing })
    ).toBe(true);
  });

  test('a refusal with nowhere named on screen still stops them', () => {
    expect(badgeLoadsAllowed({ asid: 'as_1', missing })).toBe(false);
    expect(badgeLoadsAllowed({ missing })).toBe(false);
  });
});

describe('diffEmptyState', () => {
  test('rows beat every reason there might be none', () => {
    expect(diffEmptyState({ loading: true, fileCount: 2, reason: 'workspace_missing' })).toBe(
      'rows'
    );
  });

  test('the four empty answers are four different sentences', () => {
    expect(diffEmptyState({ loading: true, fileCount: 0 })).toBe('loading');
    expect(diffEmptyState({ loading: false, fileCount: 0, reason: 'workspace_missing' })).toBe(
      'workspace-missing'
    );
    expect(diffEmptyState({ loading: false, fileCount: 0, reason: 'not_a_repository' })).toBe(
      'not-a-repository'
    );
    expect(diffEmptyState({ loading: false, fileCount: 0 })).toBe('clean');
  });
});

describe('listableWorkspaces', () => {
  const app: AgentProject = { id: 'a', canonical: '/home/ryu/Work/app', name: 'app' };
  const gone: AgentProject = {
    id: 'b',
    canonical: '/home/ryu/throwaway',
    name: 'throwaway',
    missing: true,
  };
  const here: AgentProject = {
    id: 'c',
    canonical: '/home/ryu/Work/website',
    name: 'website',
    missing: true,
  };

  test('a workspace the host says is gone is not offered', () => {
    expect(listableWorkspaces([app, gone]).map((project) => project.id)).toEqual(['a']);
  });

  test('the workspace the reader is standing in stays, and says so', () => {
    expect(listableWorkspaces([app, gone, here], '/home/ryu/Work/website')).toEqual([app, here]);
    expect(workspaceProjectMissing(here)).toBe(true);
    expect(workspaceProjectMissing(app)).toBe(false);
  });

  test('a gateway that never sends the field lists everything it did before', () => {
    // Absent is present: this is every gateway shipped so far, and the whole
    // list has to survive the field arriving later.
    expect(listableWorkspaces([app, { ...gone, missing: undefined }])).toHaveLength(2);
    expect(listableWorkspaces([])).toEqual([]);
  });

  test('a trailing slash is the same folder, not another one', () => {
    expect(listableWorkspaces([here], '/home/ryu/Work/website/')).toEqual([here]);
  });
});
