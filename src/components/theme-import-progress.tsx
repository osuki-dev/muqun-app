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
  compact = false,
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
  /**
   * The bar alone, for a widget that lives inside a row.
   *
   * A row already says which theme is installing and, in its trailing slot,
   * what step the install is on -- so the block's own label line and its
   * transferred-bytes line would be the same two facts a second time, in a
   * place where every dp is a row getting taller. What is left is the one
   * thing the row cannot say in words: how far along it is. It is thinner
   * too, because a bar under a row's copy is an underline rather than a
   * widget; `label` stays required, and becomes what a screen reader hears
   * when it reaches the bar.
   */
  compact?: boolean;
  testID?: string;
}) {
  const { colors } = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();
  const measured = typeof completed === 'number' && typeof total === 'number' && total > 0;
  const transferred = receivedBytes ? formatAssetSize(receivedBytes) : '';

  if (compact) {
    // Nothing at all rather than an empty strip: an unmeasured phase has no
    // fraction to draw, and the row's trailing step name is already saying
    // that the wait is real. Same reasoning as the full block's `measured`.
    if (!measured) return null;
    return (
      <ThemeImportProgressBar
        // Keyed for the same reason as below: a new phase is a new
        // measurement, never the old bar asked to run backwards.
        key={phase ?? label}
        testID={testID}
        accessibilityLabel={label}
        compact
        completed={completed}
        total={total}
        track={surfaceBackground(colors.surfaceRaised)}
        fill={colors.primary}
      />
    );
  }

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

/** A bar heading a sheet: thin enough to be a rule, thick enough to read. */
const BAR_HEIGHT = 4;

/** And a bar underlining one row, which only has to be seen moving. */
const COMPACT_BAR_HEIGHT = 3;

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
  compact = false,
  accessibilityLabel,
  testID,
}: {
  completed: number;
  total: number;
  track: string;
  fill: string;
  /** Thinner, for a bar that underlines a row rather than heading a sheet. */
  compact?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}) {
  const fraction = Math.min(1, Math.max(0, completed / total));
  const filled = useSharedValue(fraction);
  useEffect(() => {
    filled.value = withTiming(fraction, timing('short'));
  }, [filled, fraction]);
  const fillStyle = useAnimatedStyle(() => ({ width: `${filled.value * 100}%` }));

  return (
    <Animated.View
      testID={testID}
      entering={fadeIn('micro')}
      exiting={fadeOut('micro')}
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: total, now: completed }}
      style={{
        height: compact ? COMPACT_BAR_HEIGHT : BAR_HEIGHT,
        borderRadius: compact ? COMPACT_BAR_HEIGHT / 2 : BAR_HEIGHT / 2,
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
