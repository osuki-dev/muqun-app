import { PressableScale, Text, useThemeTokens, type SegmentedControlProps } from '@osuki-dev/ui';
import { View, type ViewStyle } from 'react-native';
import { flattenStyle } from '@/lib/flatten-style';

import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { useSurfaceBackground } from '@/hooks/use-surface-background';

/**
 * The app's segmented control: the kit's `SegmentedControl` layout, with each
 * option pressed through `PressableScale` (a 0.96 dip and the selection tick).
 *
 * Kept because the kit's segments are plain `Pressable`s that dim to 0.72
 * while held and cannot take the app's press feedback. Track and selection
 * fills follow the reader's surface opacity, each painted at it, as the app
 * has always drawn them.
 */
export function SegmentedControl(props: SegmentedControlProps) {
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();
  const background = useSurfaceBackground();
  const { options, value, onChange, variant = 'rounded', style, testID, ...rest } = props;
  const fill = flattenStyle<ViewStyle>(style)?.backgroundColor ?? theme.colors.surfaceRaised;
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
