import { Text, useThemeTokens } from '@osuki-dev/ui';
import { useEffect, useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { formatAssetSize } from '@/lib/asset-display';
import { fadeIn, fadeOut, timing, travelTiming } from '@/lib/motion';

/**
 * The named step of a slow import, so waiting never looks like nothing.
 *
 * A step that knows its total draws a bar; one that does not draws its name
 * alone rather than a bar that cannot move. Fetching a manifest and installing
 * images are both single opaque waits, and a bar stuck at zero reads as failure.
 *
 * A compact bar -- the one drawn under a row of a native form sheet -- has no
 * exit animation. An exiting view is lifted out of the layout while it fades,
 * and under a row that means over the next row: a failed font download left
 * the bar, its label and its Cancel lying across "Paste a URL..." with the
 * error drawn through them. What replaces a compact bar fades *in*, which is
 * the softness the row needs without anything being out of flow.
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
  indeterminate = false,
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
   * Draw a wait that has no fraction as a segment travelling the track.
   *
   * Off by default, and every caller that does not ask for it keeps exactly
   * the behaviour it had: an unmeasured phase draws its name and no bar. That
   * is right for an install whose *other* phases are measured -- the theme
   * browser fetches one manifest and then counts twelve ZIP entries, so a
   * missing bar for two seconds is a pause in a widget that is otherwise
   * clearly working.
   *
   * It is wrong for a wait where nothing is ever measured, which is what a
   * font download from a server that sends no `Content-Length` is from the
   * first byte to the last. There the reader has a row that says a word and
   * never moves, and the honest thing to draw is not a fraction the app does
   * not have but the fact that something is still happening. Hence a mode
   * rather than a second component: one bar, two ways of not knowing.
   */
  indeterminate?: boolean;
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
    // Unless the caller has said that this wait is never measured, in which
    // case a travelling segment is the only thing that can say it is alive.
    if (!measured) {
      if (!indeterminate) return null;
      return (
        <ThemeImportTravellingBar
          testID={testID}
          accessibilityLabel={label}
          compact
          track={surfaceBackground(colors.surfaceRaised)}
          fill={colors.primary}
        />
      );
    }
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
      ) : indeterminate ? (
        <ThemeImportTravellingBar
          accessibilityLabel={label}
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
 * How much of the track the travelling segment covers.
 *
 * A third: long enough to read as an object rather than a dot, short enough
 * that there is visibly track on either side of it -- which is the difference
 * between "still working" and "nearly full".
 */
const TRAVEL_SEGMENT = 0.34;

/**
 * The still segment's opacity, for a reader who has asked for reduced motion.
 *
 * Below the fill's own strength on purpose: a solid full-width bar at full
 * opacity is what a *finished* determinate bar looks like, and this one is not
 * finished, it is unknowable. A dimmed, charged track says waiting without
 * claiming a fraction and without moving anything.
 */
const STILL_FILL_OPACITY = 0.45;

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
      exiting={compact ? undefined : fadeOut('micro')}
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

/**
 * The same groove, with a segment crossing it instead of a fill growing.
 *
 * For the wait that has no fraction at all. It is a sibling of the bar above
 * rather than a mode inside it because the two share nothing but their
 * geometry: one animates a width towards a number it is given, the other
 * animates a position on a loop that no number controls.
 *
 * The loop is one `withRepeat`, and it is cancelled on unmount. An endless
 * repeat outlives the view it drives -- `agent-thinking-indicator.tsx` carries
 * the same note -- so a reader who leaves the sheet mid-download would leave a
 * timer running against nothing for the rest of the session.
 *
 * The pass restarts rather than reversing, and the jump is invisible: the
 * segment leaves the right-hand end completely (it travels the track's width
 * *plus* its own) before the value wraps, and the parent clips. A reversing
 * segment would be a thing bouncing between two walls, which reads as
 * something stuck rather than something continuing.
 *
 * Under Reduce Motion nothing travels at all. Not a slower loop -- a loop is
 * the one shape of animation the setting is most directly about -- so the
 * track takes a dimmed fill across its whole width and stays there, and the
 * busy state below is what tells a reader using a screen reader the same
 * thing.
 */
function ThemeImportTravellingBar({
  track,
  fill,
  compact = false,
  accessibilityLabel,
  testID,
}: {
  track: string;
  fill: string;
  compact?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}) {
  const reduceMotion = useReducedMotion();
  // The track's own width, because a percentage `translateX` is not something
  // every platform under this app agrees about, and a segment that has to be
  // clipped at both ends has to know where the ends are.
  const [trackWidth, setTrackWidth] = useState(0);
  const travel = useSharedValue(0);
  const height = compact ? COMPACT_BAR_HEIGHT : BAR_HEIGHT;
  const segmentWidth = trackWidth * TRAVEL_SEGMENT;

  useEffect(() => {
    if (reduceMotion || trackWidth === 0) return;
    travel.value = 0;
    travel.value = withRepeat(withTiming(1, travelTiming()), -1, false);
    return () => cancelAnimation(travel);
  }, [reduceMotion, trackWidth, travel]);

  const travelStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -segmentWidth + travel.value * (trackWidth + segmentWidth) }],
  }));

  function measure(event: LayoutChangeEvent) {
    const next = Math.round(event.nativeEvent.layout.width);
    setTrackWidth((current) => (current === next ? current : next));
  }

  return (
    <Animated.View
      testID={testID}
      entering={fadeIn('micro')}
      exiting={compact ? undefined : fadeOut('micro')}
      onLayout={measure}
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      // No `accessibilityValue`: there is no fraction, and inventing one is
      // the fabricated progress the app is not allowed to show. `busy` is the
      // true statement available here.
      accessibilityState={{ busy: true }}
      style={{
        height,
        borderRadius: height / 2,
        overflow: 'hidden',
        backgroundColor: track,
      }}>
      {reduceMotion ? (
        <View style={{ height: '100%', backgroundColor: fill, opacity: STILL_FILL_OPACITY }} />
      ) : (
        <Animated.View
          style={[
            {
              height: '100%',
              width: segmentWidth,
              borderRadius: height / 2,
              backgroundColor: fill,
            },
            travelStyle,
          ]}
        />
      )}
    </Animated.View>
  );
}
