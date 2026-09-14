import { beforeEach, describe, expect, mock, test } from 'bun:test';

// MMKV is native; under bun the module's own fallback is what gets exercised.
mock.module('react-native-mmkv', () => ({
  createMMKV: () => {
    throw new Error('no native MMKV in tests');
  },
}));

const {
  LAUNCH_INTRO_VERSION,
  hasSeenLaunchIntro,
  launchIntroSeenAt,
  markLaunchIntroSeen,
  resetLaunchIntroStoreForTesting,
} = await import('../launch-intro-seen');

beforeEach(() => resetLaunchIntroStoreForTesting());

describe('launchIntroSeenAt', () => {
  test('nothing stored, or garbage, means not seen', () => {
    expect(launchIntroSeenAt(undefined)).toBe(false);
    expect(launchIntroSeenAt('')).toBe(false);
    expect(launchIntroSeenAt('yes')).toBe(false);
  });

  test('an older version counts as unseen, the current or a newer one as seen', () => {
    expect(launchIntroSeenAt(String(LAUNCH_INTRO_VERSION - 1))).toBe(false);
    expect(launchIntroSeenAt(String(LAUNCH_INTRO_VERSION))).toBe(true);
    expect(launchIntroSeenAt(String(LAUNCH_INTRO_VERSION + 1))).toBe(true);
  });
});

describe('the store', () => {
  test('starts unseen and remembers a mark for the rest of the process', () => {
    expect(hasSeenLaunchIntro()).toBe(false);
    markLaunchIntroSeen();
    expect(hasSeenLaunchIntro()).toBe(true);
  });
});
