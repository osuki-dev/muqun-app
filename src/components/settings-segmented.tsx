/**
 * The settings page's segmented control: colour mode, terminal text size, and
 * the agent view default when its flag is on.
 *
 * It is `@osuki-dev/ui`'s `Tabs` -- the same list chrome, the same triggers, the
 * same 11pt all-caps labels, the same `accessibilityRole="tab"` and
 * `selected` state the e2e flow asserts on. Nothing about the look is
 * re-decided here. What is added is the one thing the library has no opinion
 * about: the selected pill *moves*.
 *
 * `Tabs` paints selection by giving whichever trigger is current a `surface`
 * fill, so switching is a cut -- the fill leaves one segment and appears on
 * another on the same frame, which on a control the finger is resting on reads
 * as a redraw rather than as an answer. Here the fill is lifted out into a
 * single view underneath the row, the triggers are made transparent, and that
 * one view slides. The colour, the radius and the geometry are still the
 * library's; only its position is ours.
 *
 * Built out of `Tabs.Root` / `Tabs.List` / `Tabs.Trigger` / `Tabs.Label`, which
 * is what the compound API is for -- so this cannot drift from `Tabs` when
 * `Tabs` changes.
 */
import { Tabs, useThemeTokens } from '@osuki-dev/ui';
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { INSTANT, PRESET, timing } from '@/lib/motion';
import { useRenderTally } from '@/lib/render-tally';

/**
 * `TabsList`'s own padding and inter-trigger gap, both `spacing.xs`, and the
 * compact trigger's height. Read off `tabs.tsx` rather than guessed: the pill
 * has to land exactly where the trigger it is marking sits, and a point out is
 * visible.
 */
const TRACK_PADDING = 4;
const TRACK_GAP = 4;
const SEGMENT_HEIGHT = 40;

export type SegmentedOption = { label: string; value: string };

export function SettingsSegmented({
  options,
  value,
  onChange,
  testID,
}: {
  options: SegmentedOption[];
  value: string;
  onChange: (value: string) => void;
  testID?: string;
}) {
  const theme = useThemeTokens();
  useRenderTally('SettingsSegmented');
  const [trackWidth, setTrackWidth] = useState(0);

  const count = options.length;
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value)
  );
  const segment =
    trackWidth > 0 ? (trackWidth - TRACK_PADDING * 2 - TRACK_GAP * (count - 1)) / count : 0;

  const offset = useSharedValue(0);
  // Zero until the track has been measured, so the first placement is a jump to
  // the right answer rather than a slide out of the left edge -- the pill would
  // otherwise animate in from x=0 on the frame after layout, every time the
  // screen mounts.
  const placed = useSharedValue(0);

  useEffect(() => {
    if (segment <= 0) return;
    const next = TRACK_PADDING + index * (segment + TRACK_GAP);
    if (placed.value === 0) {
      placed.value = 1;
      offset.value = next;
      return;
    }
    offset.value = withTiming(next, timing(PRESET.segmented));
  }, [index, offset, placed, segment]);

  // The pill is hidden until it has somewhere to be. `INSTANT` rather than a
  // literal zero-duration timing so the one un-animated value on the screen is
  // still spelled as motion.
  const opacity = useSharedValue(0);
  useEffect(() => {
    opacity.value = segment > 0 ? withTiming(1, INSTANT) : 0;
  }, [opacity, segment]);

  const pillStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: offset.value }],
  }));

  return (
    <Tabs.Root value={value} onValueChange={onChange} variant="pill" size="compact">
      <Tabs.List
        testID={testID}
        onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.pill,
            {
              width: segment,
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radius.pill,
            },
            pillStyle,
          ]}
        />
        {options.map((option) => (
          <Tabs.Trigger key={option.value} value={option.value} style={styles.trigger}>
            <Tabs.Label>{option.label}</Tabs.Label>
          </Tabs.Trigger>
        ))}
      </Tabs.List>
    </Tabs.Root>
  );
}

const styles = StyleSheet.create({
  pill: {
    position: 'absolute',
    left: 0,
    top: TRACK_PADDING,
    height: SEGMENT_HEIGHT,
  },
  // The trigger keeps its size, its radius and its label; it gives up only the
  // fill, which the pill above is now carrying.
  trigger: { backgroundColor: 'transparent' },
});
