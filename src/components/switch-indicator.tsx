import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { useThemeTokens } from '@osuki-dev/ui';
import { Text } from '@/components/text';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { useNotificationSurfaceStyle } from '@/components/notification-surface';
import { useMonoFontFamily } from '@/hooks/use-user-fonts';
import { fadeIn, fadeOut, listLayout } from '@/lib/motion';
import { paneAddressText, type PaneAddress } from '@/lib/pane-address';

/**
 * What a switch just landed on, said once and then gone.
 *
 * One object for both gestures on purpose. A swipe of the title pill cycles
 * workspaces and a two-finger swipe of the pane cycles that workspace's tabs;
 * they are the same gesture at two levels, they answer the same question, and
 * two different-looking answers would be worse than a repeated one.
 *
 * It lives in the header's notice stack rather than over the middle of the pane
 * (card #665, overruling the argument that used to be written here). The pane
 * is what the reader is trying to see, and a pill in the middle of it covers
 * the first line of the thing the switch just brought into view. In the stack
 * it queues with the connection and error notices instead of landing on top of
 * them, and it reads as one of the screen's small standing announcements
 * because that is what it is.
 *
 * The address is set monospaced and the name is not, which is the panels
 * sheet's own treatment -- see `@/lib/pane-address` for why the switch borrows
 * the sheet's vocabulary rather than keeping its own.
 *
 * Purely presentational: it holds no timer and no gesture. What decides when an
 * address appears and when it goes back to `null` is the hook behind whichever
 * gesture fired.
 */
export function SwitchIndicator({ address, testID }: { address: PaneAddress; testID?: string }) {
  const surfaceBackground = useSurfaceBackground();
  const theme = useThemeTokens();
  const notificationSurfaceStyle = useNotificationSurfaceStyle(false);
  const mono = useMonoFontFamily();
  return (
    <Animated.View
      pointerEvents="none"
      entering={fadeIn('dropdown')}
      exiting={fadeOut('short')}
      layout={listLayout('short')}
      style={styles.anchor}>
      <View
        style={[
          styles.indicator,
          notificationSurfaceStyle,
          {
            backgroundColor: surfaceBackground(theme.colors.surfaceRaised),
            borderColor: theme.colors.border,
          },
        ]}>
        <Text
          variant="caption"
          color={theme.colors.textMuted}
          numberOfLines={1}
          testID={testID}
          style={[styles.address, { fontFamily: mono }]}>
          {paneAddressText(address)}
        </Text>
        <Text variant="caption" numberOfLines={1} color={theme.colors.text} style={styles.title}>
          {address.title}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Centred in the stack rather than stretched across it: the pill is as wide
  // as what it says, unlike the notices above it, which are bars.
  anchor: {
    alignSelf: 'center',
    maxWidth: '100%',
  },
  indicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 32,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
  // A pane address is `2:3` -- numbers the reader compares against the pill in
  // the header and against the panels sheet -- so it is a literal, and it now
  // takes its face from the reader's mono slot at the render site. It used to
  // name its own `MONO_FONT = Platform.OS === 'ios' ? 'ui-monospace' :
  // 'monospace'`, which is a statement about the platform and not about the
  // reader: a reader with their own mono face saw the panels sheet's address
  // column change and this pill, which is quoting that same column back at
  // them, stay behind.
  address: {
    fontVariant: ['tabular-nums'],
  },
  title: {
    flexShrink: 1,
    fontWeight: '600',
  },
});
