import { Tabs, useThemeTokens, type TabsProps } from '@osuki-dev/ui';
import type { ViewStyle } from 'react-native';

import { useSurfaceBackground, useSurfaceBackgroundOpacity } from '@/hooks/use-surface-background';
import { flattenStyle } from '@/lib/flatten-style';

/**
 * The kit's `pill` Tabs, with one layer of paint per pixel below full surface
 * opacity.
 *
 * The kit paints the track once and the selection over it. Under a translucent
 * policy the wallpaper then shows through the track at `1 - a` and through the
 * selected pill at `(1 - a)²`: at the 0.8 a pack typically lands on, 20% against
 * 4%, so the selected pill reads as the one control that ignored the setting.
 * No transform of the overlay can fix that while it sits on the track, so below
 * opacity 1 the track stays clear and each trigger carries its own fill -- the
 * selected one `surface`, the rest what the track would have been -- and every
 * segment shows the wallpaper at the same rate as everything else on screen.
 * At full opacity this is the kit's Tabs, untouched.
 */
export function PillTabs(props: TabsProps) {
  const theme = useThemeTokens();
  const background = useSurfaceBackground();
  const opacity = useSurfaceBackgroundOpacity();
  if (opacity === 1) return <Tabs {...props} variant="pill" />;
  const { options, value, onChange, size, style, testID, variant, indicator, ...rest } = props;
  const track = flattenStyle<ViewStyle>(style)?.backgroundColor;
  const trackFill = typeof track === 'string' ? track : theme.colors.surfaceRaised;
  return (
    <Tabs.Root value={value} onValueChange={onChange} variant="pill" size={size}>
      <Tabs.List {...rest} testID={testID} style={[style, { backgroundColor: 'transparent' }]}>
        {options.map((option) => (
          <Tabs.Trigger
            key={option.value}
            value={option.value}
            disabled={option.disabled}
            testID={testID ? `${testID}-tab-${option.value}` : undefined}
            style={{
              backgroundColor: background(
                value === option.value ? theme.colors.surface : trackFill
              ),
            }}>
            <Tabs.Label>{option.label}</Tabs.Label>
            {option.badge !== undefined ? <Tabs.Badge>{option.badge}</Tabs.Badge> : null}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
    </Tabs.Root>
  );
}
