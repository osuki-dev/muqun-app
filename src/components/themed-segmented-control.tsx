import {
  SegmentedControl as BaseSegmentedControl,
  Text,
  useThemeTokens,
  type SegmentedControlProps,
} from '@osuki-dev/ui';
import { View } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { useSurfaceBackground, useSurfaceBackgroundOpacity } from '@/hooks/use-surface-background';

export type { SegmentedControlProps } from '@osuki-dev/ui';

/**
 * Kit 1.0.1 exposes only the outer style, not its selected fill. SDK 57's
 * community iOS Picker also ignores tintColor. Keep that native control for
 * default themes; custom translucency uses the kit's platform-neutral layout
 * with independently painted backgrounds and the app's reduced-motion policy.
 */
export function SegmentedControl(props: SegmentedControlProps) {
  const theme = useThemeTokens();
  const background = useSurfaceBackground();
  const opacity = useSurfaceBackgroundOpacity();
  if (opacity === 1) return <BaseSegmentedControl {...props} />;
  const { options, value, onChange, variant = 'rounded', style, testID, ...rest } = props;
  const fill = style?.backgroundColor ?? theme.colors.surfaceRaised;
  return (
    <View
      {...rest}
      accessibilityRole="tablist"
      testID={testID}
      style={[
        {
          flexDirection: 'row',
          height: 44,
          borderRadius: variant === 'pill' ? 999 : 14,
          padding: 4,
          overflow: 'hidden',
          ...(theme.mode === 'light' ? theme.shadow.soft : {}),
        },
        style,
        { backgroundColor: typeof fill === 'string' ? background(fill) : fill },
      ]}>
      {options.map((option) => {
        const selected = option.value === value;
        const disabled = option.disabled ?? false;
        return (
          <PressableScale
            key={option.value}
            testID={testID ? `${testID}-option-${option.value}` : undefined}
            accessibilityRole="tab"
            accessibilityLabel={option.label}
            accessibilityState={{ selected, disabled }}
            disabled={disabled}
            pressedScale={0.96}
            onPress={() => onChange(option.value)}
            style={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 999,
              backgroundColor: background(selected ? theme.colors.surface : 'transparent'),
              ...(selected && theme.mode === 'light' ? theme.shadow.pill : {}),
              opacity: disabled ? 0.4 : 1,
            }}>
            <Text
              variant="label"
              color={selected ? theme.colors.text : theme.colors.textMuted}
              transform="uppercase">
              {option.label}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}
