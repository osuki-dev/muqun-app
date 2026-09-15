import { useLingui } from '@lingui/react/macro';
import { Text, useThemeTokens } from '@osuki-dev/ui';

import { Button } from '@/components/themed-button';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CustomThemeLibrary, type ThemePrimaryAction } from '@/components/custom-theme-library';
import { ScreenHeader } from '@/components/screen-header';
import { ThemeArtwork } from '@/components/theme-artwork';
import { CandidateThemeProvider } from '@/components/theme-candidate';
import { themeDraftSessions, type ThemeEditorCandidate } from '@/theme/draft-session';
import type { InstalledTheme } from '@/theme/repository';

/**
 * The theme being looked at, worn by the screen looking at it.
 *
 * This route used to be the applied theme's screen with the candidate's two
 * preview cards on it, which asked the reader to judge a theme from two
 * postage stamps surrounded by the theme they were replacing. Everything the
 * candidate can decide, it decides here: the floor, the shell wallpaper, the
 * header glass and its back arrow, the bar at the bottom and the button that
 * applies it.
 *
 * `CandidateThemeProvider` does both halves of that -- the kit tokens every
 * ordinary control is painted from, and the custom-theme context the artwork,
 * material and surface-opacity consumers read -- so the screen below it is the
 * screen it always was, with nothing in it that knows it is a preview. The two
 * preview cards keep painting themselves from the manifest: they show light and
 * dark at once, and only one of those can be the screen's own mode.
 */
export default function CustomThemeScreen() {
  const { draft } = useLocalSearchParams<{ draft?: string }>();
  const candidate = typeof draft === 'string' ? themeDraftSessions.get(draft) : undefined;
  const [appearance, setAppearance] = useState<InstalledTheme | undefined>();
  useEffect(() => {
    if (typeof draft === 'string') return themeDraftSessions.hold(draft);
  }, [draft]);
  if (!candidate) return <CustomThemeScene />;
  return (
    <CandidateThemeProvider
      manifest={candidate.manifest}
      assets={candidate.assets ?? candidate.prepared?.assets}
      appearance={
        appearance?.manifest === candidate.manifest
          ? appearance
          : {
              id: 'candidate',
              manifest: candidate.manifest,
              assets: candidate.assets ?? candidate.prepared?.assets ?? {},
              hideHomeLogo: true,
              hideHomeText: true,
            }
      }
      installationId={candidate.id}>
      <CustomThemeScene candidate={candidate} onPreviewAppearanceChange={setAppearance} />
    </CandidateThemeProvider>
  );
}

function CustomThemeScene({
  candidate,
  onPreviewAppearanceChange,
}: {
  candidate?: ThemeEditorCandidate;
  onPreviewAppearanceChange?: (appearance: InstalledTheme) => void;
}) {
  const { t } = useLingui();
  const router = useRouter();
  const theme = useThemeTokens();
  const insets = useSafeAreaInsets();
  const background = useSurfaceBackground();
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
  /**
   * The one button at the bottom is the one decision on this screen.
   *
   * The library used to draw its own Apply between the settings card and the
   * export card, with this screen's Done pinned below it: two confirm-ish
   * controls for one theme, and the one that mattered was the one you had to
   * scroll to find. So the library hands the action over instead
   * (`onPrimaryActionChange`) and this screen draws it once, where the way out
   * already was. `setPrimary` is a `useState` setter, so its identity is stable
   * and the library reports again only when the action itself changes; the
   * action is an object rather than a function, so it is never mistaken for a
   * state updater.
   *
   * Until the first report lands -- and when there is no theme to confirm --
   * the button is what it has always been: Done, which closes.
   */
  const [primary, setPrimary] = useState<ThemePrimaryAction | null>(null);
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
              mode={candidate.id ? 'manage' : 'preview'}
              onPreviewAppearanceChange={onPreviewAppearanceChange}
              detail
              ownsPreparedAssets={false}
              onClosePreview={close}
              onPrimaryActionChange={setPrimary}
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
          middle of the page with content on both sides of it. It keeps the
          `custom-theme-done` id through the change of label: it is still the
          same control, the one that ends the visit. */}
      {candidate ? (
        <View
          style={{
            paddingHorizontal: 20,
            paddingTop: 12,
            paddingBottom: Math.max(12, insets.bottom),
            backgroundColor: background(theme.colors.surface),
          }}>
          <View style={{ width: '100%', maxWidth: 1120, alignSelf: 'center' }}>
            <Button
              testID="custom-theme-done"
              disabled={primary?.disabled ?? false}
              onPress={() => (primary ? primary.run() : close())}>
              {primary?.applies ? t`Apply theme` : t`Done`}
            </Button>
          </View>
        </View>
      ) : null}
    </View>
  );
}
