import { useLingui } from '@lingui/react/macro';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CustomThemeLibrary } from '@/components/custom-theme-library';
import { ScreenHeader } from '@/components/screen-header';
import { ThemeArtwork } from '@/components/theme-artwork';
import { themeDraftSessions } from '@/theme/draft-session';

export default function CustomThemeScreen() {
  const { t } = useLingui();
  const router = useRouter();
  const { draft } = useLocalSearchParams<{ draft?: string }>();
  const candidate = typeof draft === 'string' ? themeDraftSessions.get(draft) : undefined;
  const theme = useThemeTokens();
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (typeof draft === 'string') return themeDraftSessions.hold(draft);
  }, [draft]);
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Stack.Screen options={{ title: candidate?.manifest.name ?? t`Theme` }} />
      <ThemeArtwork slot="shell.background" />
      <ScreenHeader title={candidate?.manifest.name ?? t`Theme`} />
      <ScrollView
        testID="custom-theme-editor"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 24 }}>
        <View style={{ width: '100%', maxWidth: 1120, alignSelf: 'center' }}>
          {candidate ? (
            <CustomThemeLibrary
              initialCandidate={candidate}
              detail
              ownsPreparedAssets={false}
              onClosePreview={() => router.back()}
            />
          ) : (
            <Text>{t`Not found`}</Text>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
