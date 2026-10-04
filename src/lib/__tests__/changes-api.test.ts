import { describe, expect, test } from 'bun:test';

import { gatewaySupportsPaneVcsFiles, type AgentVcsFiles } from '../agent-protocol';
import { buildChangeTree, changeTreeRows } from '../change-tree';
import {
  agentChangesApi,
  listingFromGitStatus,
  paneChangesApi,
  type AgentChangesClient,
  type PaneChangesClient,
} from '../changes-api';
import { DIFF_CONTEXT_LINES, FILE_PATCH_MAX_LINES, gitStatusFromResponse } from '../git-diff';

type Call = [string, ...unknown[]];

const FILES: AgentVcsFiles = {
  files: [
    { path: 'src/a.ts', status: 'modified', additions: 2, deletions: 1, binary: false },
    { path: 'notes.txt', status: 'untracked', additions: 1, deletions: 0, binary: false },
  ],
  mode: 'working',
  base: 'origin/main',
  truncated: false,
  vcs: 'git',
};

function agentClient(files: AgentVcsFiles | null, calls: Call[]): AgentChangesClient {
  return {
    files: async (...args) => {
      calls.push(['files', ...args]);
      return files;
    },
    file: async (...args) => {
      calls.push(['file', ...args]);
      return {
        path: args[2].path,
        status: 'unchanged',
        additions: 0,
        deletions: 0,
        binary: false,
        patch: '',
        truncated: false,
      };
    },
    discard: async (...args) => {
      calls.push(['discard', ...args]);
      return { path: args[2], action: 'restored' };
    },
    diff: async (...args) => {
      calls.push(['diff', ...args]);
      return {
        files: [{ path: 'src/a.ts', patch: '@@ -1 +1 @@\n-a\n+b\n', additions: 1, deletions: 1 }],
      };
    },
  };
}

function paneClient(files: AgentVcsFiles | null, calls: Call[]): PaneChangesClient {
  return {
    files: async (...args) => {
      calls.push(['files', ...args]);
      return files;
    },
    file: async (...args) => {
      calls.push(['file', ...args]);
      return {
        path: args[2].path,
        status: 'modified',
        additions: 1,
        deletions: 0,
        binary: false,
        patch: '@@ -1 +1,2 @@\n a\n+b\n',
        truncated: true,
      };
    },
    discard: async (...args) => {
      calls.push(['discard', ...args]);
      return { path: args[2], action: 'deleted' };
    },
    status: async (...args) => {
      calls.push(['status', args[0], args[1]]);
      return gitStatusFromResponse({
        session_id: 's',
        pane_id: '%1',
        repo: { toplevel: '/r', branch: 'main', head: 'abc' },
        truncated: false,
        files: [
          {
            path: 'plugins/platform/minigame/src/adapters/drizzle/player-repo-drizzle.ts',
            old_path: null,
            status: 'modified',
            staged: true,
            unstaged: true,
            binary: false,
            added: 4,
            removed: 2,
          },
          {
            path: 'README.md',
            status: 'untracked',
            staged: false,
            unstaged: true,
            binary: false,
            added: 1,
            removed: 0,
          },
        ],
      });
    },
    diff: async (...args) => {
      calls.push(['diff', args[0], args[1], args[2], args[3]]);
      return {
        path: args[2],
        binary: false,
        from: 0,
        end: 3,
        totalLines: 3,
        truncated: false,
        patch: '',
      };
    },
  };
}

describe('agentChangesApi', () => {
  test('lists through …/vcs/files, fetches one patch, and discards, all for this session', async () => {
    const calls: Call[] = [];
    const api = agentChangesApi(
      { sessionId: 'herdr', asid: 'ses_1', filesApi: true },
      agentClient(FILES, calls)
    );
    const listing = await api.listing('working');
    expect(listing.source).toBe('lazy');
    expect(listing.base).toBe('origin/main');
    expect(listing.changes.map((change) => [change.path, change.status])).toEqual([
      ['src/a.ts', 'modified'],
      ['notes.txt', 'untracked'],
    ]);
    const patch = await api.file({ mode: 'branch', path: 'src/a.ts', context: 10 });
    expect(patch.unchanged).toBe(true);
    await api.discard?.('notes.txt');
    expect(calls).toEqual([
      ['files', 'herdr', 'ses_1', 'working'],
      ['file', 'herdr', 'ses_1', { mode: 'branch', path: 'src/a.ts', context: 10 }],
      ['discard', 'herdr', 'ses_1', 'notes.txt'],
    ]);
  });

  test('falls back to …/vcs/diff when the route gives no answer, and offers no discard without the capability', async () => {
    const calls: Call[] = [];
    const withCapability = agentChangesApi(
      { sessionId: 's', asid: 'a', filesApi: true },
      agentClient(null, calls)
    );
    const listing = await withCapability.listing('working');
    expect(listing.source).toBe('eager');
    expect(listing.patches.get('src/a.ts')).toContain('+b');
    expect(calls.map((call) => call[0])).toEqual(['files', 'diff']);

    const older = agentChangesApi(
      { sessionId: 's', asid: 'a', filesApi: false },
      agentClient(FILES, calls)
    );
    calls.length = 0;
    await older.listing('working');
    expect(calls.map((call) => call[0])).toEqual(['diff']);
    expect(older.discard).toBeUndefined();
  });
});

