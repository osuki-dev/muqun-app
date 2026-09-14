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
 *
 * And one thing here is allowed to jump. Progress is monotonic within a phase
 * but starts again at the boundary between them -- twelve ZIP entries done,
 * then nought of ten images -- and a bar that animates back to zero reads as
 * the install undoing itself. So the bar is keyed on the phase: at a boundary
 * React unmounts one and mounts the other, the old fades out, the new starts
 * already holding the new phase's value, and the reset happens in the gap
 * where there is nothing on screen to see it. The bar never travels backwards.
 */
export function ThemeImportProgress({
  label,
  phase,
  completed,
  total,
  receivedBytes,
  testID,
}: {
  label: string;
  /**
   * What is being counted, when that changes during one wait.
   *
   * Only an install with more than one counted phase needs to pass it; a
   * caller whose bar counts one thing from start to finish has one phase, and
   * its label is the name of it.
   */
  phase?: string;
  completed?: number;
  total?: number;
  receivedBytes?: number;
  testID?: string;
}) {
  const { colors } = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();
  const measured = typeof completed === 'number' && typeof total === 'number' && total > 0;
  const transferred = receivedBytes ? formatAssetSize(receivedBytes) : '';

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
        <ThemeImportProgressBar
          // The whole point of the key: a new phase is a new measurement, so
          // it is a new bar rather than the old one asked to run backwards.
          key={phase ?? label}
          completed={completed}
          total={total}
          track={surfaceBackground(colors.surfaceRaised)}
          fill={colors.primary}
        />
      ) : null}
      {transferred ? (
        <Text variant="caption" color={colors.textMuted}>
          {transferred}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * The bar, as its own component so that its value can be reset by being reborn.
 *
 * The shared value starts at whatever fraction this phase is already at, which
 * for a phase boundary is nought and for a remount mid-phase is where the
 * reader last saw it. Within a phase the fill slides on `'short'`; across one
 * the old bar is fading out while this one fades in, and neither of them ever
 * animates towards a smaller number.
 */
function ThemeImportProgressBar({
  completed,
  total,
  track,
  fill,
}: {
  completed: number;
  total: number;
  track: string;
  fill: string;
}) {
  const fraction = Math.min(1, Math.max(0, completed / total));
  const filled = useSharedValue(fraction);
  useEffect(() => {
    filled.value = withTiming(fraction, timing('short'));
  }, [filled, fraction]);
  const fillStyle = useAnimatedStyle(() => ({ width: `${filled.value * 100}%` }));

  return (
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
        backgroundColor: track,
      }}>
      <Animated.View style={[{ height: '100%', backgroundColor: fill }, fillStyle]} />
    </Animated.View>
  );
}
