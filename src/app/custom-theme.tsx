import { useLingui } from '@lingui/react/macro';
import { Text, useThemeTokens } from '@osuki-dev/ui';

import { Button } from '@/components/themed-button';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
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
  const background = useSurfaceBackground();
  useEffect(() => {
    if (typeof draft === 'string') return themeDraftSessions.hold(draft);
  }, [draft]);
  /**
   * Done closes the editor and everything it was opened on top of.
   *
   * `router.back()` put the reader back in the theme picker, which is not where
   * Done means to leave them: they came to look at one theme, and they are done
   * with it. The picker is a sheet this screen was pushed over, so dismissing
   * the stack lands back in Settings -- and when the editor was opened from a
   * file handed to the app from outside, there is no sheet behind it and this
   * simply closes the one modal.
   */
  const close = () => (router.canDismiss() ? router.dismissAll() : router.back());
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Stack.Screen options={{ title: candidate?.manifest.name ?? t`Theme` }} />
      <ThemeArtwork slot="shell.background" />
      <ScreenHeader title={candidate?.manifest.name ?? t`Theme`} />
      <ScrollView
        testID="custom-theme-editor"
        contentInsetAdjustmentBehavior="automatic"
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 20, paddingBottom: 20 }}>
        <View style={{ width: '100%', maxWidth: 1120, alignSelf: 'center' }}>
          {candidate ? (
            <CustomThemeLibrary
              initialCandidate={candidate}
              detail
              ownsPreparedAssets={false}
              onClosePreview={close}
            />
          ) : (
            <Text>{t`Not found`}</Text>
          )}
        </View>
      </ScrollView>
      {/* Pinned, because it is the way out and a way out that scrolls is one
          the reader has to go looking for. Everything above it is the theme --
          its preview, its sliders, its export and remove actions, and on a
          phone that is several screens of it -- so an inline Done sat in the
          middle of the page with content on both sides of it. */}
      {candidate ? (
        <View
          style={{
            paddingHorizontal: 20,
            paddingTop: 12,
            paddingBottom: Math.max(12, insets.bottom),
            backgroundColor: background(theme.colors.surface),
          }}>
          <View style={{ width: '100%', maxWidth: 1120, alignSelf: 'center' }}>
            <Button testID="custom-theme-done" onPress={close}>{t`Done`}</Button>
          </View>
        </View>
      ) : null}
    </View>
  );
}
