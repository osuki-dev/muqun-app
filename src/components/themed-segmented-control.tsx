import { useThemeTokens, type SegmentedControlProps } from '@osuki-dev/ui';
import { Text } from '@/components/text';
import { View } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { useSurfaceBackground } from '@/hooks/use-surface-background';

export type { SegmentedControlProps } from '@osuki-dev/ui';

/**
 * The kit exposes only the outer style, not selected geometry or fill. Use
 * its platform-neutral layout for every profile so both surfaces follow the
 * profile, translucency and the app's reduced-motion policy without remounting
 * when appearance changes. An explicit pill remains a pill.
 */
export function SegmentedControl(props: SegmentedControlProps) {
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();
  const background = useSurfaceBackground();
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
          padding: 4,
          overflow: 'hidden',
          ...(theme.mode === 'light' ? theme.shadow.soft : {}),
        },
        style,
        {
          backgroundColor: typeof fill === 'string' ? background(fill) : fill,
          borderRadius: variant === 'pill' ? profile.radius.pill : profile.chrome.segmentedTrack,
        },
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
            feedback="selection"
            pressedScale={0.96}
            onPress={() => onChange(option.value)}
            style={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius:
                variant === 'pill' ? profile.radius.pill : profile.chrome.segmentedOption,
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
