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
import { Platform, StyleSheet, Text as NativeText } from 'react-native';
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

/**
 * How the labels are cased.
 *
 * `sentence` is the default and the app's rule: a segment says "All models",
 * not "ALL MODELS". The kit's `Tabs.Label` carries `textTransform: 'uppercase'`
 * in its type style, which is a decision about signage rather than about this
 * control -- and it makes a proper noun unreadable as itself ("OPENCODE GO").
 * `uppercase` is kept so a caller that genuinely wants the kit's signage can
 * ask for it rather than forking the component.
 */
export type SegmentedCase = 'sentence' | 'uppercase';

export function SettingsSegmented({
  options,
  value,
  onChange,
  testID,
  textCase = 'sentence',
}: {
  options: SegmentedOption[];
  value: string;
  onChange: (value: string) => void;
  testID?: string;
  /** @default 'sentence' */
  textCase?: SegmentedCase;
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
        // The kit's own opaque `surfaceRaised` track, kept, and this is a
        // deliberate exception to the one-layer rule `themed-tabs.tsx` argues
        // at length.
        //
        // The rule is about surfaces: a card, a sheet, a row -- things the
        // reader's wallpaper is meant to show through. A control's track is
        // not one of those. It is a *mark*: it says where the choices are and
        // which half of them you are not on, and it has to stay legible
        // against any wallpaper a pack ships. Dropping it (which this file did
        // until now, whenever the surface slider was below 1) left the
        // unselected side with no fill at all, so the control read as one pill
        // floating on the page rather than as two segments with one chosen --
        // "这个应该是纯色的，做个区分".
        //
        // The pill above it is solid for the same reason and in the same
        // breath: a translucent pill on a solid track shows the track through
        // itself and the selected side goes muddy, which is the legibility
        // problem again one layer up. Two opaque fills, one mark.
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
          <Tabs.Trigger
            key={option.value}
            value={option.value}
            // Android's native driver omits selected. Expose the same source
            // state in a test identifier, without changing spoken labels.
            testID={`settings-selection:${option.value === value ? 'on' : 'off'}:${testID ?? 'segment'}-${option.value}`}
            style={styles.trigger}>
            {/[\u0e00-\u0e7f]/u.test(option.label) ? (
              // Use the system's Thai shaping and metrics rather than the
              // compact mono label's fitting pass, which clips final clusters.
              // No additional font is bundled and other scripts keep kit labels.
              <NativeText
                numberOfLines={1}
                maxFontSizeMultiplier={1.18}
                style={[
                  styles.thaiLabel,
                  {
                    color: option.value === value ? theme.colors.text : theme.colors.textMuted,
                    fontSize: theme.typeStyles.label.fontSize,
                    lineHeight: Math.ceil(theme.typeStyles.label.fontSize * 1.6),
                  },
                ]}>
                {option.label}
              </NativeText>
            ) : textCase === 'sentence' ? (
              // The kit's own label metrics, with its `textTransform` left off.
              // Written as a `Text` rather than by restyling `Tabs.Label`,
              // because the transform lives in the type style the label reads
              // and there is no prop on it to say no.
              <NativeText
                numberOfLines={1}
                maxFontSizeMultiplier={1.18}
                style={[
                  styles.sentenceLabel,
                  {
                    color: option.value === value ? theme.colors.text : theme.colors.textMuted,
                    fontSize: theme.typeStyles.label.fontSize,
                    lineHeight: Math.ceil(theme.typeStyles.label.fontSize * 1.4),
                    letterSpacing: theme.typeStyles.label.letterSpacing,
                  },
                ]}>
                {option.label}
              </NativeText>
            ) : (
              <Tabs.Label>{option.label}</Tabs.Label>
            )}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
    </Tabs.Root>
  );
}

const styles = StyleSheet.create({
  sentenceLabel: {
    fontWeight: '600',
    includeFontPadding: false,
    textAlign: 'center',
    flexShrink: 1,
  },
  thaiLabel: {
    fontFamily: Platform.OS === 'android' ? 'sans-serif' : undefined,
    fontWeight: '400',
    includeFontPadding: true,
    letterSpacing: 0,
    textAlign: 'center',
    flexShrink: 1,
  },
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
