import { useLingui } from '@lingui/react/macro';
import { Text } from '@osuki-dev/ui';
import { Image } from 'expo-image';
import { View } from 'react-native';

import type { ThemeManifest } from '@/theme/schema';
import { resolveHomeIdentity } from '@/theme/resolve';
import { ThemeArtworkLayer } from '@/components/theme-artwork';
import { resolveArtworkOpacity, safeArtworkOpacity } from '@/theme/artwork-contrast';
import { terminalBackgroundFill } from '@/terminal/background';
import { surfaceBackgroundFill, surfaceBackgroundOpacity } from '@/theme/surface-background';
import { clampThemeOpacity, jointArtworkOpacity } from '@/theme/opacity-policy';

/** Fictional, noninteractive content: preview never changes global providers or connects a terminal. */
export function CustomThemePreview({
  manifest: authoredManifest,
  assets = {},
}: {
  manifest: ThemeManifest;
  assets?: Record<string, string>;
}) {
  const { t } = useLingui();
  const manifest = clampThemeOpacity(authoredManifest);
  const identity = resolveHomeIdentity(manifest);
  const logo =
    identity.logo?.mode === 'default'
      ? require('../../assets/images/loading-mark.png')
      : identity.logo?.mode === 'custom' && assets[identity.logo.asset]?.startsWith('file:///')
        ? { uri: assets[identity.logo.asset] }
        : null;
  return (
    <View testID="custom-theme-preview" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
      {(['light', 'dark'] as const).map((mode) => {
        const { colors, terminal } = manifest.variants[mode];
        const opacity = surfaceBackgroundOpacity(
          manifest.variants[mode].surfaces?.backgroundOpacity
        );
        const background = (color: string) => surfaceBackgroundFill(color, opacity);
        return (
          <View
            key={mode}
            style={{
              flex: 1,
              minWidth: 140,
              gap: 12,
              padding: 16,
              borderRadius: 18,
              backgroundColor: colors.background,
              overflow: 'hidden',
            }}>
            <ThemeArtworkLayer
              viewport="compact"
              manifest={manifest}
              assets={assets}
              slot="home.background"
              fallbackSlot="shell.background"
              mode={mode}
            />
            <Text
              variant="caption"
              color={colors.textMuted}
              style={{
                alignSelf: 'flex-start',
                backgroundColor: background(colors.background),
                paddingHorizontal: 6,
                paddingVertical: 3,
                borderRadius: 6,
              }}>
              {mode === 'light' ? t`Light` : t`Dark`}
            </Text>
            {identity.showBrand ? (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  padding: 8,
                  borderRadius: 10,
                  overflow: 'hidden',
                  backgroundColor: background(colors.surfaceRaised),
                }}>
                <ThemeArtworkLayer
                  viewport="compact"
                  manifest={manifest}
                  assets={assets}
                  slot="navigation.background"
                  mode={mode}
                  opacityLimit={jointArtworkOpacity(resolveArtworkOpacity(colors), opacity)}
                />
                {logo ? (
                  <Image
                    source={logo}
                    contentFit="contain"
                    accessible={false}
                    style={{ width: 28, height: 28 }}
                  />
                ) : null}
                {identity.name ? (
                  <Text numberOfLines={2} color={colors.text} style={{ flex: 1 }}>
                    {identity.name}
                  </Text>
                ) : null}
              </View>
            ) : null}
            <ThemeArtworkLayer
              viewport="compact"
              manifest={manifest}
              assets={assets}
              slot="home.decoration"
              mode={mode}
              banner
            />
            <View
              style={{
                padding: 12,
                gap: 8,
                borderRadius: 12,
                overflow: 'hidden',
                backgroundColor: background(colors.surface),
              }}>
              <ThemeArtworkLayer
                viewport="compact"
                manifest={manifest}
                assets={assets}
                slot="cards.decoration"
                mode={mode}
                opacityLimit={jointArtworkOpacity(
                  resolveArtworkOpacity({ ...colors, surfaceRaised: colors.surface }),
                  opacity
                )}
              />
              <Text variant="bodySmall" color={colors.text}>{t`Preview`}</Text>
              <View
                style={{
                  backgroundColor: background(colors.primary),
                  padding: 8,
                  borderRadius: 8,
                  overflow: 'hidden',
                }}>
                <ThemeArtworkLayer
                  viewport="compact"
                  manifest={manifest}
                  assets={assets}
                  slot="buttons.primary.background"
                  mode={mode}
                  opacityLimit={jointArtworkOpacity(
                    safeArtworkOpacity(colors.primary, [{ color: colors.onPrimary, minimum: 4.5 }]),
                    opacity
                  )}
                />
                <Text variant="caption" color={colors.onPrimary}>{t`Connect`}</Text>
              </View>
            </View>
            <View
              style={{
                padding: 12,
                gap: 8,
                borderRadius: 12,
                backgroundColor: terminalBackgroundFill(terminal),
              }}>
              <Text variant="caption" color={terminal.foreground}>
                {'$ bun test'}
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 3 }}>
                {terminal.ansi.map((color, index) => (
                  <View
                    key={index}
                    style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: color }}
                  />
                ))}
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}
