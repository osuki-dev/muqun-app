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
  const fill =
    style?.backgroundColor ?? (variant === 'pill' ? theme.colors.surfaceRaised : 'transparent');
  return (
    <BaseTabs.Root value={value} onValueChange={onChange} variant={variant} size={size}>
      <BaseTabs.List
        {...rest}
        testID={testID}
        style={[style, { backgroundColor: typeof fill === 'string' ? background(fill) : fill }]}>
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
                  variant === 'pill' && selected ? theme.colors.surface : 'transparent'
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
