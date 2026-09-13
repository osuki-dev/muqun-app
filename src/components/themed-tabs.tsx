import { Tabs as BaseTabs, Text, useThemeTokens, type TabsProps } from '@osuki-dev/ui';
import { View } from 'react-native';

import { useSurfaceBackground, useSurfaceBackgroundOpacity } from '@/hooks/use-surface-background';

export type { TabsProps } from '@osuki-dev/ui';

/** Kit 1.0.1's public compound API keeps selection, haptics and labels intact. */
export function Tabs(props: TabsProps) {
  const theme = useThemeTokens();
  const background = useSurfaceBackground();
  const opacity = useSurfaceBackgroundOpacity();
  if (opacity === 1) return <BaseTabs {...props} />;
  const {
    options,
    value,
    onChange,
    variant = 'underline',
    size = 'default',
    style,
    testID,
    ...rest
  } = props;
  /**
   * One layer of paint per pixel, because two of them multiply.
   *
   * This whole re-implementation exists to put the pack's surface opacity on a
   * control the kit paints opaquely, and it was defeating itself: the list
   * painted a track at that opacity and the selected trigger painted another
   * surface at that opacity *on top of it*, so the wallpaper came through the
   * track at `1 - a` and through the selected segment at `(1 - a)²`. At the 0.8
   * a pack typically lands on, that is 20% against 4% -- the selected pill read
   * as the one control in the app that had ignored the setting, which is
   * exactly what it looked like.
   *
   * No stacking arrangement can fix that: as long as the track is painted under
   * the pill, the pill can never show as much of the picture as the track does.
   * So the track stops painting and each segment carries its own fill -- the
   * selected one `surface`, the rest what the track used to be. Adjacent fills
   * of the same colour read as the track they replace, and every segment now
   * shows the wallpaper at the same rate as everything else on the screen.
   */
  const trackFill =
    style?.backgroundColor ?? (variant === 'pill' ? theme.colors.surfaceRaised : 'transparent');
  return (
    <BaseTabs.Root value={value} onValueChange={onChange} variant={variant} size={size}>
      <BaseTabs.List {...rest} testID={testID} style={[style, { backgroundColor: 'transparent' }]}>
        {options.map((option) => {
          const selected = value === option.value;
          return (
            <BaseTabs.Trigger
              key={option.value}
              value={option.value}
              disabled={option.disabled}
              testID={testID ? `${testID}-tab-${option.value}` : undefined}
              style={{
                backgroundColor: background(
                  variant === 'pill'
                    ? selected
                      ? theme.colors.surface
                      : typeof trackFill === 'string'
                        ? trackFill
                        : theme.colors.surfaceRaised
                    : 'transparent'
                ),
              }}>
              <BaseTabs.Label>{option.label}</BaseTabs.Label>
              {option.badge !== undefined ? (
                <View
                  style={{
                    minWidth: 18,
                    height: 18,
                    borderRadius: theme.radius.pill,
                    paddingHorizontal: theme.spacing.xs,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: background(
                      selected ? theme.colors.primary : theme.colors.borderStrong
                    ),
                  }}>
                  <Text variant="caption" colorKey="onPrimary" numberOfLines={1}>
                    {option.badge}
                  </Text>
                </View>
              ) : null}
            </BaseTabs.Trigger>
          );
        })}
      </BaseTabs.List>
    </BaseTabs.Root>
  );
}
