import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { ThemeArtwork } from '@/components/theme-artwork';
import { Trans, useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { Text } from '@/components/text';
import { Button } from '@/components/themed-button';
import { Stack, useRouter } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useHandedFileStage } from '@/hooks/use-theme-file-open';
import { ThemeImportProgress } from '@/components/theme-import-progress';

/**
 * Where a link that names nothing lands.
 *
 * Expo Router ships its own screen for this, and it is written for the person
 * building the app rather than the person holding it: an English "Unmatched
 * Route", a "Sitemap" link into the router's debug view, and the raw URL
 * printed in full.
 *
 * That last part is the reason this file exists rather than a nicety. The
 * gateway's pairing QR encodes `muqun://pair?u=…&s=…&k=…`, and `k` is the
 * transport key. A scanner that treats the code as a link, or a reader who
 * forwards one to themselves, arrives here -- and the default screen renders
 * that key at full size on a screen someone might be photographing or
 * screen-sharing. Whatever else this screen does, it must not repeat back what
 * it was given.
 *
 * So: say what happened, offer the one way out, and show nothing else.
 */
export default function NotFoundScreen() {
  const surfaceBackground = useSurfaceBackground();
  const { t } = useLingui();
  const theme = useThemeTokens();
  const router = useRouter();
  /**
   * A file the app is in the middle of opening is not a link that goes nowhere.
   *
   * The router has no route for `file://` or `content://`, so this screen is
   * what a theme handed over from a file manager lands on while it is read --
   * and reading a pack with artwork takes seconds, not milliseconds. Saying
   * "nothing was opened" over a file that is being opened is the single most
   * misleading thing this app says, and it is what made a working hand-off look
   * broken. So while that read is in flight, this screen waits with it.
   */
  const stage = useHandedFileStage();

  return (
    <>
      <Stack.Screen options={{ title: stage ? t`Opening` : t`Not found` }} />
      <View
        style={[styles.screen, { backgroundColor: surfaceBackground(theme.colors.background) }]}>
        <ThemeArtwork slot="shell.wallpaper" />
        {stage ? (
          <>
            <ActivityIndicator color={theme.colors.primary} />
            {/* The named step, and a real bar for the one step that can count.
                Staging a pack's images is where the seconds go -- ten photos
                are ten decodes and ten writes -- so that is the one worth a
                measure; reading and unpacking are single opaque waits and a
                bar stuck at zero over them reads as a failure. */}
            <View style={styles.progress}>
              <ThemeImportProgress
                testID="handed-file-progress"
                label={
                  stage.phase === 'staging'
                    ? t`Installing images`
                    : stage.phase === 'unpacking'
                      ? t`Reading the theme`
                      : t`Opening that file`
                }
                completed={stage.phase === 'staging' ? stage.completed : undefined}
                total={stage.phase === 'staging' ? stage.total : undefined}
              />
            </View>
          </>
        ) : (
          <>
            <Text variant="heading" style={styles.centered}>
              <Trans>This link goes nowhere</Trans>
            </Text>
            <Text variant="bodySmall" color={theme.colors.textMuted} style={styles.centered}>
              <Trans>
                It may be out of date, or meant for a different app. Nothing was opened.
              </Trans>
            </Text>
            {/* `dismissTo` rather than `back`: arriving from a cold start
                through a link leaves nothing behind to go back to, and a dead
                button on the screen that tells you something is dead reads as a
                second failure. */}
            <Button onPress={() => router.dismissTo('/')}>{t`Go to your servers`}</Button>
          </>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  screen: {
    alignItems: 'center',
    flex: 1,
    gap: 16,
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  centered: { textAlign: 'center' },
  // The measure the progress line reads against, so a bar is not the width of
  // the screen on a tablet.
  progress: { alignSelf: 'stretch', maxWidth: 360, width: '100%' },
});
