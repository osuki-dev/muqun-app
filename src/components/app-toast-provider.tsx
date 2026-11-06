import { ToastProvider, useToast, type ToastController } from '@osuki-dev/ui';
import { useEffect, type ComponentProps, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useNotificationSurfaceStyle } from '@/components/notification-surface';
import { TRANSIENT_TOAST_DURATION_MS } from '@/lib/session-read-feedback';

/**
 * The app's toasts. Mounted once at the root, and again inside each native
 * `Modal` that can raise one: a `Modal` is its own window on Android and covers
 * the root's toasts, so a viewer shows them in its own window instead of
 * reaching for a system toast or alert.
 *
 * The card is a colored plane over whatever screen raised it, so it answers the
 * pack's background opacity like every other surface.
 */
export function AppToastProvider({ children }: { children: ReactNode }) {
  const notificationSurfaceStyle = useNotificationSurfaceStyle();
  return (
    <ToastProvider
      maxWidth={480}
      defaultDurationMs={TRANSIENT_TOAST_DURATION_MS}
      toastStyle={[
        notificationSurfaceStyle,
        { borderWidth: StyleSheet.hairlineWidth, borderColor: 'transparent' },
      ]}>
      {children}
    </ToastProvider>
  );
}

/**
 * Reports the toasts of the window this element is rendered in, for a hook
 * whose owner sits outside the `Modal` it draws into.
 */
export function NearestToasts({
  onChange,
}: {
  onChange: (toasts: ToastController | null) => void;
}) {
  const toasts = useToast();
  useEffect(() => {
    onChange(toasts);
    return () => onChange(null);
  }, [onChange, toasts]);
  return null;
}

/** The root of a native `Modal`'s window: its gestures and its own toasts. */
export function ModalWindowRoot(props: ComponentProps<typeof GestureHandlerRootView>) {
  return (
    <AppToastProvider>
      <GestureHandlerRootView {...props} />
    </AppToastProvider>
  );
}
