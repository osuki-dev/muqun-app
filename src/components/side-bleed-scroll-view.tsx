import { ScrollView, type ScrollViewProps } from 'react-native';

import { useSideBleed } from '@/hooks/use-side-insets';

/**
 * A horizontal row that runs under a side status bar (iPhone Duo) to the
 * glass and rests clear of it: see `useSideBleed`. A component rather than
 * the hook at the call site, because the containers that set the bleed (a
 * sheet scene) are often rendered by the same component as the row.
 *
 * `leading` and `trailing` are the row's own content padding at each end,
 * which the bleed adds to; with no side inset the row is exactly as before.
 */
export function SideBleedScrollView({
  style,
  contentContainerStyle,
  leading = 0,
  trailing = 0,
  ...props
}: Omit<ScrollViewProps, 'horizontal'> & { leading?: number; trailing?: number }) {
  const bleed = useSideBleed();
  return (
    <ScrollView
      {...props}
      horizontal
      style={[style, bleed.frame]}
      contentContainerStyle={[
        contentContainerStyle,
        {
          paddingLeft: leading + bleed.content.paddingLeft,
          paddingRight: trailing + bleed.content.paddingRight,
        },
      ]}
    />
  );
}
