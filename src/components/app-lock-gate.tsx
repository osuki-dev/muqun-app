import { Trans, useLingui } from '@lingui/react/macro';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { Image } from 'expo-image';
import * as ScreenCapture from 'expo-screen-capture';
import { Fingerprint, LockKeyhole, ScanFace } from 'lucide-react-native';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { feedback } from '@/lib/feedback';
import { fadeIn, fadeOut } from '@/lib/motion';
import {
  authenticateForAppUnlock,
  getLocalAuthAvailability,
  type LocalAuthKind,
  wasRecentlyAuthenticated,
} from '@/lib/local-authentication';
import { useAppSettings } from '@/stores/app-settings';

import { LogoLoader } from './logo-loader';
import { PressableScale } from './pressable-scale';

const APP_LOCK_CAPTURE_KEY = 'muqun-app-lock';
const RELOCK_AFTER_BACKGROUND_MS = 30_000;
const brandMark = require('../../assets/images/loading-mark.png');

export function AppLockGate({ children }: { children: ReactNode }) {
  // `t` from the hook, not the global `t` from `@lingui/core/macro`.
  //
  // React Compiler is enabled, and it will memoize a global `t` call whose
  // arguments have not changed -- it has no way to know the result also depends
  // on the active locale. The symptom is a half-translated screen after a
  // language switch: `<Trans>` elements move and everything built from a `t`
  // call keeps the old language. The hook's `t` is bound to the Lingui context,
  // so the compiler sees a dependency that actually changes.
  const { t } = useLingui();

  const theme = useThemeTokens();
  const hydrated = useAppSettings((state) => state.hydrated);
  const appLockEnabled = useAppSettings((state) => state.appLockEnabled);
  const [locked, setLocked] = useState(false);
  const [authenticating, setAuthenticating] = useState(false);
  const [authLabel, setAuthLabel] = useState('device authentication');
  const [authKind, setAuthKind] = useState<LocalAuthKind>('generic');
  const [error, setError] = useState<string | null>(null);
  const authenticatingRef = useRef(false);
  const initialAuthenticationRef = useRef(false);
  const backgroundAtRef = useRef<number | null>(null);

  /**
   * What the platform's authentication error means, in a sentence.
   *
   * Declared inside the component, closing over the hook's `t`, and NOT as a
   * module function handed `t` as a parameter. The Lingui babel macro rewrites
   * ``t`...` `` only where it can walk the reference back to the very
   * `useLingui()` destructuring it came from; a `t` that arrives as an argument
   * is a different binding, so the macro leaves the tagged template alone, the
   * runtime calls Lingui's `_` with a raw strings array, and the sentence comes
   * out empty -- a lock screen that refuses you and then says nothing.
   */
  const localAuthErrorMessage = useCallback(
    (error: string, label: string): string => {
      if (error === 'not_enrolled') return t`Set up ${label} in system settings first.`;
      if (error === 'lockout') {
        return t`${label} is temporarily locked. Use the system fallback or try later.`;
      }
      if (error === 'passcode_not_set') return t`Set a device passcode before using App Lock.`;
      if (error === 'authentication_failed') return t`Authentication failed. Try again.`;
      return t`Muqun could not verify your identity. Try again.`;
    },
    [t]
  );

  const requestUnlock = useCallback(async () => {
    if (authenticatingRef.current || !useAppSettings.getState().appLockEnabled) return;
    authenticatingRef.current = true;
    setAuthenticating(true);
    setLocked(true);
    setError(null);
    try {
      const availability = await getLocalAuthAvailability();
      setAuthLabel(availability.label);
      setAuthKind(availability.kind);
      if (!availability.available || !availability.enrolled) {
        setError(t`Set up ${availability.label} in system settings to unlock Muqun.`);
        return;
      }
      const result = await authenticateForAppUnlock(availability.label);
      if (result.success) {
        setLocked(false);
        await feedback('success');
        if (process.env.EXPO_OS === 'android') {
          await ScreenCapture.allowScreenCaptureAsync(APP_LOCK_CAPTURE_KEY).catch(() => undefined);
        }
        return;
      }
      if (result.error !== 'user_cancel' && result.error !== 'system_cancel') {
        setError(localAuthErrorMessage(result.error, availability.label));
      }
    } catch {
      setError(t`Authentication is unavailable. Try again or check system settings.`);
    } finally {
      authenticatingRef.current = false;
      setAuthenticating(false);
    }
  }, [localAuthErrorMessage, t]);

  useEffect(() => {
    if (!hydrated) return;
    if (!appLockEnabled) {
      initialAuthenticationRef.current = false;
      setLocked(false);
      setError(null);
      void ScreenCapture.allowScreenCaptureAsync(APP_LOCK_CAPTURE_KEY).catch(() => undefined);
      if (process.env.EXPO_OS === 'ios') {
        void ScreenCapture.disableAppSwitcherProtectionAsync().catch(() => undefined);
      }
      return;
    }

    if (process.env.EXPO_OS === 'ios') {
      void ScreenCapture.enableAppSwitcherProtectionAsync(0.95).catch(() => undefined);
    }
    if (!initialAuthenticationRef.current) {
      initialAuthenticationRef.current = true;
      if (wasRecentlyAuthenticated()) {
        setLocked(false);
        return;
      }
      setLocked(true);
      void requestUnlock();
    }
  }, [appLockEnabled, hydrated, requestUnlock, t]);

  useEffect(() => {
    if (!hydrated) return;
    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      const enabled = useAppSettings.getState().appLockEnabled;
      if (!enabled) return;

      if (nextState === 'inactive' || nextState === 'background') {
        if (!authenticatingRef.current && backgroundAtRef.current === null) {
          backgroundAtRef.current = Date.now();
        }
        if (process.env.EXPO_OS === 'android') {
          void ScreenCapture.preventScreenCaptureAsync(APP_LOCK_CAPTURE_KEY).catch(() => undefined);
        }
        return;
      }

      if (nextState === 'active' && backgroundAtRef.current !== null) {
        const elapsed = Date.now() - backgroundAtRef.current;
        backgroundAtRef.current = null;
        if (elapsed >= RELOCK_AFTER_BACKGROUND_MS && !authenticatingRef.current) {
          setLocked(true);
          void requestUnlock();
        } else if (!locked && process.env.EXPO_OS === 'android') {
          void ScreenCapture.allowScreenCaptureAsync(APP_LOCK_CAPTURE_KEY).catch(() => undefined);
        }
      }
    });
    return () => subscription.remove();
  }, [hydrated, locked, requestUnlock]);

  if (!hydrated) {
    return (
      <View style={[styles.loading, { backgroundColor: theme.colors.background }]}>
        <LogoLoader accessibilityLabel={t`Loading settings`} size={64} />
      </View>
    );
  }

  const showLock = appLockEnabled && locked;

  /*
   * The gate crossfades in one direction only, and deliberately so.
   *
   * Unlocking: the app mounts underneath while the lock screen fades off the
   * top of it, which is the transition every app-lock user meets on every cold
   * start and every resume. It works because Reanimated keeps an `exiting`
   * view on screen after React has dropped it -- the children below are
   * already rendering by the time the fade starts.
   *
   * Locking: the backdrop takes the screen on the first frame, with no opacity
   * ramp of its own. A fade in would mean showing whatever was on screen --
   * someone's terminal -- through a half-transparent lock for the length of
   * the animation, which is the one thing this component exists to prevent.
   * The motion goes on the contents instead, so the lock still arrives rather
   * than appearing to have always been there.
   */
  return (
    <View style={styles.root}>
      {showLock ? null : children}
      {showLock ? (
        <Animated.View
          exiting={fadeOut('medium')}
          style={[styles.lockScreen, { backgroundColor: theme.colors.background }]}>
          <Animated.View entering={fadeIn('short')} style={styles.lockContent}>
            <View style={[styles.iconFrame, { backgroundColor: theme.colors.surfaceRaised }]}>
              <Image source={brandMark} contentFit="contain" style={styles.appIcon} />
              <View style={[styles.lockBadge, { backgroundColor: theme.colors.primary }]}>
                <LockKeyhole size={16} color={theme.colors.onPrimary} strokeWidth={2.4} />
              </View>
            </View>
            <View style={styles.copy}>
              <Text variant="heading" style={styles.title}>
                <Trans>Muqun is locked</Trans>
              </Text>
              <Text variant="bodySmall" color={theme.colors.textMuted} style={styles.detail}>
                <Trans>Authenticate with {authLabel} to continue.</Trans>
              </Text>
              {error ? (
                <Animated.View entering={fadeIn('micro')} exiting={fadeOut('micro')}>
                  <Text
                    selectable
                    variant="caption"
                    color={theme.colors.danger}
                    style={styles.detail}>
                    {error}
                  </Text>
                </Animated.View>
              ) : null}
            </View>
            <PressableScale
              accessibilityLabel={t`Unlock with ${authLabel}`}
              disabled={authenticating}
              onPress={() => void requestUnlock()}
              style={[styles.unlockButton, { backgroundColor: theme.colors.primary }]}>
              {authenticating ? (
                <LogoLoader accessibilityLabel={t`Authenticating`} compact size={28} />
              ) : authKind === 'face' ? (
                <ScanFace size={20} color="#FFFFFF" strokeWidth={2.3} />
              ) : (
                // Fingerprint covers fingerprint, iris, and the generic Android
                // case (which prompts with a fingerprint glyph by default).
                <Fingerprint size={20} color="#FFFFFF" strokeWidth={2.3} />
              )}
              <Text variant="label" color="#FFFFFF">
                {authenticating ? t`Authenticating…` : t`Unlock with ${authLabel}`}
              </Text>
            </PressableScale>
          </Animated.View>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // Absolute rather than `flex: 1`: while it is fading out the app is already
  // laid out underneath it, and a lock screen taking part in that layout would
  // push the app it is meant to be covering.
  lockScreen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
    elevation: 10,
  },
  lockContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    gap: 26,
  },
  iconFrame: {
    width: 104,
    height: 104,
    borderRadius: 30,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  appIcon: { width: 72, height: 72 },
  lockBadge: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { alignItems: 'center', gap: 7, maxWidth: 320 },
  title: { fontSize: 26, lineHeight: 32, textAlign: 'center' },
  detail: { textAlign: 'center', lineHeight: 20 },
  unlockButton: {
    minHeight: 50,
    borderRadius: 25,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
});
