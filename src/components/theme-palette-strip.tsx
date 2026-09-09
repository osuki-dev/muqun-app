import { View } from 'react-native';

import type { ThemeAppearance } from '@/constants/theme-packs';

/** A compact pair, shared by current-theme summaries and saved-theme rows. */
export function ThemePaletteStrip({ pack }: { pack: Pick<ThemeAppearance, 'light' | 'dark'> }) {
  return (
    <View accessible={false} style={{ flexDirection: 'row', gap: 4 }}>
      {(['light', 'dark'] as const).map((mode) => (
        <View
          key={mode}
          style={{
            width: 38,
            height: 28,
            borderRadius: 8,
            backgroundColor: pack[mode].colors.background,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <View
            style={{
              width: 10,
              height: 10,
              borderRadius: 5,
              backgroundColor: pack[mode].colors.primary,
            }}
          />
        </View>
      ))}
    </View>
  );
}
