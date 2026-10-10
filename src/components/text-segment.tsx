import {
  Pressable,
  StyleSheet,
  type Insets,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

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
  return (
    <Pressable
      {...props}
      onPressIn={(event) => {
        if (!props.disabled && feedbackKind) void feedback(feedbackKind);
        onPressIn?.(event);
      }}
      style={({ pressed }) => [styles.segment, style, pressed && styles.pressed]}
    />
  );
}

/**
 * Touch room for a segment, which is shorter than a finger. The segments sit
 * in two rows a few points apart, so each row reaches outwards into the air
 * above or below it, and the two rows meet halfway between them rather than
 * overlap.
 */
export const SEGMENT_HIT_SLOP: Readonly<Record<'first' | 'next', Insets>> = {
  first: { top: 12, bottom: 2, left: 4, right: 4 },
  next: { top: 2, bottom: 4, left: 4, right: 4 },
};

const styles = StyleSheet.create({
  segment: {
    minWidth: 0,
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 4,
  },
  pressed: { opacity: appChrome.opacity.pressed },
});
