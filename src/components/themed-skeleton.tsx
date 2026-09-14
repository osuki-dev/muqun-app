import { Skeleton as BaseSkeleton, useThemeTokens, type SkeletonProps } from '@osuki-dev/ui';
import { StyleSheet } from 'react-native';

import { useSurfaceBackground } from '@/hooks/use-surface-background';

export type { SkeletonProps } from '@osuki-dev/ui';

/**
 * Keep the kit's shapes, pulse and line arithmetic; only its single fill changes.
 *
 * The placeholder is a colored plane like any other, so it answers the pack's
 * background opacity. Before kit 1.1.0 it could not: the fill was the `border`
 * token, applied inside the component with no way in, so a reader who had asked
 * to see their artwork through the app got a wall of solid bars for as long as
 * a screen was loading -- the one surface that ignored the slider, and on the
 * screen where there was nothing else to look at.
 *
 * One layer of paint per placeholder, which is the reason this is a wrapper and
 * not a `style` prop repeated at twenty call sites. With `lines` above 1 the
 * kit paints the lines rather than the wrapper and routes `style.backgroundColor`
 * down to them, so a translucent fill lands once and the gaps between lines stay
 * empty instead of carrying a second copy of it.
 */
export function Skeleton({ style, ...props }: SkeletonProps) {
  const theme = useThemeTokens();
  const background = useSurfaceBackground();
  const override = StyleSheet.flatten(style)?.backgroundColor;
  const base = typeof override === 'string' ? override : theme.colors.border;
  return <BaseSkeleton {...props} style={[style, { backgroundColor: background(base) }]} />;
}
