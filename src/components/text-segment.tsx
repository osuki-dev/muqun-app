import {
  Pressable,
  StyleSheet,
  type Insets,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useThemeTokens } from '@osuki-dev/ui';

import { appChrome } from '@/constants/appearance';
import { feedback, type FeedbackKind } from '@/lib/feedback';

/**
 * One tappable piece of a line of text: `→ computer · agent · folder`, or
 * `mode ⌄ · model ⌄` under it.
 *
 * Pressing it changes its tone and nothing else. It does not scale, and its
 * weight, size, padding and chevron stay the same, so the segments beside it
 * never move. (Pressing Build used to make the model chip next to it jitter.)
 */
export function TextSegment({
  feedback: feedbackKind = 'selection',
  onPressIn,
  style,
  ...props
}: Omit<PressableProps, 'style'> & {
  feedback?: FeedbackKind | false;
  style?: StyleProp<ViewStyle>;
}) {
  const { spacing } = useThemeTokens();
  const gaps = { gap: spacing.xs, paddingHorizontal: spacing.xs };
  return (
    <Pressable
      {...props}
      onPressIn={(event) => {
        if (!props.disabled && feedbackKind) void feedback(feedbackKind);
        onPressIn?.(event);
      }}
      style={({ pressed }) => [styles.segment, gaps, style, pressed && styles.pressed]}
    />
  );
}

/**
 * Touch room for a segment, which is shorter than a finger. The two rows sit
 * 2 pt apart (`spacing['2xs']`), so they meet halfway, 1 pt each, and never
 * overlap; the first row reaches up into the bar's top padding. The second
 * row's room reaches down over the gap and the field's top edge, where the
 * field (drawn later) still wins any touch inside its own box -- so what that
 * row really gets is its own line plus the gap, not 44 dp.
 */
export const SEGMENT_HIT_SLOP: Readonly<Record<'first' | 'next', Insets>> = {
  first: { top: 12, bottom: 1, left: 4, right: 4 },
  next: { top: 1, bottom: 25, left: 4, right: 4 },
};

/**
 * A row of segments starts one segment-padding to the left, so the first
 * segment's text, not its padding, lines up with the field and the cards'
 * rows below and above it.
 */
export function useSegmentRowLead() {
  const { spacing } = useThemeTokens();
  return { marginLeft: -spacing.xs };
}

const styles = StyleSheet.create({
  segment: {
    minWidth: 0,
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  pressed: { opacity: appChrome.opacity.pressed },
});
