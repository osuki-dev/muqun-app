import { describe, expect, it } from 'bun:test';

import { dayLabel, groupByDay } from '@/lib/artifact-groups';
import type { SessionAsset } from '@/lib/gateway-client';

/** Local noon, so a test never sits close enough to midnight to flip a label. */
function at(year: number, month: number, day: number, hour = 12, minute = 0): number {
  return new Date(year, month - 1, day, hour, minute).getTime();
}

function asset(id: string, modified: number, overrides: Partial<SessionAsset> = {}): SessionAsset {
  return {
    id,
    path: `~/code/${id}`,
    name: id,
    kind: 'text',
    mime: 'text/plain',
    size: 10,
    modified_unix_ms: modified,
    previewable: true,
    ...overrides,
  };
}

describe('dayLabel', () => {
  const now = at(2026, 7, 27, 10, 30);

  it('names today and yesterday', () => {
    expect(dayLabel(at(2026, 7, 27, 9), now)).toBe('Today');
    expect(dayLabel(at(2026, 7, 26, 23, 50), now)).toBe('Yesterday');
  });

  it('counts from local midnight, not from 24 hours ago', () => {
    // The bug this guards: at 10:30 today, a file written at 23:50 yesterday is
    // less than 24 hours old but is emphatically not "Today".
    const lateYesterday = at(2026, 7, 26, 23, 50);
    expect(now - lateYesterday).toBeLessThan(24 * 60 * 60 * 1000);
    expect(dayLabel(lateYesterday, now)).toBe('Yesterday');
  });

  it('still says Today for a file written a minute after midnight', () => {
    expect(dayLabel(at(2026, 7, 27, 0, 1), now)).toBe('Today');
  });

  it('names the weekday inside the last week', () => {
    // 2026-07-23 is a Thursday.
    expect(dayLabel(at(2026, 7, 23), now)).toBe(
      new Date(at(2026, 7, 23)).toLocaleDateString(undefined, { weekday: 'long' })
    );
  });

  it('drops to a date beyond a week, and adds the year beyond this one', () => {
    const thisYear = dayLabel(at(2026, 3, 2), now);
    expect(thisYear).not.toContain('2026');
    expect(dayLabel(at(2025, 12, 30), now)).toContain('2025');
  });

  it('names a modification time that is not a time, instead of throwing one', () => {
    // Every comparison in here is false for NaN, so without a guard these reach
    // `toLocaleDateString` on an Invalid Date -- a RangeError out of the Intl
    // formatter, thrown while the files sheet is rendering.
    expect(() => dayLabel(Number.NaN, now)).not.toThrow();
    expect(dayLabel(Number.NaN, now)).toBe('Unknown date');
    expect(dayLabel(Number.POSITIVE_INFINITY, now)).toBe('Unknown date');
    expect(dayLabel(at(2026, 7, 27, 9), Number.NaN)).toBe('Unknown date');
  });
});

describe('groupByDay', () => {
  const now = at(2026, 7, 27, 10, 30);

  it('puts a heading before each run and counts what is under it', () => {
    const rows = groupByDay(
      [
        asset('a.ts', at(2026, 7, 27, 9)),
        asset('b.ts', at(2026, 7, 27, 8)),
        asset('c.ts', at(2026, 7, 26, 15)),
      ],
      now
    );

    expect(rows.map((row) => row.type)).toEqual(['heading', 'asset', 'asset', 'heading', 'asset']);
    const headings = rows.filter((row) => row.type === 'heading');
    expect(headings[0]).toMatchObject({ label: 'Today', count: 2 });
    expect(headings[1]).toMatchObject({ label: 'Yesterday', count: 1 });
  });

  it('keeps the order it was given, which is newest first', () => {
    const rows = groupByDay(
      [asset('new.ts', at(2026, 7, 27, 9)), asset('old.ts', at(2026, 7, 20, 9))],
      now
    );
    const names = rows.flatMap((row) => (row.type === 'asset' ? [row.asset.name] : []));
    expect(names).toEqual(['new.ts', 'old.ts']);
  });

  it('gives every row a key that survives a re-render', () => {
    const rows = groupByDay([asset('a.ts', at(2026, 7, 27, 9))], now);
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
  });

  it('returns nothing for an empty listing, so the empty state can speak', () => {
    expect(groupByDay([], now)).toEqual([]);
  });

  it('groups a file whose mtime is not a number under its own heading', () => {
    const rows = groupByDay(
      [asset('good.ts', at(2026, 7, 27, 9)), asset('broken.ts', Number.NaN)],
      now
    );
    const headings = rows.flatMap((row) => (row.type === 'heading' ? [row.label] : []));
    expect(headings).toEqual(['Today', 'Unknown date']);
  });

  it('gives a day named twice two keys', () => {
    // The pathological listing: undated files on both sides of a dated one, so
    // "Unknown date" opens a second run. Reachable -- a comparator handed a NaN
    // leaves those entries where they were, so they do not all cluster. A
    // repeated key is not a warning to a virtualized list: Legend List answers
    // one with missing rows and gaps, which on a full-size listing is a sheet
    // that draws blank.
    const rows = groupByDay(
      [asset('a.ts', Number.NaN), asset('b.ts', at(2026, 7, 27, 9)), asset('c.ts', Number.NaN)],
      now
    );

    const keys = rows.map((row) => row.key);
    expect(new Set(keys).size).toBe(keys.length);
    const headings = rows.flatMap((row) => (row.type === 'heading' ? [row.key] : []));
    expect(headings).toEqual(['day:Unknown date', 'day:Today', 'day:Unknown date#2']);
  });
});

