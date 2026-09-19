import { memo } from 'react';
import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { useThemeTokens } from '@osuki-dev/ui';
import { withAlpha } from '@/lib/color';

export interface OpenCodeIconProps {
  size?: number;
  color?: string;
  subtleColor?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Official OpenCode brand logo.
 * A 2:3 vertical block with 1/3 top block and 2/3 bottom block.
 */
export const OpenCodeIcon = memo(function OpenCodeIcon({
  size = 18,
  color,
  subtleColor,
  style,
}: OpenCodeIconProps) {
  const theme = useThemeTokens();
  const topColor = color ?? theme.colors.text;
  const bottomColor = subtleColor ?? withAlpha(topColor, 0.45);

  const width = Math.round((size * 2) / 3);
  const height = size;
  const topHeight = Math.round(height / 3);
  const bottomHeight = height - topHeight;

  return (
    <View
      style={[
        styles.container,
        {
          width,
          height,
          borderRadius: Math.max(1, Math.round(size / 12)),
        },
        style,
      ]}>
      <View
        style={[
          styles.topBlock,
          {
            height: topHeight,
            backgroundColor: topColor,
          },
        ]}
      />
      <View
        style={[
          styles.bottomBlock,
          {
            height: bottomHeight,
            backgroundColor: bottomColor,
          },
        ]}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  topBlock: {
    width: '100%',
  },
  bottomBlock: {
    width: '100%',
  },
});
