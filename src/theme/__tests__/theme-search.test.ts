import { expect, test } from 'bun:test';
import { collectPopularThemeTags, filterThemeEntries } from '../theme-search';
import type { ThemeIndexEntry } from '../gallery';

const sampleEntries: ThemeIndexEntry[] = [
  {
    id: 'urban-sentinel',
    name: 'Urban Sentinel',
    version: '2.0.0',
    author: 'Muqun Design',
    description: 'High-contrast nocturnal surveillance palette.',
    tags: ['cyberpunk', 'terminal', 'dark'],
    package: 'dist/urban-sentinel.muqun-theme',
    bytes: 1200000,
  },
  {
    id: 'akiba-overdrive',
    name: 'Akiba Overdrive',
    version: '2.0.0',
    author: 'osuki',
    description: 'Electric Tokyo night market and anime glow.',
    tags: ['anime', 'cyberpunk', 'japan'],
    package: 'dist/akiba-overdrive.muqun-theme',
    bytes: 2400000,
  },
  {
    id: 'nordic-paper',
    name: 'Nordic Paper',
    version: '1.0.0',
    author: 'Muqun Design',
    description: 'Clean Scandinavian paperlight typography.',
    tags: ['minimal', 'light'],
    package: 'dist/nordic-paper.muqun-theme',
    bytes: 900000,
  },
];

test('filterThemeEntries returns all entries for empty query', () => {
  expect(filterThemeEntries(sampleEntries, '')).toEqual(sampleEntries);
  expect(filterThemeEntries(sampleEntries, '   ')).toEqual(sampleEntries);
});

test('filterThemeEntries searches by name case-insensitively', () => {
  const result = filterThemeEntries(sampleEntries, 'akiba');
  expect(result.map((e) => e.id)).toEqual(['akiba-overdrive']);
});

test('filterThemeEntries searches by tag with or without leading hash', () => {
  const byTag = filterThemeEntries(sampleEntries, 'cyberpunk');
  expect(byTag.map((e) => e.id)).toEqual(['urban-sentinel', 'akiba-overdrive']);

  const byHashTag = filterThemeEntries(sampleEntries, '#cyberpunk');
  expect(byHashTag.map((e) => e.id)).toEqual(['urban-sentinel', 'akiba-overdrive']);
});

test('filterThemeEntries searches by author', () => {
  const result = filterThemeEntries(sampleEntries, 'osuki');
  expect(result.map((e) => e.id)).toEqual(['akiba-overdrive']);
});

test('filterThemeEntries searches by description', () => {
  const result = filterThemeEntries(sampleEntries, 'surveillance');
  expect(result.map((e) => e.id)).toEqual(['urban-sentinel']);
});

test('filterThemeEntries returns empty array when no theme matches', () => {
  const result = filterThemeEntries(sampleEntries, 'nonexistent-theme-query');
  expect(result).toEqual([]);
});

test('collectPopularThemeTags counts frequencies and sorts descending', () => {
  const tags = collectPopularThemeTags(sampleEntries);
  // 'cyberpunk' appears in 2 themes, others in 1
  expect(tags[0]).toBe('cyberpunk');
  expect(tags).toContain('anime');
  expect(tags).toContain('terminal');
  expect(tags).toContain('minimal');
});

test('collectPopularThemeTags respects limit', () => {
  const tags = collectPopularThemeTags(sampleEntries, 2);
  expect(tags).toHaveLength(2);
  expect(tags[0]).toBe('cyberpunk');
});
