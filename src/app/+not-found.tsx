import { Trans, useLingui } from '@lingui/react/macro';
import { Button, Text, useThemeTokens } from '@osuki-dev/ui';
import { Stack, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

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
  const { t } = useLingui();
  const theme = useThemeTokens();
  const router = useRouter();

  return (
    <>
      <Stack.Screen options={{ title: t`Not found` }} />
      <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
        <Text variant="heading" style={styles.centered}>
          <Trans>This link goes nowhere</Trans>
        </Text>
        <Text variant="bodySmall" color={theme.colors.textMuted} style={styles.centered}>
          <Trans>
            It may be out of date, or meant for a different app. Nothing was opened.
          </Trans>
        </Text>
        {/* `dismissTo` rather than `back`: arriving from a cold start through a
            link leaves nothing behind to go back to, and a dead button on the
            screen that tells you something is dead reads as a second failure. */}
        <Button onPress={() => router.dismissTo('/')}>{t`Go to your servers`}</Button>
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
});
