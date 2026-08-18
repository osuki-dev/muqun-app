import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

import { useAppSettings } from '@/stores/app-settings';

export type FeedbackKind = 'selection' | 'success' | 'warning' | 'error';

export async function feedback(kind: FeedbackKind = 'selection'): Promise<void> {
  if (!useAppSettings.getState().hapticsEnabled || Platform.OS === 'web') return;

  try {
    if (Platform.OS === 'android') {
      const type = kind === 'success'
        ? Haptics.AndroidHaptics.Confirm
        : kind === 'warning' || kind === 'error'
          ? Haptics.AndroidHaptics.Reject
          : Haptics.AndroidHaptics.Context_Click;
      await Haptics.performAndroidHapticsAsync(type);
      return;
    }

    if (kind === 'selection') {
      await Haptics.selectionAsync();
      return;
    }

    const type = kind === 'success'
      ? Haptics.NotificationFeedbackType.Success
      : kind === 'warning'
        ? Haptics.NotificationFeedbackType.Warning
        : Haptics.NotificationFeedbackType.Error;
    await Haptics.notificationAsync(type);
  } catch {
    // Haptics are best-effort and may be disabled by the OS.
  }
}
