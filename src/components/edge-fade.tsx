import { type StyleProp, View, type ViewStyle } from 'react-native';

import { withAlpha } from '@/lib/color';

/**
 * The soft edge of a scrolling region, painted in the surface's own colour.
 *
 * Horizontal edges came later than vertical ones and for the same reason: a
 * row that scrolls sideways with a hard edge reads as a clipped layout rather
 * than as more to come -- the agent composer's chips row ended mid-glyph on
 * `$0.0` for a cost of `$0.00`.
 */
export function EdgeFade({
  edge,
  color,
  style,
}: {
  edge: 'top' | 'bottom' | 'left' | 'right';
  color: string;
  style?: StyleProp<ViewStyle>;
}) {
  const horizontal = edge === 'left' || edge === 'right';
  const direction = horizontal ? 'to right' : 'to bottom';
  // `top` and `left` are the same ramp: opaque at the edge, gone by the far
  // side. `bottom` and `right` are its mirror.
  const opening = edge === 'top' || edge === 'left';
  const gradient = opening
    ? `linear-gradient(${direction}, ${withAlpha(color, 0.9)} 0%, ${withAlpha(color, 0.68)} 42%, ${withAlpha(color, 0.24)} 72%, ${withAlpha(color, 0)} 100%)`
    : `linear-gradient(${direction}, ${withAlpha(color, 0)} 0%, ${withAlpha(color, 0.12)} 42%, ${withAlpha(color, 0.48)} 72%, ${withAlpha(color, 0.9)} 100%)`;

  return <View pointerEvents="none" style={[style, { experimental_backgroundImage: gradient }]} />;
}
