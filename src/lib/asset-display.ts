/**
 * Presentation helpers shared by the Artifacts list and the asset viewer, so a
 * file reads the same in both places.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export type RelativeTimeParts = {
  unit: 'none' | 'now' | 'minute' | 'hour' | 'day' | 'date';
  /** The count for minute/hour/day, the timestamp itself for `date`. */
  value: number;
};

/**
 * How long ago something was written, as a bucket and a count: the wording
 * belongs to `useRelativeTime`, which says it in the active locale. `now` is a
 * parameter so the result is testable and does not depend on the clock at
 * render time.
 */
export function relativeTimeParts(unixMs: number, now = Date.now()): RelativeTimeParts {
  if (!Number.isFinite(unixMs) || unixMs <= 0) return { unit: 'none', value: 0 };
  const elapsed = now - unixMs;
  // A file written by a machine whose clock runs ahead is "just now", not "in
  // 3 minutes": the app has nothing useful to say about the future.
  if (elapsed < MINUTE_MS) return { unit: 'now', value: 0 };
  if (elapsed < HOUR_MS) return { unit: 'minute', value: Math.floor(elapsed / MINUTE_MS) };
  if (elapsed < DAY_MS) return { unit: 'hour', value: Math.floor(elapsed / HOUR_MS) };
  if (elapsed < 7 * DAY_MS) return { unit: 'day', value: Math.floor(elapsed / DAY_MS) };
  return { unit: 'date', value: unixMs };
}

/** Byte counts at one decimal, which is as precise as a list row needs. */
export function formatAssetSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
