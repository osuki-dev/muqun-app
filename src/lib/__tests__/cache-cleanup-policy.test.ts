import { describe, expect, test } from 'bun:test';
import {
  cacheCleanupIsDue,
  createCacheCleanupFlight,
  isCacheCleanupIntervalDays,
  isCacheCleanupTimestamp,
} from '../cache-cleanup-policy';

const day = 86_400_000;
const enabled = 1_000_000;

describe('automatic cache cleanup interval', () => {
  test('disabled or never enabled does no work', () => {
    expect(cacheCleanupIsDue(0, enabled, 0, enabled + 100 * day)).toBe(false);
    expect(cacheCleanupIsDue(10, 0, 0, enabled + 100 * day)).toBe(false);
  });

  test('waits the selected interval after enabling or changing it', () => {
    expect(cacheCleanupIsDue(10, enabled, 0, enabled + 10 * day - 1)).toBe(false);
    expect(cacheCleanupIsDue(10, enabled, 0, enabled + 10 * day)).toBe(true);
    expect(cacheCleanupIsDue(30, enabled + 10 * day, enabled, enabled + 39 * day)).toBe(false);
    expect(cacheCleanupIsDue(30, enabled + 10 * day, enabled, enabled + 40 * day)).toBe(true);
  });

  test('successful manual or automatic cleanup resets the interval; a backward clock waits', () => {
    const success = enabled + 11 * day;
    expect(cacheCleanupIsDue(10, enabled, success, success + 9 * day)).toBe(false);
    expect(cacheCleanupIsDue(10, enabled, success, success + 10 * day)).toBe(true);
    expect(cacheCleanupIsDue(10, enabled, success, enabled)).toBe(false);
  });

  test('stored intervals and timestamps reject malformed values', () => {
    for (const value of [null, '10', 1, 10.5, 365, {}]) {
      expect(isCacheCleanupIntervalDays(value)).toBe(false);
    }
    for (const value of [null, '100', -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(isCacheCleanupTimestamp(value)).toBe(false);
    }
    expect(isCacheCleanupIntervalDays(0)).toBe(true);
    expect(isCacheCleanupIntervalDays(10)).toBe(true);
    expect(isCacheCleanupIntervalDays(30)).toBe(true);
    expect(isCacheCleanupTimestamp(enabled)).toBe(true);
  });
});

describe('shared cleanup ownership', () => {
  test('manual and automatic calls join one operation and can retry a failed pass', async () => {
    const flight = createCacheCleanupFlight();
    const deferred = Promise.withResolvers<boolean>();
    let calls = 0;
    const clean = () => {
      calls++;
      return deferred.promise;
    };
    const automatic = flight.run(clean);
    const manual = flight.run(clean);
    expect(calls).toBe(1);
    expect(manual).toBe(automatic);
    deferred.resolve(false);
    expect(await manual).toBe(false);
    expect(await flight.run(async () => true)).toBe(true);
  });

  test('a producer protects its directory before waiting out an already-started deletion', async () => {
    const flight = createCacheCleanupFlight();
    const deletion = Promise.withResolvers<boolean>();
    const clearing = flight.run(() => deletion.promise);
    let pickerStarted = false;
    const picking = flight.protect('DocumentPicker').then(() => {
      pickerStarted = true;
    });
    expect(flight.isProtected('DocumentPicker')).toBe(true);
    await Promise.resolve();
    expect(pickerStarted).toBe(false);
    deletion.resolve(true);
    await clearing;
    await picking;
    expect(pickerStarted).toBe(true);
    expect(flight.isProtected('DocumentPicker')).toBe(true);
    await flight.protect('theme-stage-owned');
    flight.release('theme-stage-owned');
    expect(flight.isProtected('theme-stage-owned')).toBe(false);
  });

  test('a thrown cleanup releases the flight', async () => {
    const flight = createCacheCleanupFlight();
    await expect(
      flight.run(async () => {
        throw new Error('native failure');
      })
    ).rejects.toThrow('native failure');
    expect(await flight.run(async () => true)).toBe(true);
  });
});
