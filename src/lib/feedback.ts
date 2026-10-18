import type { HapticFeedbackKind } from '@osuki-dev/ui';
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

import { useAppSettings } from '@/stores/app-settings';

export type FeedbackKind = 'selection' | 'success' | 'warning' | 'error';

export async function feedback(kind: FeedbackKind = 'selection'): Promise<void> {
  if (!useAppSettings.getState().hapticsEnabled || Platform.OS === 'web') return;

  try {
    if (Platform.OS === 'android') {
      const type =
        kind === 'success'
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

    const type =
      kind === 'success'
        ? Haptics.NotificationFeedbackType.Success
        : kind === 'warning'
          ? Haptics.NotificationFeedbackType.Warning
          : Haptics.NotificationFeedbackType.Error;
    await Haptics.notificationAsync(type);
  } catch {
    // Haptics are best-effort and may be disabled by the OS.
  }
}

/**
 * The kit's haptic kinds, played as the app's. The kit's `light` and `medium`
 * are its button presses, which have always been silent in this app.
 */
const KIT_FEEDBACK: Record<HapticFeedbackKind, FeedbackKind | null> = {
  selection: 'selection',
  light: null,
  medium: null,
  success: 'success',
  warning: 'warning',
  error: 'error',
};

/** `HapticsProvider`'s `feedback`: every kit press goes through the reader's haptics setting. */
export async function kitFeedback(kind: HapticFeedbackKind = 'selection'): Promise<void> {
  const mapped = KIT_FEEDBACK[kind];
  if (mapped) await feedback(mapped);
}
