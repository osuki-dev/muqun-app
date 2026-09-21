import { appChrome } from '@/constants/appearance';
import type { AppearanceProfile } from '@/lib/appearance-profile';

export type NotificationSurfaceStyle = Readonly<{
  borderRadius: number;
  borderCurve: 'continuous';
  boxShadow?: string;
}>;

/** Shared notification geometry selected by the active Home appearance profile. */
export function notificationSurfaceStyle(
  profile: AppearanceProfile,
  shadow = true
): NotificationSurfaceStyle {
  return {
    borderRadius: profile.chrome.overlay,
    borderCurve: 'continuous',
    ...(shadow ? { boxShadow: appChrome.shadow.notice } : {}),
  };
}
