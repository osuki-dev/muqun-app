import { useLingui as useLinguiRuntime } from '@lingui/react';
import { useLingui } from '@lingui/react/macro';
import { useThemeTokens, PressableScale, Text } from '@osuki-dev/ui';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { connectionStatusDescription } from '@/i18n/labels';
import type { GatewayRecord } from '@/lib/gateway-storage';
import { fadeIn, fadeOut, listLayout } from '@/lib/motion';
import { statusNeedsPairing, type ConnectionStatus } from '@/lib/server-reachability';

/**
 * What a computer that will not take this device's pairing any more says,
 * and the one thing that fixes it.
 *
 * Shown under a computer's status on Home and in Settings › Computers when
 * the status is `repair` (encryption was turned on for it after this device
 * paired) or `unauthorized` (it no longer holds this device's token). Both
 * are remedied the same way: pairing again, which opens the pairing screen
 * with the stored address of that computer already typed, so the reader only
 * has to enter the code the computer prints. A pairing that works again
 * replaces the record (same server id), and the notice goes with it.
 *
 * Fades in and out and lets the rows around it settle, like every other
 * state change on the card; it never pops into place.
 */
export function PairAgainNotice({
  status,
  server,
  testID,
}: {
  status: ConnectionStatus;
  server: GatewayRecord;
  testID?: string;
}) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const router = useRouter();
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();
  const surfaceBackground = useSurfaceBackground();
  if (!statusNeedsPairing(status)) return null;
  return (
    <Animated.View
      testID={testID}
      entering={fadeIn('micro')}
      exiting={fadeOut('micro')}
      layout={listLayout()}
      style={styles.notice}>
      <Text variant="caption" color={theme.colors.textMuted}>
        {_(connectionStatusDescription[status])}
      </Text>
      <View style={styles.actions}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t`Pair ${server.label} again`}
          testID={testID ? `${testID}-action` : undefined}
          feedback="selection"
          // Only the id: the pairing screen looks the address up from the
          // record it already holds, and never takes one off its route.
          onPress={() =>
            router.push({ pathname: '/explore', params: { serverId: server.serverId } })
          }
          style={[
            styles.action,
            {
              borderRadius: profile.chrome.control,
              backgroundColor: surfaceBackground(theme.colors.primarySubtle),
            },
          ]}>
          <Text variant="caption" weight="semibold" color={theme.colors.primary}>
            {t`Pair again`}
          </Text>
        </PressableScale>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  notice: { gap: 8, paddingTop: 2, paddingBottom: 4 },
  actions: { flexDirection: 'row' },
  action: {
    minHeight: 36,
    paddingHorizontal: 14,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
