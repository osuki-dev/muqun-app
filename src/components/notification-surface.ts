import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import {
  notificationSurfaceStyle,
  type NotificationSurfaceStyle,
} from '@/lib/notification-surface';

/**
 * One presentation contract for notification plates across the app.
 *
 * Toasts, foreground pushes, terminal notices and update messages keep their
 * own lifecycle owners, but none of them owns geometry. `homeLayout` selects
 * that geometry here so a new notice surface cannot quietly invent another
 * radius or forget to follow an appearance-profile change.
 */
export function useNotificationSurfaceStyle(shadow = true): NotificationSurfaceStyle {
  return notificationSurfaceStyle(useAppearanceProfile(), shadow);
}
