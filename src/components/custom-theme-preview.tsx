import { useLingui } from '@lingui/react/macro';
import { Text } from '@osuki-dev/ui';
import { View } from 'react-native';

import type { ThemeManifest } from '@/theme/schema';
import { resolveHomeIdentity } from '@/theme/resolve';
import { ThemeArtworkLayer } from '@/components/theme-artwork';

/** Fictional, noninteractive content: preview never changes global providers or connects a terminal. */
export function CustomThemePreview({
  manifest,
  assets = {},
}: {
  manifest: ThemeManifest;
  assets?: Record<string, string>;
}) {
  const { t } = useLingui();
  const identity = resolveHomeIdentity(manifest);
  return (
    <View testID="custom-theme-preview" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
      {(['light', 'dark'] as const).map((mode) => {
        const { colors, terminal } = manifest.variants[mode];
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
              manifest={manifest}
              assets={assets}
              slot="home.background"
              fallbackSlot="shell.background"
              mode={mode}
            />
            <Text variant="caption" color={colors.textMuted}>
              {mode === 'light' ? t`Light` : t`Dark`}
            </Text>
            {identity.name ? (
              <Text numberOfLines={2} color={colors.text}>
                {identity.name}
              </Text>
            ) : null}
            <View
              style={{ padding: 12, gap: 8, borderRadius: 12, backgroundColor: colors.surface }}>
              <Text variant="bodySmall" color={colors.text}>{t`Preview`}</Text>
              <View style={{ backgroundColor: colors.primary, padding: 8, borderRadius: 8 }}>
                <Text variant="caption" color={colors.onPrimary}>{t`Connect`}</Text>
              </View>
            </View>
            <View
              style={{
                padding: 12,
                gap: 8,
                borderRadius: 12,
                backgroundColor: terminal.background,
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
