import { Text, useThemeTokens } from '@osuki-dev/ui';
import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { formatAssetSize } from '@/lib/asset-display';
import { fadeIn, fadeOut, timing } from '@/lib/motion';

/**
 * The named step of a slow import, so waiting never looks like nothing.
 *
 * A step that knows its total draws a bar; one that does not draws its name
 * alone rather than a bar that cannot move. Fetching a manifest and installing
 * images are both single opaque waits, and a bar stuck at zero reads as failure.
 *
 * Nothing here swaps. The label cross-fades, so a changed string is not glyphs
 * replaced mid-sentence; the bar container fades in and out, because `measured`
 * flips at least twice in one install; and the fill slides, because `3/12` to
 * `4/12` arriving as a jump was the most visible hard edge in the whole path.
 * Every slow import in the app draws through here, so all of them get it.
 */
export function ThemeImportProgress({
  label,
  completed,
  total,
  receivedBytes,
  testID,
}: {
  label: string;
  completed?: number;
  total?: number;
  receivedBytes?: number;
  testID?: string;
}) {
  const { colors } = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();
  const measured = typeof completed === 'number' && typeof total === 'number' && total > 0;
  const fraction = measured ? Math.min(1, Math.max(0, completed / total)) : 0;
  const transferred = receivedBytes ? formatAssetSize(receivedBytes) : '';

  const filled = useSharedValue(fraction);
  useEffect(() => {
    filled.value = withTiming(fraction, timing('short'));
  }, [filled, fraction]);
  const fillStyle = useAnimatedStyle(() => ({ width: `${filled.value * 100}%` }));

  return (
    <View testID={testID} accessibilityLiveRegion="polite" style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        {/* Keyed on the label, so React replaces the node and the pair of
            fades actually runs. A phase name is a sentence changing, not a
            word being corrected. */}
        <Animated.View
          key={label}
          entering={fadeIn('micro')}
          exiting={fadeOut('micro')}
          style={{ flex: 1, minWidth: 0 }}>
          <Text variant="caption">{label}</Text>
        </Animated.View>
        {measured ? (
          <Text
            variant="caption"
            color={colors.textMuted}
            // Tabular, so the counter does not reflow while the bar moves.
            style={{ fontVariant: ['tabular-nums'] }}>
            {completed}/{total}
          </Text>
        ) : null}
      </View>
      {measured ? (
        <Animated.View
          entering={fadeIn('micro')}
          exiting={fadeOut('micro')}
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: total, now: completed }}
          style={{
            height: 4,
            borderRadius: 2,
            overflow: 'hidden',
            // The track is a surface and follows the reader's slider; the bar
            // that travels along it stays opaque, so the one thing this widget
            // exists to show reads at full strength against a translucent
            // groove. `update-status-banner.tsx` and `terminal-theme-drop.tsx`
            // split their track and fill the same way.
            backgroundColor: surfaceBackground(colors.surfaceRaised),
          }}>
          <Animated.View style={[{ height: '100%', backgroundColor: colors.primary }, fillStyle]} />
        </Animated.View>
      ) : null}
      {transferred ? (
        <Text variant="caption" color={colors.textMuted}>
          {transferred}
        </Text>
      ) : null}
    </View>
  );
}