/**
 * The property the Files sheet's list is built on: a row that has not changed
 * comes back as the same object, so a memoized row skips its render. Every
 * assertion here is about identity (`toBe`), never about shape.
 */
describe('groupByDay identity', () => {
  const now = at(2026, 7, 27, 10, 30);

  /** A listing of `count` files, newest first, three per day. */
  function listing(count: number, day = 27): SessionAsset[] {
    return Array.from({ length: count }, (_, index) =>
      asset(`f${index}.ts`, at(2026, 7, day - Math.floor(index / 3), 9, 59 - index))
    );
  }

  it('hands back the very same rows when the same listing is read again', () => {
    const assets = listing(9);
    const first = groupByDay(assets, now);
    // A re-read is freshly parsed JSON, so the asset objects are new even
    // though the files are not. Identity has to survive that or it is worth
    // nothing: this is what a poll, a refresh and a widened window all look
    // like on the wire.
    const second = groupByDay(structuredClone(assets), now, first);

    expect(second).toHaveLength(first.length);
    expect(second.every((row, index) => row === first[index])).toBe(true);
  });

  it('keeps every row already on screen when the window widens', () => {
    // Load-more, exactly as the sheet does it: the endpoint has no cursor, so
    // "more" is a wider `limit` and the whole listing arrives again with older
    // files on the end.
    const first = groupByDay(listing(100), now);
    const second = groupByDay(listing(200), now, first);

    const reused = second.filter((row) => first.includes(row)).length;
    // Every row of the first page survives except one: the heading of the day
    // the second page continues, whose tally grew.
    expect(reused).toBe(first.length - 1);
    const dropped = first.filter((row) => !second.includes(row));
    expect(dropped).toHaveLength(1);
    expect(dropped[0].type).toBe('heading');
    // Every file row of the first page is still the object it was.
    const keptFiles = first.filter((row) => row.type === 'asset' && second.includes(row));
    expect(keptFiles).toHaveLength(100);
  });

  it('keeps the surviving rows when a search narrows the listing', () => {
    const assets = listing(9);
    const all = groupByDay(assets, now);
    const narrowed = groupByDay([assets[0], assets[4]], now, all);

    const kept = narrowed.filter((row) => row.type === 'asset' && all.includes(row));
    expect(kept).toHaveLength(2);
  });

  it('replaces the row for a file that was rewritten', () => {
    const before = groupByDay([asset('a.ts', at(2026, 7, 27, 9), { size: 10 })], now);
    const after = groupByDay([asset('a.ts', at(2026, 7, 27, 9), { size: 4096 })], now, before);
    // The row shows the size, so a new size is a new row -- and the day is
    // unchanged, so the heading above it is not.
    expect(after[1]).not.toBe(before[1]);
    expect(after[0]).toBe(before[0]);
  });

  it('replaces a heading whose tally changed, and only that one', () => {
    const older = asset('old.ts', at(2026, 7, 26, 9));
    const before = groupByDay([asset('a.ts', at(2026, 7, 27, 9)), older], now);
    const after = groupByDay(
      [asset('a.ts', at(2026, 7, 27, 9)), asset('b.ts', at(2026, 7, 27, 8)), older],
      now,
      before
    );

    // Today's heading now counts two, so it is a new object; yesterday's is
    // untouched and neither of the files that were already there re-renders.
    expect(after[0]).not.toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(after[3]).toBe(before[2]);
    expect(after[4]).toBe(before[3]);
  });

  it('does not confuse two files that swapped places', () => {
    // Reuse is keyed on the asset id rather than on the position, so a listing
    // reordered by a rewrite still hands each file its own row.
    const first = groupByDay(
      [asset('a.ts', at(2026, 7, 27, 9)), asset('b.ts', at(2026, 7, 27, 8))],
      now
    );
    const second = groupByDay(
      [asset('b.ts', at(2026, 7, 27, 8)), asset('a.ts', at(2026, 7, 27, 9))],
      now,
      first
    );

    expect(second[1]).toBe(first[2]);
    expect(second[2]).toBe(first[1]);
  });
});
