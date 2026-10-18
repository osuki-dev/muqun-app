// The global instance and inert `msg` descriptors, not a hook: the system
// sheet speaks at authentication time, and the settings row speaks at render.
// Both call `localAuthMethodLabel`, which reads the locale at that moment.
// "Face ID" and "Touch ID" are Apple's brand names and stay as they are in
// every language.
import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import * as LocalAuthentication from 'expo-local-authentication';

export type LocalAuthKind = 'face' | 'fingerprint' | 'iris' | 'generic';

/**
 * Which name to show. Kept as a key, not a translated sentence: the settings
 * row and the lock screen render it on every paint, so a language change does
 * not leave the English word sitting inside an otherwise translated sentence.
 * Face ID and Touch ID stay Apple's names in every language.
 */
export type LocalAuthMethod = 'face-id' | 'touch-id' | 'biometrics' | 'iris' | 'device';

export type LocalAuthAvailability = {
  available: boolean;
  enrolled: boolean;
  method: LocalAuthMethod;
  kind: LocalAuthKind;
};

export function localAuthMethodLabel(method: LocalAuthMethod): string {
  switch (method) {
    case 'face-id':
      return 'Face ID';
    case 'touch-id':
      return 'Touch ID';
    case 'biometrics':
      return i18n._(msg`biometrics`);
    case 'iris':
      return i18n._(msg`iris recognition`);
    case 'device':
      return i18n._(msg`device authentication`);
  }
}

let lastSuccessfulAuthenticationAt = 0;

export async function getLocalAuthAvailability(): Promise<LocalAuthAvailability> {
  const [hasHardware, enrolled, types] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
    LocalAuthentication.supportedAuthenticationTypesAsync(),
  ]);

  const { method, kind } = authenticationDescriptor(types);
  return {
    available: hasHardware && types.length > 0,
    enrolled,
    method,
    kind,
  };
}

export async function authenticateForAppUnlock(method: LocalAuthMethod = 'device') {
  const name = localAuthMethodLabel(method);
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: i18n._(msg`Unlock Muqun`),
    promptSubtitle: i18n._(msg`Authenticate with ${name} to continue`),
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
  method: LocalAuthMethod;
  kind: LocalAuthKind;
} {
  const hasFace = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
  const hasFingerprint = types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT);
  const hasIris = types.includes(LocalAuthentication.AuthenticationType.IRIS);

  if (process.env.EXPO_OS === 'ios') {
    if (hasFace) return { method: 'face-id', kind: 'face' };
    if (hasFingerprint) return { method: 'touch-id', kind: 'fingerprint' };
  } else if (hasFingerprint || hasFace) {
    // Android can't tell us which modality the strong-auth prompt will show
    // (Samsung has both but prompts for fingerprint), so just say "biometrics".
    return { method: 'biometrics', kind: 'generic' };
  }
  if (hasIris) return { method: 'iris', kind: 'iris' };
  return { method: 'device', kind: 'generic' };
}
