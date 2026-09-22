import type { ThemeIndexEntry } from './gallery';

/**
 * Filter theme index entries by query substring across id, name, author, description, and tags.
 * Follows the search behavior of `website`'s themes-gallery and `muqun-theme list --search`.
 */
export function filterThemeEntries(
  entries: readonly ThemeIndexEntry[],
  query: string
): ThemeIndexEntry[] {
  const needle = query.trim().replace(/^#/, '').toLowerCase();
  if (!needle) return [...entries];

  return entries.filter((entry) => {
    const fields = [
      entry.id,
      entry.name,
      entry.author,
      entry.description,
      ...(entry.tags ?? []),
    ];
    return fields
      .filter((part): part is string => typeof part === 'string')
      .some((part) => part.toLowerCase().includes(needle));
  });
}

/**
 * Extract popular theme tags ordered by frequency from the theme catalogue.
 */
export function collectPopularThemeTags(
  entries: readonly ThemeIndexEntry[],
  limit = 12
): string[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    if (entry.tags) {
      for (const tag of entry.tags) {
        const normalized = tag.trim().toLowerCase();
        if (normalized) {
          counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
        }
      }
    }
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([tag]) => tag);
}
