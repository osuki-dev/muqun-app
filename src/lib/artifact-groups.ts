/**
 * Turning a flat asset listing into the day-headed rows the files sheet shows.
 *
 * Kept out of the component, the same way `session-assets` is kept out of
 * `gateway-client`: the part that decides which heading a file lands under is
 * the part worth testing, and it should not need React Native to run.
 */

import type { SessionAsset } from '@/lib/session-assets';

/** A row, or the day heading above it. Flattened so one list renders both. */
export type ArtifactRow =
  | { type: 'heading'; key: string; label: string; count: number }
  | { type: 'asset'; key: string; asset: SessionAsset };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The heading for files whose modification time is not a time.
 *
 * A heading of its own rather than folding them into today's: the list is a
 * chronology, and a file with no date in it is not evidence about when anything
 * happened.
 */
const UNKNOWN_DAY = 'Unknown date';

/**
 * The day a file was written, named the way a person would say it.
 *
 * Measured against local midnight rather than by subtracting 24 hours: a file
 * written at 23:50 yesterday is "Yesterday" when read at 10:00 today, even
 * though it is less than a day old.
 */
export function dayLabel(modifiedMs: number, now: number): string {
  // A gateway that sent no mtime, a corrupt one, or a clock the device cannot
  // read arrives here as NaN or Infinity. Every comparison below is false for
  // those, so without this they fall through to `toLocaleDateString` on an
  // Invalid Date -- which is a RangeError from the Intl formatter, thrown while
  // rendering the files sheet.
  if (!Number.isFinite(modifiedMs) || !Number.isFinite(now)) return UNKNOWN_DAY;
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const midnight = startOfToday.getTime();
  const modified = new Date(modifiedMs);

  if (modifiedMs >= midnight) return 'Today';
  if (modifiedMs >= midnight - DAY_MS) return 'Yesterday';
  if (modifiedMs >= midnight - 6 * DAY_MS) {
    return modified.toLocaleDateString(undefined, { weekday: 'long' });
  }
  if (modified.getFullYear() === new Date(now).getFullYear()) {
    return modified.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
  }
  return modified.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Assets -- already newest first, which the listing guarantees -- into rows.
 *
 * The incoming order is preserved rather than re-sorted: "what did it just
 * make" is the question this list answers, and the grouping only names the runs
 * that order already has.
 *
 * Pass the previous result to keep unchanged rows: every row whose content is
 * the same comes back as the *same object*, so a memoized row skips its render.
 * That is not decoration, it is what makes the two things this list does often
 * cheap. A keystroke in the search field rebuilds the rows from assets already
 * in hand, and a page of older files re-reads the whole window from the gateway
 * -- there is no cursor on the assets endpoint, so "more" is a wider `limit` and
 * the listing arrives again with more of it, exactly the way the transcript
 * does. Without this, both of those re-render every row on screen.
 */
export function groupByDay(
  assets: SessionAsset[],
  now: number,
  previous?: readonly ArtifactRow[]
): ArtifactRow[] {
  const reusable = indexByKey(previous);
  const rows: ArtifactRow[] = [];
  const runsPerLabel = new Map<string, number>();
  let currentLabel: string | null = null;
  let headingIndex = -1;

  for (const asset of assets) {
    const label = dayLabel(asset.modified_unix_ms, now);
    if (label !== currentLabel) {
      currentLabel = label;
      headingIndex = rows.length;
      rows.push({ type: 'heading', key: headingKey(runsPerLabel, label), label, count: 0 });
    }
    const heading = rows[headingIndex];
    if (heading.type === 'heading') heading.count += 1;
    rows.push(reuseAsset(reusable, { type: 'asset', key: asset.id, asset }));
  }

  // The headings are counted while walking, so they can only be compared once
  // the walk is over: a heading is not the same row until its tally is final.
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.type !== 'heading') continue;
    const before = reusable.get(row.key);
    if (before?.type === 'heading' && before.label === row.label && before.count === row.count) {
      rows[index] = before;
    }
  }

  return rows;
}

/**
 * A key for the heading above a run of files, unique even when a day is named
 * twice.
 *
 * A well-formed listing names each day once -- it arrives newest first, so a
 * day is one contiguous run -- and for that listing this returns exactly what
 * it always did, which is what keeps the headings' identity across a rebuild.
 * The second run of a day is the pathological case, and it is reachable: a file
 * the gateway could not date is grouped under "Unknown date", and a comparator
 * fed a NaN leaves those entries wherever they happened to be, so two of them
 * can arrive with dated files between.
 *
 * That used to cost a duplicate React key and a console warning. It costs more
 * now: a virtualized list positions rows by key, and Legend List answers a
 * repeated one with "missing items and gaps and other terrible things" -- which
 * on a full-size listing is a sheet that draws blank, rows laid out thousands
 * of points below the fold. Found exactly that way, on a two-hundred-file
 * listing whose days interleaved.
 */
function headingKey(runsPerLabel: Map<string, number>, label: string): string {
  const seen = (runsPerLabel.get(label) ?? 0) + 1;
  runsPerLabel.set(label, seen);
  return seen === 1 ? `day:${label}` : `day:${label}#${seen}`;
}

function indexByKey(rows: readonly ArtifactRow[] | undefined): Map<string, ArtifactRow> {
  const map = new Map<string, ArtifactRow>();
  if (!rows) return map;
  // By key rather than by position, so a wider window -- which pushes nothing
  // down but does re-read everything above it -- still reuses what was on
  // screen, and so does a search that removes rows from the middle.
  for (const row of rows) map.set(row.key, row);
  return map;
}

function reuseAsset(
  reusable: Map<string, ArtifactRow>,
  row: Extract<ArtifactRow, { type: 'asset' }>
): ArtifactRow {
  const before = reusable.get(row.key);
  return before?.type === 'asset' && sameAsset(before.asset, row.asset) ? before : row;
}

/**
 * Whether two listings describe the same file in the same state.
 *
 * Compared field by field rather than by identity, because identity is exactly
 * what a re-read does not preserve: every listing is freshly parsed JSON, so
 * the objects are always new even when the file has not been touched. Every
 * field the row or the viewer reads is compared -- a file that was rewritten
 * has a new size or mtime, and the row shows both.
 */
function sameAsset(previous: SessionAsset, next: SessionAsset): boolean {
  return (
    previous.id === next.id &&
    previous.path === next.path &&
    previous.name === next.name &&
    previous.kind === next.kind &&
    previous.mime === next.mime &&
    previous.size === next.size &&
    previous.modified_unix_ms === next.modified_unix_ms &&
    previous.previewable === next.previewable &&
    previous.origin?.session_id === next.origin?.session_id &&
    previous.origin?.pane_id === next.origin?.pane_id &&
    previous.origin?.workspace_id === next.origin?.workspace_id
  );
}
