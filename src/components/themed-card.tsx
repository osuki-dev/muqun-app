import { Card as BaseCard, useThemeTokens, type CardProps } from '@osuki-dev/ui';
import { StyleSheet } from 'react-native';
import { useSurfaceBackground } from '@/hooks/use-surface-background';

/** Keep the kit's layout, shadows and borders; only its single color fill changes. */
export function Card({ style, variant = 'default', ...props }: CardProps) {
  const theme = useThemeTokens();
  const background = useSurfaceBackground();
  const override = StyleSheet.flatten(style)?.backgroundColor;
  const base =
    typeof override === 'string'
      ? override
      : theme.colors[theme.components.Card[variant].background];
  return (
    <BaseCard {...props} variant={variant} style={[style, { backgroundColor: background(base) }]} />
  );
}
