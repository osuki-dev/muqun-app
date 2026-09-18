import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { appChrome } from '@/constants/appearance';
import { fadeIn, fadeOut } from '@/lib/motion';

/**
 * A small pill that floats over the pane, says one thing, and goes.
 *
 * It answers a gesture that has just happened -- what am I looking at now --
 * and it is anchored over the middle of the surface the gesture acted on,
 * because that is where the eye already is.
 *
 * The terminal's pinch indicator (card #636) is the only thing left using it.
 * The tab and workspace switches used to share it and no longer do: card #665
 * moved those two into the header's notice stack, where they queue with the
 * connection and error notices instead of covering the output. Splitting the
 * component was the honest way to do that -- a pill that is sometimes absolute
 * and sometimes a stack child is two components wearing one name -- and the
 * pinch keeps this one unchanged, which is the whole point of the split.
 *
 * Purely presentational: it holds no timer and no gesture.
 */
export function TransientPill({
  label,
  bottomInset = 0,
  testID,
}: {
  label: string;
  /**
   * How much of the pane's bottom the composer is covering, so the pill stays
   * centred in what the reader can actually see rather than behind the keys.
   */
  bottomInset?: number;
  testID?: string;
}) {
  const surfaceBackground = useSurfaceBackground();
  const theme = useThemeTokens();
  return (
    <View pointerEvents="none" style={[styles.anchor, { bottom: bottomInset }]}>
      <Animated.View entering={fadeIn('dropdown')} exiting={fadeOut('short')}>
        <View
          style={[
            styles.indicator,
            {
              backgroundColor: surfaceBackground(theme.colors.primary),
              borderRadius: theme.radius.pill,
            },
          ]}>
          <Text
            variant="caption"
            numberOfLines={1}
            color={theme.colors.onPrimary}
            testID={testID}
            style={styles.indicatorText}>
            {label}
          </Text>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  anchor: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    // Above the pane's own chrome: the pill is an answer to a gesture that just
    // happened and must not arrive behind the thing it is describing.
    zIndex: 11,
    elevation: 11,
  },
  indicator: {
    maxWidth: '80%',
    /**
     * `minHeight` and a little vertical padding, rather than a hard 26.
     *
     * 26 is a 12pt caption's 16.8pt line box plus about 4.6 each side --
     * which is to say it is the system face measured once and then frozen
     * into the pill. A face with a taller ascent overruns it and the tops of
     * the digits are shaved by the pill's own bounds, so the reader's pinch
     * indicator reads 100% with its numerals cut. Identical at the default
     * face; it grows a point or two only under a face that needs it.
     */
    minHeight: 26,
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: appChrome.shadow.floatingPill,
  },
  indicatorText: {
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
});
