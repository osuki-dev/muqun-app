import { expect, test } from 'bun:test';

import { appearanceProfiles } from '@/lib/appearance-profile';
import { notificationSurfaceStyle } from '@/lib/notification-surface';

test('notification geometry follows every homeLayout profile from one contract', () => {
  for (const profile of Object.values(appearanceProfiles)) {
    expect(notificationSurfaceStyle(profile)).toMatchObject({
      borderRadius: profile.chrome.overlay,
      borderCurve: 'continuous',
    });
  }
});

test('stacked notification pages can reuse geometry without multiplying the shadow', () => {
  expect(notificationSurfaceStyle(appearanceProfiles.editorial, false)).toEqual({
    borderRadius: appearanceProfiles.editorial.chrome.overlay,
    borderCurve: 'continuous',
  });
});
