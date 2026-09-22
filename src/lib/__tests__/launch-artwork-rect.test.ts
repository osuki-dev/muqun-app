import { beforeEach, describe, expect, test } from 'bun:test';

import {
  launchArtworkRect,
  publishLaunchArtworkRect,
  resetLaunchArtworkRectForTesting,
  subscribeLaunchArtworkRect,
  type LaunchArtworkRect,
} from '../launch-artwork-rect';

const BAND: LaunchArtworkRect = { x: 18, y: 214, width: 357, height: 180 };

beforeEach(() => resetLaunchArtworkRectForTesting());

describe('publishLaunchArtworkRect', () => {
  test('nothing has been reported until Home reports something', () => {
    expect(launchArtworkRect()).toBeNull();
  });

  test('a measured band is kept as given', () => {
    publishLaunchArtworkRect(BAND);
    expect(launchArtworkRect()).toEqual(BAND);
  });

  test('a band with no area is not a landing place', () => {
    // Home lays the hero out before its picture has decoded, and a zero-height
    // band would fly the opening's picture into a line.
    publishLaunchArtworkRect({ ...BAND, height: 0 });
    expect(launchArtworkRect()).toBeNull();
    publishLaunchArtworkRect({ ...BAND, width: 0 });
    expect(launchArtworkRect()).toBeNull();
  });

  test('a band measured as nonsense is not a landing place either', () => {
    publishLaunchArtworkRect({ ...BAND, y: Number.NaN });
    expect(launchArtworkRect()).toBeNull();
  });

  test('an explicit null clears it, for a pack that stops drawing a hero', () => {
    publishLaunchArtworkRect(BAND);
    publishLaunchArtworkRect(null);
    expect(launchArtworkRect()).toBeNull();
  });
});

describe('subscribeLaunchArtworkRect', () => {
  test('a subscriber hears the current value immediately', () => {
    // The opening may mount before or after Home measures, and must not care.
    publishLaunchArtworkRect(BAND);
    const seen: (LaunchArtworkRect | null)[] = [];
    subscribeLaunchArtworkRect((rect) => seen.push(rect));
    expect(seen).toEqual([BAND]);
  });

  test('a subscriber that mounted first still hears the measurement', () => {
    const seen: (LaunchArtworkRect | null)[] = [];
    subscribeLaunchArtworkRect((rect) => seen.push(rect));
    publishLaunchArtworkRect(BAND);
    expect(seen).toEqual([null, BAND]);
  });

  test('an unchanged measurement is not announced again', () => {
    // Home re-measures on every layout pass, and a fresh object each time would
    // otherwise restart the landing mid-flight.
    const seen: (LaunchArtworkRect | null)[] = [];
    subscribeLaunchArtworkRect((rect) => seen.push(rect));
    publishLaunchArtworkRect(BAND);
    publishLaunchArtworkRect({ ...BAND });
    expect(seen).toEqual([null, BAND]);
  });

  test('unsubscribing stops the updates', () => {
    const seen: (LaunchArtworkRect | null)[] = [];
    const stop = subscribeLaunchArtworkRect((rect) => seen.push(rect));
    stop();
    publishLaunchArtworkRect(BAND);
    expect(seen).toEqual([null]);
  });

  test('every listener hears a change', () => {
    const first: (LaunchArtworkRect | null)[] = [];
    const second: (LaunchArtworkRect | null)[] = [];
    subscribeLaunchArtworkRect((rect) => first.push(rect));
    subscribeLaunchArtworkRect((rect) => second.push(rect));
    publishLaunchArtworkRect(BAND);
    expect(first).toEqual([null, BAND]);
    expect(second).toEqual([null, BAND]);
  });
});
