import { beforeEach, describe, expect, test } from 'bun:test';

import {
  launchHeroRect,
  publishLaunchHeroRect,
  resetLaunchHeroRectForTesting,
  subscribeLaunchHeroRect,
  type LaunchHeroRect,
} from '../launch-hero-rect';

const BAND: LaunchHeroRect = { x: 18, y: 214, width: 357, height: 180 };

beforeEach(() => resetLaunchHeroRectForTesting());

describe('publishLaunchHeroRect', () => {
  test('nothing has been reported until Home reports something', () => {
    expect(launchHeroRect()).toBeNull();
  });

  test('a measured band is kept as given', () => {
    publishLaunchHeroRect(BAND);
    expect(launchHeroRect()).toEqual(BAND);
  });

  test('a band with no area is not a landing place', () => {
    // Home lays the hero out before its picture has decoded, and a zero-height
    // band would fly the opening's picture into a line.
    publishLaunchHeroRect({ ...BAND, height: 0 });
    expect(launchHeroRect()).toBeNull();
    publishLaunchHeroRect({ ...BAND, width: 0 });
    expect(launchHeroRect()).toBeNull();
  });

  test('a band measured as nonsense is not a landing place either', () => {
    publishLaunchHeroRect({ ...BAND, y: Number.NaN });
    expect(launchHeroRect()).toBeNull();
  });

  test('an explicit null clears it, for a pack that stops drawing a hero', () => {
    publishLaunchHeroRect(BAND);
    publishLaunchHeroRect(null);
    expect(launchHeroRect()).toBeNull();
  });
});

describe('subscribeLaunchHeroRect', () => {
  test('a subscriber hears the current value immediately', () => {
    // The opening may mount before or after Home measures, and must not care.
    publishLaunchHeroRect(BAND);
    const seen: (LaunchHeroRect | null)[] = [];
    subscribeLaunchHeroRect((rect) => seen.push(rect));
    expect(seen).toEqual([BAND]);
  });

  test('a subscriber that mounted first still hears the measurement', () => {
    const seen: (LaunchHeroRect | null)[] = [];
    subscribeLaunchHeroRect((rect) => seen.push(rect));
    publishLaunchHeroRect(BAND);
    expect(seen).toEqual([null, BAND]);
  });

  test('an unchanged measurement is not announced again', () => {
    // Home re-measures on every layout pass, and a fresh object each time would
    // otherwise restart the landing mid-flight.
    const seen: (LaunchHeroRect | null)[] = [];
    subscribeLaunchHeroRect((rect) => seen.push(rect));
    publishLaunchHeroRect(BAND);
    publishLaunchHeroRect({ ...BAND });
    expect(seen).toEqual([null, BAND]);
  });

  test('unsubscribing stops the updates', () => {
    const seen: (LaunchHeroRect | null)[] = [];
    const stop = subscribeLaunchHeroRect((rect) => seen.push(rect));
    stop();
    publishLaunchHeroRect(BAND);
    expect(seen).toEqual([null]);
  });

  test('every listener hears a change', () => {
    const first: (LaunchHeroRect | null)[] = [];
    const second: (LaunchHeroRect | null)[] = [];
    subscribeLaunchHeroRect((rect) => first.push(rect));
    subscribeLaunchHeroRect((rect) => second.push(rect));
    publishLaunchHeroRect(BAND);
    expect(first).toEqual([null, BAND]);
    expect(second).toEqual([null, BAND]);
  });
});
