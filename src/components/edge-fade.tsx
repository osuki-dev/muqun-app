import { type StyleProp, View, type ViewStyle } from 'react-native';

import { withAlpha } from '@/lib/color';

export function EdgeFade({
  edge,
  color,
  style,
}: {
  edge: 'top' | 'bottom';
  color: string;
  style?: StyleProp<ViewStyle>;
}) {
  const top = edge === 'top';
  const gradient = top
    ? `linear-gradient(to bottom, ${withAlpha(color, 0.9)} 0%, ${withAlpha(color, 0.68)} 42%, ${withAlpha(color, 0.24)} 72%, ${withAlpha(color, 0)} 100%)`
    : `linear-gradient(to bottom, ${withAlpha(color, 0)} 0%, ${withAlpha(color, 0.12)} 42%, ${withAlpha(color, 0.48)} 72%, ${withAlpha(color, 0.9)} 100%)`;

  return (
    <View
      pointerEvents="none"
      style={[style, { experimental_backgroundImage: gradient }]}
    />
  );
}
