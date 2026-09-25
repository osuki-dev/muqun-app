import { useLingui } from '@lingui/react/macro';
import { useThemeTokens, useToast } from '@osuki-dev/ui';
import { useLocales } from 'expo-localization';
import { openBrowserAsync, WebBrowserPresentationStyle } from 'expo-web-browser';
import { ExternalLink } from 'lucide-react-native';
import { StyleSheet } from 'react-native';

import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { PressableScale } from '@/components/pressable-scale';
import { LADDER } from '@/components/settings-chrome';
import { Text } from '@/components/text';
import { useHasThemeArtwork } from '@/components/theme-artwork';
import { ICP_REGISTRATION_URL } from '@/constants/links';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { icpRegistration } from '@/lib/icp-registration';

/** Other regions never mount the registration content or its hooks. */
export function SettingsRegistration() {
  const locales = useLocales();
  if (locales[0]?.regionCode?.toUpperCase() !== 'CN') return null;
  const number = icpRegistration('CN', process.env.EXPO_PUBLIC_ICP_NUMBER);
  return number ? <RegistrationLink number={number} /> : null;
}

function RegistrationLink({ number }: { number: string }) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();
  const background = useSurfaceBackground();
  const hasWallpaper = useHasThemeArtwork('shell.wallpaper');
  const { showToast } = useToast();

  async function openRegistration() {
    try {
      await openBrowserAsync(ICP_REGISTRATION_URL, {
        presentationStyle: WebBrowserPresentationStyle.AUTOMATIC,
      });
    } catch {
      showToast({
        variant: 'warning',
        title: t`Could not open the link`,
        message: ICP_REGISTRATION_URL,
      });
    }
  }

  return (
    <PressableScale
      testID="settings-icp-registration"
      accessibilityRole="link"
      accessibilityLabel={number}
      onPress={() => void openRegistration()}
      style={[
        styles.link,
        {
          borderRadius: profile.chrome.control,
          backgroundColor: hasWallpaper ? background(theme.colors.background) : undefined,
        },
      ]}>
      <Text variant="caption" color={theme.colors.textMuted} style={styles.label}>
        {number}
      </Text>
      <ExternalLink size={12} color={theme.colors.textMuted} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  link: {
    alignSelf: 'center',
    maxWidth: '100%',
    minHeight: 44,
    paddingHorizontal: LADDER.gap,
    paddingVertical: LADDER.tight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: LADDER.tight,
  },
  label: { flexShrink: 1, textAlign: 'center', textDecorationLine: 'underline' },
});
