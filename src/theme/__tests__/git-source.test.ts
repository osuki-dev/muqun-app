import { expect, test } from 'bun:test';
import {
  parseGitThemeRequest,
  resolveGitThemeReview,
  confirmGitThemeReview,
  type GitThemeRevisionResolver,
} from '../git-source';

const commit = 'a'.repeat(40);
const repo = 'https://github.com/example/theme';
const resolver: GitThemeRevisionResolver = { resolve: async () => ({ repository: repo, commit }) };

test('repository URL proposes a visible root manifest and resolves default branch once', async () => {
  const request = parseGitThemeRequest(' https://github.com/Example/Theme.git/ ');
  expect(request).toEqual({
    provider: 'github',
    repository: repo,
    revision: null,
    manifestPath: 'theme.json',
  });
  let calls = 0;
  const review = await resolveGitThemeReview(request, {
    resolve: async () => {
      calls++;
      return { repository: repo, commit };
    },
  });
  expect(confirmGitThemeReview(review, request)).toEqual({
    repository: repo,
    commit,
    manifestPath: 'theme.json',
  });
  expect(calls).toBe(1);
  expect(Object.isFrozen(review.source)).toBe(true);
});

test('pinned blob and directory links preserve the exact commit and path', async () => {
  const request = parseGitThemeRequest(`${repo}/blob/${commit}/themes/cute.json`);
  expect(request.manifestPath).toBe('themes/cute.json');
  expect(request.revision).toBe(commit);
  const review = await resolveGitThemeReview(request, {
    resolve: async () => {
      throw new Error('Must not resolve a pinned commit');
    },
  });
  expect(review.source.commit).toBe(commit);
  expect(parseGitThemeRequest(`${repo}/tree/${commit}/themes/cute`).manifestPath).toBe(
    'themes/cute/theme.json'
  );
  expect(() =>
    parseGitThemeRequest(`${repo}/blob/${commit}/theme.json`, { revision: 'main' })
  ).toThrow('conflicting-source');
});

test('slash-containing refs use separate fields rather than ambiguous URL guessing', () => {
  expect(
    parseGitThemeRequest(repo, {
      revision: 'feature/cute-theme',
      manifestPath: 'themes/cute/theme.json',
    }).revision
  ).toBe('feature/cute-theme');
  expect(() => parseGitThemeRequest(`${repo}/blob/feature/cute-theme/theme.json`)).toThrow(
    'ambiguous-link'
  );
  for (const revision of [
    'main~1',
    'HEAD:path',
    '--all',
    '../main',
    'a//b',
    'a@{0}',
    'x.lock',
    'a b',
  ])
    expect(() => parseGitThemeRequest(repo, { revision })).toThrow('invalid-revision');
});

test('rejects credentials, alternate hosts, redirects-in-URLs and normalized traversal', () => {
  for (const value of [
    'http://github.com/example/theme',
    'https://user:pass@github.com/example/theme',
    'https://github.com.evil.org/example/theme',
    'https://127.0.0.1/example/theme',
    `${repo}?next=https://evil.org`,
    `${repo}#x`,
    `${repo}/../other`,
    `${repo}/blob/${commit}/%2e%2e/x`,
    'file:///tmp/repo',
  ])
    expect(() => parseGitThemeRequest(value)).toThrow();
  expect(() => parseGitThemeRequest('https://gitlab.com/example/theme')).toThrow(
    'unsupported-provider'
  );
  expect(() => parseGitThemeRequest(repo, { manifestPath: '../theme.json' })).toThrow();
});

test('metadata must pin a full commit from the same repository', async () => {
  const request = parseGitThemeRequest(repo);
  await expect(
    resolveGitThemeReview(request, {
      resolve: async () => ({ repository: 'https://github.com/other/theme', commit }),
    })
  ).rejects.toThrow('repository-mismatch');
  await expect(
    resolveGitThemeReview(request, { resolve: async () => ({ repository: repo, commit: 'main' }) })
  ).rejects.toThrow('full commit');
});

test('confirmation rejects edited sources and retains the reviewed commit after a branch moves', async () => {
  const request = parseGitThemeRequest(repo, { revision: 'main' });
  const review = await resolveGitThemeReview(request, resolver);
  for (const current of [
    parseGitThemeRequest(repo, { revision: 'other' }),
    parseGitThemeRequest(repo, { revision: 'main', manifestPath: 'other.json' }),
    parseGitThemeRequest('https://github.com/other/theme', { revision: 'main' }),
  ])
    expect(() => confirmGitThemeReview(review, current)).toThrow('stale-review');
  expect(confirmGitThemeReview(review, request).commit).toBe(commit);
});

test('cancellation before and after metadata prevents a review', async () => {
  const controller = new AbortController();
  controller.abort(new Error('Canceled'));
  await expect(
    resolveGitThemeReview(parseGitThemeRequest(repo), resolver, { signal: controller.signal })
  ).rejects.toThrow('Canceled');
  const active = new AbortController();
  await expect(
    resolveGitThemeReview(
      parseGitThemeRequest(repo),
      {
        resolve: async () => {
          active.abort(new Error('Canceled during metadata'));
          return { repository: repo, commit };
        },
      },
      { signal: active.signal }
    )
  ).rejects.toThrow('Canceled during metadata');
});
