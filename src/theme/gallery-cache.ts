import type { ThemeIndexEntry } from '@/theme/gallery';

/**
 * The catalogue, held for an hour, in memory only.
 *
 * Why time and not a validator: the transport cannot revalidate.
 * `ThemeTransportResponse` is `{ status, location?, contentType?, bytes }` and
 * `transport-bridge.ts` rejects anything else, and `get(requestId, url,
 * maxBytes)` takes no headers -- so there is no `ETag` to read and no
 * `If-None-Match` to send without bumping the native contract version and
 * changing both native modules. That is a larger change than this screen and
 * is a card of its own.
 *
 * Why in memory and not MMKV: the index is bounded at 512 KiB, MMKV is
 * memory-mapped and sized for small values, and a catalogue is not useful
 * offline anyway -- every row in it needs the network the moment it is
 * pressed. A launch is also the one moment where re-reading is obviously
 * right. What the design actually asks for is that *reopening the sheet* does
 * not pay twice, and a module-level cache is exactly that and nothing more.
 *
 * One hour is the round number between "a reader who opens this twice in a
 * session should not wait twice" and "a theme merged this morning shows up
 * today". There is no data behind it.
 */
export const THEME_INDEX_MAX_AGE_MS = 60 * 60 * 1000;

let cached: { entries: ThemeIndexEntry[]; fetchedAt: number } | null = null;

/** The held catalogue, or `null` when there is none or it has aged out. */
export function cachedThemeIndex(now = Date.now()): ThemeIndexEntry[] | null {
  if (!cached) return null;
  // A clock that has gone backwards -- a manual change, a timezone database
  // update -- must not pin a stale index forever, so the age is absolute.
  if (Math.abs(now - cached.fetchedAt) >= THEME_INDEX_MAX_AGE_MS) return null;
  return cached.entries;
}

export function putThemeIndex(entries: ThemeIndexEntry[], now = Date.now()): void {
  cached = { entries, fetchedAt: now };
}

/** What `Try again` calls, and the only thing that bypasses the age. */
export function clearThemeIndex(): void {
  cached = null;
}
