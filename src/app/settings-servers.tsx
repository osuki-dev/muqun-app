import { useLingui } from '@lingui/react/macro';
import { useThemeMode, useThemeTokens } from '@osuki-dev/ui';
import { StatusBar } from 'expo-status-bar';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NAV_HEADER_CONTROL_SIZE } from '@/components/nav-header';
import { ScreenHeader } from '@/components/screen-header';
import { LADDER } from '@/components/settings-chrome';
import { SettingsServers } from '@/components/settings-servers';
import { ThemeArtwork } from '@/components/theme-artwork';
import { NAV_HEADER_TOP_GAP } from '@/constants/nav-header';
import { useSurfaceBackground } from '@/hooks/use-surface-background';

const CONTENT_MAX_WIDTH = 760;

export default function SettingsServersScreen() {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const { resolvedMode } = useThemeMode();
  const background = useSurfaceBackground();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.page, { backgroundColor: background(theme.colors.background) }]}>
      <ThemeArtwork slot="shell.wallpaper" />
      <StatusBar animated style={resolvedMode === 'dark' ? 'light' : 'dark'} />
      <ScrollView
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + NAV_HEADER_TOP_GAP + NAV_HEADER_CONTROL_SIZE + 8 + LADDER.gap,
            paddingBottom: insets.bottom + LADDER.gap,
          },
        ]}>
        <SettingsServers title={t`Servers`} />
      </ScrollView>
      <ScreenHeader title={t`Servers`} contentMaxWidth={CONTENT_MAX_WIDTH} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: {
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
    paddingHorizontal: LADDER.gap,
  },
});
