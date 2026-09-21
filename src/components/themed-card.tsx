import { Card as BaseCard, useThemeTokens, type CardProps } from '@osuki-dev/ui';
import { StyleSheet } from 'react-native';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { useAppearanceProfile } from '@/components/appearance-profile-provider';

/** Keep the kit's layout and palette; profiles own the shared surface geometry. */
export function Card({ style, variant = 'default', ...props }: CardProps) {
  const profile = useAppearanceProfile();
  const theme = useThemeTokens();
  const background = useSurfaceBackground();
  const override = StyleSheet.flatten(style)?.backgroundColor;
  const base =
    typeof override === 'string'
      ? override
      : theme.colors[theme.components.Card[variant].background];
  return (
    <BaseCard
      {...props}
      variant={variant}
      style={[style, { backgroundColor: background(base) }, { borderRadius: profile.chrome.card }]}
    />
  );
}
