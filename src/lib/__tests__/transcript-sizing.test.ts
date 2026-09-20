import { describe, expect, test } from 'bun:test';

import {
  blendedRowSize,
  TRANSCRIPT_ESTIMATED_ITEM_SIZE,
  TRANSCRIPT_ROW_SIZE,
} from '../transcript-sizing';

describe('TRANSCRIPT_ROW_SIZE', () => {
  test('an assistant row is much taller than a user row', () => {
    // The whole reason a single flat estimate was wrong: the kinds are not
    // close to each other.
    expect(TRANSCRIPT_ROW_SIZE.assistant).toBeGreaterThan(TRANSCRIPT_ROW_SIZE.user * 2);
  });

  test('every kind has a measured size', () => {
    for (const role of ['assistant', 'user', 'system'] as const) {
      expect(TRANSCRIPT_ROW_SIZE[role]).toBeGreaterThan(0);
    }
  });
});

describe('blendedRowSize', () => {
  test('one kind on its own is that kind', () => {
    expect(blendedRowSize({ user: 12 })).toBe(TRANSCRIPT_ROW_SIZE.user);
    expect(blendedRowSize({ assistant: 3 })).toBe(TRANSCRIPT_ROW_SIZE.assistant);
  });

  test('weights by how many rows there are, not by how many kinds', () => {
    // Nine assistant rows to one user row is nearly an assistant row, where an
    // unweighted mean of the two kinds would be half way between them.
    const weighted = blendedRowSize({ assistant: 9, user: 1 });
    const unweighted = (TRANSCRIPT_ROW_SIZE.assistant + TRANSCRIPT_ROW_SIZE.user) / 2;
    expect(weighted).toBeGreaterThan(unweighted);
    expect(weighted).toBeLessThan(TRANSCRIPT_ROW_SIZE.assistant);
  });

  test('an even mix is the mean of the kinds present', () => {
    expect(blendedRowSize({ assistant: 5, user: 5 })).toBe(
      Math.round((TRANSCRIPT_ROW_SIZE.assistant + TRANSCRIPT_ROW_SIZE.user) / 2)
    );
  });

  test('an empty or zeroed mix falls back to what was measured', () => {
    expect(blendedRowSize({})).toBe(165);
    expect(blendedRowSize({ assistant: 0, user: 0, system: 0 })).toBe(165);
  });

  test('a negative count is not allowed to drag the estimate down', () => {
    expect(blendedRowSize({ assistant: 10, user: -100 })).toBe(TRANSCRIPT_ROW_SIZE.assistant);
  });

  test('always a whole number of dp', () => {
    expect(Number.isInteger(blendedRowSize({ assistant: 7, user: 3, system: 2 }))).toBe(true);
  });
});

describe('TRANSCRIPT_ESTIMATED_ITEM_SIZE', () => {
  test('reserves enough containers for a viewport of short user rows', () => {
    const viewport = 800;
    const allocated = Math.ceil(viewport / TRANSCRIPT_ESTIMATED_ITEM_SIZE);
    const shortRows = Math.ceil(viewport / TRANSCRIPT_ROW_SIZE.user);
    expect(allocated).toBeGreaterThanOrEqual(shortRows);
    expect(TRANSCRIPT_ESTIMATED_ITEM_SIZE).toBeLessThan(blendedRowSize({}));
  });

  test('sits between the smallest and the largest kind', () => {
    expect(TRANSCRIPT_ESTIMATED_ITEM_SIZE).toBeGreaterThan(TRANSCRIPT_ROW_SIZE.system);
    expect(TRANSCRIPT_ESTIMATED_ITEM_SIZE).toBeLessThan(TRANSCRIPT_ROW_SIZE.assistant);
  });
});
