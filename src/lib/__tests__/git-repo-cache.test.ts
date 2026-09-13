/**
 * The rule that keeps the diff entry point from flickering: start hidden, never
 * hide once shown for this cwd. Everything else here is bookkeeping around it.
 */
import { beforeEach, describe, expect, test } from 'bun:test';

import {
  GIT_REPO_CACHE_LIMIT,
  clearGitRepoCache,
  gitRepoCacheSize,
  mergeRepoEntry,
  readGitRepo,
  recordGitRepo,
  repoEntryFromContext,
  type GitRepoEntry,
} from '../git-repo-cache';
import { paneContextFromResponse } from '../git-diff';

const NOW = 1_800_000_000_000;

function entry(patch: Partial<GitRepoEntry> = {}): GitRepoEntry {
  return { available: true, changedFiles: 3, branch: 'feat/x', atMs: NOW, ...patch };
}

beforeEach(() => {
  clearGitRepoCache();
});

describe('repoEntryFromContext', () => {
  test('a pane in a checkout is available, with its count and branch', () => {
    const context = paneContextFromResponse({
      data: { git: { toplevel: '/p', branch: 'feat/git-diff', changed_files: 7 } },
    });
    expect(repoEntryFromContext(context, NOW)).toEqual({
      available: true,
      changedFiles: 7,
      branch: 'feat/git-diff',
      atMs: NOW,
    });
  });

  test('a pane that is not in a checkout is simply not available', () => {
    const context = paneContextFromResponse({ data: { cwd: '/home/x', git: null } });
    expect(repoEntryFromContext(context, NOW)).toMatchObject({
      available: false,
      changedFiles: 0,
      branch: null,
    });
  });
});

describe('mergeRepoEntry', () => {
  test('the first answer for a directory is taken as it is', () => {
    expect(mergeRepoEntry(undefined, entry({ available: false }))).toMatchObject({
      available: false,
    });
  });

  test('a directory shown to be a repository is never hidden again', () => {
    const merged = mergeRepoEntry(entry(), entry({ available: false, changedFiles: 0, atMs: 1 }));
    expect(merged).toEqual({ available: true, changedFiles: 3, branch: 'feat/x', atMs: 1 });
  });

  test('but a newer count and branch for a repository are believed in full', () => {
    const merged = mergeRepoEntry(entry(), entry({ changedFiles: 11, branch: 'main', atMs: 9 }));
    expect(merged).toEqual({ available: true, changedFiles: 11, branch: 'main', atMs: 9 });
  });

  test('a directory that was never a repository can become one', () => {
    const merged = mergeRepoEntry(entry({ available: false, changedFiles: 0 }), entry());
    expect(merged).toMatchObject({ available: true, changedFiles: 3 });
  });

  test('zero changed files is an answer, not an absence', () => {
    const merged = mergeRepoEntry(entry(), entry({ changedFiles: 0 }));
    expect(merged.changedFiles).toBe(0);
    expect(merged.available).toBe(true);
  });
});

describe('the cache', () => {
  test('an unseen directory is unknown, which is what draws nothing', () => {
    expect(readGitRepo('/p')).toBeUndefined();
    expect(readGitRepo('')).toBeUndefined();
    expect(readGitRepo(null)).toBeUndefined();
  });

  test('records by directory, so two panes in one repository share an answer', () => {
    recordGitRepo('/p', entry());
    expect(readGitRepo('/p')).toMatchObject({ available: true, changedFiles: 3 });
    expect(readGitRepo('/p/src')).toBeUndefined();
  });

  test('recording applies the never-hide rule and answers with what is now known', () => {
    recordGitRepo('/p', entry());
    const merged = recordGitRepo('/p', entry({ available: false }));
    expect(merged.available).toBe(true);
    expect(readGitRepo('/p')?.available).toBe(true);
  });

  test('clearing is total: the next gateway is a different machine', () => {
    recordGitRepo('/p', entry());
    clearGitRepoCache();
    expect(readGitRepo('/p')).toBeUndefined();
    expect(gitRepoCacheSize()).toBe(0);
  });

  test('the map is bounded, and the least recently answered falls out', () => {
    for (let index = 0; index < GIT_REPO_CACHE_LIMIT + 5; index += 1) {
      recordGitRepo(`/p/${index}`, entry());
    }
    expect(gitRepoCacheSize()).toBe(GIT_REPO_CACHE_LIMIT);
    expect(readGitRepo('/p/0')).toBeUndefined();
    expect(readGitRepo(`/p/${GIT_REPO_CACHE_LIMIT + 4}`)).toBeDefined();
  });

  test('answering again keeps a directory alive against eviction', () => {
    recordGitRepo('/p/keep', entry());
    for (let index = 0; index < GIT_REPO_CACHE_LIMIT - 1; index += 1) {
      recordGitRepo(`/p/${index}`, entry());
      recordGitRepo('/p/keep', entry());
    }
    recordGitRepo('/p/last', entry());
    expect(readGitRepo('/p/keep')).toBeDefined();
  });
});
