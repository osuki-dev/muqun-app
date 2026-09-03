// The global instance and inert `msg` descriptors, not a hook: everything here
// speaks at authentication time -- an event, not a render -- so the locale is
// read the moment the system sheet comes up. "Face ID" and "Touch ID" are
// Apple's brand names and stay as they are in every language.
import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import * as LocalAuthentication from 'expo-local-authentication';

export type LocalAuthKind = 'face' | 'fingerprint' | 'iris' | 'generic';

export type LocalAuthAvailability = {
  available: boolean;
  enrolled: boolean;
  label: string;
  kind: LocalAuthKind;
};

let lastSuccessfulAuthenticationAt = 0;

export async function getLocalAuthAvailability(): Promise<LocalAuthAvailability> {
  const [hasHardware, enrolled, types] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
    LocalAuthentication.supportedAuthenticationTypesAsync(),
  ]);

  const { label, kind } = authenticationDescriptor(types);
  return {
    available: hasHardware && types.length > 0,
    enrolled,
    label,
    kind,
  };
}

export async function authenticateForAppUnlock(label?: string) {
  const method = label ?? i18n._(msg`device authentication`);
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: i18n._(msg`Unlock Muqun`),
    promptSubtitle: i18n._(msg`Authenticate with ${method} to continue`),
    cancelLabel: i18n._(msg`Cancel`),
    fallbackLabel: i18n._(msg`Use device passcode`),
    biometricsSecurityLevel: 'strong',
    disableDeviceFallback: false,
    requireConfirmation: true,
  });
  if (result.success) lastSuccessfulAuthenticationAt = Date.now();
  return result;
}

export function wasRecentlyAuthenticated(maxAgeMs = 5_000): boolean {
  return Date.now() - lastSuccessfulAuthenticationAt <= maxAgeMs;
}

function authenticationDescriptor(types: LocalAuthentication.AuthenticationType[]): {
  label: string;
  kind: LocalAuthKind;
} {
  const hasFace = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
  const hasFingerprint = types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT);
  const hasIris = types.includes(LocalAuthentication.AuthenticationType.IRIS);

  if (process.env.EXPO_OS === 'ios') {
    if (hasFace) return { label: 'Face ID', kind: 'face' };
    if (hasFingerprint) return { label: 'Touch ID', kind: 'fingerprint' };
  } else if (hasFingerprint || hasFace) {
    // Android can't tell us which modality the strong-auth prompt will show
    // (Samsung has both but prompts for fingerprint), so just say "biometrics".
    return { label: i18n._(msg`biometrics`), kind: 'generic' };
  }
  if (hasIris) return { label: i18n._(msg`iris recognition`), kind: 'iris' };
  return { label: i18n._(msg`device authentication`), kind: 'generic' };
}