describe('paneChangesApi', () => {
  test('lists through the pane …/vcs/files, fetches one patch, and discards, all for this pane', async () => {
    const calls: Call[] = [];
    const api = paneChangesApi(
      { sessionId: 'default', paneId: '%3', vcsFiles: true },
      paneClient(FILES, calls)
    );
    const listing = await api.listing('branch');
    expect(listing.source).toBe('lazy');
    const patch = await api.file({ mode: 'working', path: 'src/a.ts', context: 3 });
    expect(patch).toEqual({ patch: '@@ -1 +1,2 @@\n a\n+b\n', truncated: true, unchanged: false });
    expect(await api.discard?.('notes.txt')).toEqual({ path: 'notes.txt', action: 'deleted' });
    expect(calls).toEqual([
      ['files', 'default', '%3', 'branch'],
      ['file', 'default', '%3', { mode: 'working', path: 'src/a.ts', context: 3 }],
      ['discard', 'default', '%3', 'notes.txt'],
    ]);
  });

  test('without pane_vcs_files, git/status is the listing and git/diff pages each patch', async () => {
    const calls: Call[] = [];
    const api = paneChangesApi(
      { sessionId: 'default', paneId: '%3', vcsFiles: false },
      paneClient(FILES, calls)
    );
    expect(api.discard).toBeUndefined();
    const listing = await api.listing('working');
    expect(listing.source).toBe('paged');
    expect(listing.changes).toHaveLength(2);
    await api.page?.(listing.changes[0], 400);
    expect(calls).toEqual([
      ['status', 'default', '%3'],
      [
        'diff',
        'default',
        '%3',
        'plugins/platform/minigame/src/adapters/drizzle/player-repo-drizzle.ts',
        { from: 400, lines: FILE_PATCH_MAX_LINES, context: DIFF_CONTEXT_LINES, oldPath: null },
      ],
    ]);
  });

  test('a gateway whose …/vcs/files gives no answer falls back to git/status', async () => {
    const calls: Call[] = [];
    const api = paneChangesApi(
      { sessionId: 's', paneId: '%1', vcsFiles: true },
      paneClient(null, calls)
    );
    expect((await api.listing('working')).source).toBe('paged');
    expect(calls.map((call) => call[0])).toEqual(['files', 'status']);
    // `git/status` has no base to compare with: the sheet goes back to working.
    expect((await api.listing('branch')).reason).toBe('no_default_branch');
  });
});

describe('listingFromGitStatus', () => {
  test("maps the pane's status list into the same tree the agent sheet draws", () => {
    const status = gitStatusFromResponse({
      repo: { toplevel: '/r', branch: 'main', head: 'abc' },
      truncated: true,
      files: [
        { path: 'src/lib/a.ts', status: 'modified', added: 1, removed: 1 },
        { path: 'src/lib/b.ts', status: 'added', added: 3, removed: 0 },
        { path: 'README.md', status: 'untracked', added: 2, removed: 0 },
      ],
    });
    const listing = listingFromGitStatus(status);
    expect(listing.source).toBe('paged');
    expect(listing.truncated).toBe(true);
    expect(listing.reason).toBeUndefined();
    const rows = changeTreeRows({
      tree: buildChangeTree(listing.changes),
      collapsed: new Set(),
      expanded: new Set(),
      pages: new Map(),
    });
    expect(rows.map((row) => [row.type, 'name' in row ? row.name : row.key])).toEqual([
      ['dir', 'src/lib'],
      ['treeFile', 'a.ts'],
      ['treeFile', 'b.ts'],
      ['treeFile', 'README.md'],
    ]);
  });

  test('a pane outside a checkout is "not a git repository", not "no changes"', () => {
    const listing = listingFromGitStatus(
      gitStatusFromResponse({ repo: null, truncated: false, files: [] })
    );
    expect(listing.reason).toBe('not_a_repository');
  });
});

describe('gatewaySupportsPaneVcsFiles', () => {
  test('is the capability, and nothing else', () => {
    expect(gatewaySupportsPaneVcsFiles(['git_diff', 'pane_vcs_files'])).toBe(true);
    expect(gatewaySupportsPaneVcsFiles(['agent_vcs_files', 'git_diff'])).toBe(false);
    expect(gatewaySupportsPaneVcsFiles(undefined)).toBe(false);
  });
});
