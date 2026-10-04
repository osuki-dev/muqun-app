import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import {
  descendQuery,
  isHomeRelativePath,
  MAX_DIRECTORY_SUGGESTIONS,
  narrowLegacyListing,
  parseDirectoryListing,
  settledWorkspaceDirectory,
  shouldSuggestDirectories,
  visibleSuggestions,
} from '@/lib/agent-directory-suggest';

const folders = (n: number, root = '/home/u') =>
  Array.from({ length: n }, (_, i) => ({ name: `d${i}`, path: `${root}/d${i}` }));

describe('which queries ask the completer', () => {
  test('absolute and home-relative paths do, names do not', () => {
    expect(shouldSuggestDirectories('/Users')).toBe(true);
    expect(shouldSuggestDirectories('  ~/W ')).toBe(true);
    expect(shouldSuggestDirectories('~')).toBe(true);
    expect(shouldSuggestDirectories('muqun')).toBe(false);
    expect(shouldSuggestDirectories('')).toBe(false);
  });

  test('the sheet gates its fetch on that, keeps the debounce, and drops stale answers', () => {
    const sheet = readFileSync('src/components/agent-workspace-sheet.tsx', 'utf8');
    expect(sheet).toContain('if (!shouldSuggestDirectories(query))');
    expect(sheet).not.toContain("startsWith('/')) {");
    expect(sheet).toContain('}, 150);');
    expect(sheet).toContain('active && currentQueryRef.current === query');
  });
});

describe('both gateways answer', () => {
  test('an older gateway: a bare array, no home', () => {
    const listing = parseDirectoryListing([{ name: 'Work', path: '/home/u/Work' }]);
    expect(listing).toEqual({
      directories: [{ name: 'Work', path: '/home/u/Work' }],
      truncated: false,
      legacy: true,
    });
  });

  test('a newer gateway: the array as data, home and truncated beside it', () => {
    const data = [{ name: 'Work', path: '/home/u/Work' }];
    const listing = parseDirectoryListing(data, {
      schema_version: 1,
      data,
      home: '/home/u',
      truncated: false,
    });
    expect(listing).toEqual({
      directories: data,
      home: '/home/u',
      truncated: false,
      legacy: false,
    });
    expect(parseDirectoryListing(data, { data, truncated: true })).toEqual({
      directories: data,
      truncated: true,
      legacy: false,
    });
  });

  test('an older gateway inside an envelope is still the older gateway', () => {
    const data = [{ name: 'Work', path: '/home/u/Work' }];
    expect(parseDirectoryListing(data, { schema_version: 1, data }).legacy).toBe(true);
  });

  test('an object data with directories, home and truncated', () => {
    const listing = parseDirectoryListing({
      directories: [{ name: 'Work', path: '/home/u/Work' }, { name: 'bad' }],
      home: '/home/u',
      truncated: true,
    });
    expect(listing).toEqual({
      directories: [{ name: 'Work', path: '/home/u/Work' }],
      home: '/home/u',
      truncated: true,
      legacy: false,
    });
  });

  test('anything else is no folders', () => {
    expect(parseDirectoryListing(null).directories).toEqual([]);
    expect(parseDirectoryListing('x').directories).toEqual([]);
  });

  test("the older gateway's whole parent is narrowed to the typed segment", () => {
    const listing = parseDirectoryListing([
      { name: 'Work', path: '/home/u/Work' },
      { name: 'web', path: '/home/u/web' },
      { name: 'Music', path: '/home/u/Music' },
      { name: '.wine', path: '/home/u/.wine' },
    ]);
    expect(narrowLegacyListing(listing, '~/w').directories.map((d) => d.name)).toEqual([
      'Work',
      'web',
    ]);
    expect(narrowLegacyListing(listing, '~/.w').directories.map((d) => d.name)).toEqual(['.wine']);
    expect(narrowLegacyListing(listing, '~/').directories).toHaveLength(3);
  });

  test("a newer gateway's answer is its own and is not narrowed again", () => {
    const listing = parseDirectoryListing({ directories: folders(3), home: '/home/u' });
    expect(narrowLegacyListing(listing, '~/zzz')).toBe(listing);
  });
});

describe('at most twenty rows', () => {
  test('twenty drawn, and the caption when there were more', () => {
    const { rows, more } = visibleSuggestions(parseDirectoryListing(folders(30)));
    expect(MAX_DIRECTORY_SUGGESTIONS).toBe(20);
    expect(rows).toHaveLength(20);
    expect(more).toBe(true);
  });

  test('the caption when the gateway says it stopped short', () => {
    const answer = parseDirectoryListing({ directories: folders(5), truncated: true });
    expect(visibleSuggestions(answer)).toEqual({ rows: answer.directories, more: true });
  });

  test('no caption for a short, complete answer', () => {
    expect(visibleSuggestions(parseDirectoryListing(folders(20))).more).toBe(false);
  });

  test('the sheet draws the capped rows and the caption', () => {
    const sheet = readFileSync('src/components/agent-workspace-sheet.tsx', 'utf8');
    expect(sheet).toContain('visibleSuggestions(listing)');
    expect(sheet).toContain('{moreSuggestions ? (');
    expect(sheet).toContain('t`Keep typing to narrow down`');
  });
});

describe('going into a folder', () => {
  test('spelled from ~ when the gateway said where home is', () => {
    expect(descendQuery('/home/u/Work', '/home/u')).toBe('~/Work/');
    expect(descendQuery('/home/u/Work/muqun', '/home/u/')).toBe('~/Work/muqun/');
    expect(descendQuery('/home/u', '/home/u')).toBe('~/');
  });

  test('absolute without a home, or outside it', () => {
    expect(descendQuery('/home/u/Work')).toBe('/home/u/Work/');
    expect(descendQuery('/home/user2/x', '/home/u')).toBe('/home/user2/x/');
    expect(descendQuery('/opt/', '/home/u')).toBe('/opt/');
  });

  test('the row opens, the trailing action descends', () => {
    const sheet = readFileSync('src/components/agent-workspace-sheet.tsx', 'utf8');
    expect(sheet).toContain('onPress={() => choose(item.path)}');
    expect(sheet).toContain('accessibilityLabel={t`Go into ${folder}`}');
    expect(sheet).toContain(
      'onPress={() => setSearchQuery(descendQuery(item.path, listing.home))}'
    );
  });
});

describe('a typed ~ path is not the workspace', () => {
  test("the gateway's canonical folder replaces the typed spelling", () => {
    expect(settledWorkspaceDirectory('~/Work/muqun/themes', '/Users/otaku/Work/muqun/themes')).toBe(
      '/Users/otaku/Work/muqun/themes'
    );
    expect(settledWorkspaceDirectory('/abs', undefined)).toBe('/abs');
    expect(settledWorkspaceDirectory('/abs', '')).toBe('/abs');
  });

  test('which spellings need expanding', () => {
    expect(isHomeRelativePath('~')).toBe(true);
    expect(isHomeRelativePath('~/Work')).toBe(true);
    expect(isHomeRelativePath('~bob')).toBe(false);
    expect(isHomeRelativePath('/home')).toBe(false);
  });

  test('the workbench applies the answer, and a refusal puts the old folder back', () => {
    const bench = readFileSync('src/components/agent-workbench.tsx', 'utf8');
    expect(bench).toContain('settledWorkspaceDirectory(directory, target.directory)');
    expect(bench).toContain('if (typedHome && activeDirectoryRef.current === directory) {');
    expect(bench).toContain('setActiveDirectory(previousDirectory);');
    expect(bench).toContain("agentRequestErrorDetail(err).code === 'invalid_directory'");
  });
});
