import { expect, test } from 'bun:test';

import { normalizeThemeLink } from '@/theme/link-normalize';

test('a missing scheme becomes https rather than a raw URL TypeError', () => {
  expect(normalizeThemeLink('github.com/user/repo')).toEqual({
    url: 'https://github.com/user/repo',
  });
});

test("GitHub's own copy-link query carries no repository identity and is dropped", () => {
  expect(normalizeThemeLink('https://github.com/user/repo?tab=readme-ov-file')).toEqual({
    url: 'https://github.com/user/repo',
  });
});

test('a branch blob link fills the branch and file fields instead of dead-ending', () => {
  expect(normalizeThemeLink('https://github.com/user/repo/blob/main/theme.json')).toEqual({
    url: 'https://github.com/user/repo',
    revision: 'main',
    manifestPath: 'theme.json',
    branchFromLink: true,
  });
});

test('a nested blob path keeps its full path', () => {
  expect(normalizeThemeLink('https://github.com/user/repo/blob/dev/themes/a/theme.json')).toEqual({
    url: 'https://github.com/user/repo',
    revision: 'dev',
    manifestPath: 'themes/a/theme.json',
    branchFromLink: true,
  });
});

test('a tree link proposes theme.json inside the directory it names', () => {
  expect(normalizeThemeLink('https://github.com/user/repo/tree/main/themes/a')).toEqual({
    url: 'https://github.com/user/repo',
    revision: 'main',
    manifestPath: 'themes/a/theme.json',
    branchFromLink: true,
  });
});

test('a tree link at the repository root proposes no path of its own', () => {
  expect(normalizeThemeLink('https://github.com/user/repo/tree/main')).toEqual({
    url: 'https://github.com/user/repo',
    revision: 'main',
    manifestPath: undefined,
    branchFromLink: true,
  });
});

test('an already pinned commit link is left for the parser to handle as it stands', () => {
  const commit = 'a'.repeat(40);
  expect(normalizeThemeLink(`https://github.com/user/repo/blob/${commit}/theme.json`)).toEqual({
    url: `https://github.com/user/repo/blob/${commit}/theme.json`,
  });
});

test('a non-GitHub link keeps its query, which may be how the file is served', () => {
  expect(normalizeThemeLink('https://example.com/a.muqun-theme?dl=1')).toEqual({
    url: 'https://example.com/a.muqun-theme?dl=1',
  });
});

test('unparseable input is handed through untouched so the parser reports it', () => {
  expect(normalizeThemeLink('not a url at all')).toEqual({ url: 'not a url at all' });
});

test('empty input stays empty', () => {
  expect(normalizeThemeLink('   ')).toEqual({ url: '' });
});

test('normalizing never invents a revision for a plain repository URL', () => {
  const link = normalizeThemeLink('https://github.com/user/repo/');
  expect(link.revision).toBeUndefined();
  expect(link.branchFromLink).toBeUndefined();
  expect(link.url).toBe('https://github.com/user/repo');
});
