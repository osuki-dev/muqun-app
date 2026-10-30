import { useLingui } from '@lingui/react/macro';
import { Button, Text, useThemeMode, useThemeTokens } from '@osuki-dev/ui';
import { Image } from 'expo-image';
import { View } from 'react-native';

import { useAppearanceProfile } from './appearance-profile-provider';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { THEME_ARTWORK_SLOTS, type ThemeArtworkSlot } from '@/theme/artwork-overrides';
import {
  effectiveThemeAssets,
  effectiveThemeManifest,
  type InstalledTheme,
} from '@/theme/repository';
import { resolveLaunchArtwork } from '@/theme/launch-artwork';
import { resolveThemeImage, compileTheme } from '@/theme/resolve';

export function ThemeArtworkSettings({
  installed,
  disabled,
  onChoose,
  onReset,
}: {
  installed: InstalledTheme;
  disabled: boolean;
  onChoose: (slot: ThemeArtworkSlot) => void;
  onReset: (slot: ThemeArtworkSlot) => void;
}) {
  const { t } = useLingui();
  const { colors } = useThemeTokens();
  const { resolvedMode } = useThemeMode();
  const profile = useAppearanceProfile();
  const background = useSurfaceBackground();
  const manifest = effectiveThemeManifest(installed);
  const assets = effectiveThemeAssets(installed);
  const launch = resolveLaunchArtwork(compileTheme(manifest, installed.id), assets, resolvedMode);
  const home = resolveThemeImage(manifest, 'home.artwork', resolvedMode, 'compact');
  return (
    <View
      style={{
        gap: 16,
        marginTop: 12,
        padding: 12,
        borderRadius: profile.chrome.card,
        backgroundColor: background(colors.surfaceRaised),
      }}>
      <Text
        variant="caption"
        color={colors.textMuted}>{t`PNG, JPEG or WebP. Up to 8 MB and 16 megapixels.`}</Text>
      {THEME_ARTWORK_SLOTS.map((slot) => {
        const title = slot === 'launch.artwork' ? t`Launch image` : t`Home image`;
        const key = slot === 'launch.artwork' ? 'launch' : 'home';
        const uri =
          slot === 'launch.artwork'
            ? launch.kind === 'default'
              ? undefined
              : launch.uri
            : home
              ? assets[home.asset]
              : undefined;
        return (
          <View key={slot} style={{ gap: 8 }}>
            <Text weight="semibold">{title}</Text>
            {uri ? (
              <Image
                source={{ uri }}
                contentFit="contain"
                style={{ height: 120, width: '100%' }}
                accessible={false}
              />
            ) : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Button
                testID={`theme-image-${key}-pick`}
                accessibilityLabel={`${t`Choose image`}: ${title}`}
                disabled={disabled}
                onPress={() => onChoose(slot)}>{t`Choose image`}</Button>
              {installed.artworkImages?.[slot] ? (
                <Button
                  testID={`theme-image-${key}-reset`}
                  variant="ghost"
                  disabled={disabled}
                  onPress={() => onReset(slot)}>{t`Restore theme image`}</Button>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}
