import { Box, Host, Row, Shape, Slider } from '@expo/ui/jetpack-compose';
import {
  background,
  clip,
  fillMaxWidth,
  height,
  Shapes,
  size,
  weight,
} from '@expo/ui/jetpack-compose/modifiers';
import { useThemeTokens } from '@osuki-dev/ui';
import { useEffect, useRef } from 'react';
import { I18nManager, View } from 'react-native';

import { clampOpacity, type OpacitySliderProps } from './opacity-slider.types';

export function OpacitySlider({
  value,
  minimumValue = 0,
  disabled = false,
  label,
  testID,
  onValueChange,
  onSlidingComplete,
}: OpacitySliderProps) {
  const theme = useThemeTokens();
  const minimum = clampOpacity(minimumValue);
  disabled = disabled || minimum >= 1;
  const current = clampOpacity(value, minimum);
  const fraction = minimum >= 1 ? 1 : (current - minimum) / (1 - minimum);
  const draft = useRef(current);
  const changed = useRef(false);
  useEffect(() => {
    if (!changed.current) draft.current = current;
    if (disabled) changed.current = false;
  }, [current, disabled]);

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      accessibilityValue={{
        min: Math.ceil(minimum * 100),
        max: 100,
        now: Math.round(current * 100),
      }}
      accessibilityActions={disabled ? [] : [{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={({ nativeEvent: { actionName } }) => {
        if (disabled || !['increment', 'decrement'].includes(actionName)) return;
        draft.current = clampOpacity(
          draft.current + (actionName === 'increment' ? 0.01 : -0.01),
          minimum
        );
        onValueChange(draft.current);
        onSlidingComplete(draft.current);
      }}>
      {/* SDK 57 does not expose label semantics on Compose Slider. Keep one
          named adjustable node above it, with explicit accessibility actions. */}
      <View importantForAccessibility="no-hide-descendants">
        <Host
          style={{ height: 48, alignSelf: 'stretch' }}
          colorScheme={theme.mode}
          ignoreSafeAreaKeyboardInsets
          layoutDirection={I18nManager.isRTL ? 'rightToLeft' : 'leftToRight'}>
          <Slider
            value={current}
            min={minimum >= 1 ? 0 : minimum}
            max={1}
            steps={0}
            enabled={!disabled}
            modifiers={[fillMaxWidth()]}
            colors={{
              thumbColor: theme.colors.primary,
              activeTrackColor: theme.colors.primary,
              inactiveTrackColor: theme.colors.border,
            }}
            onValueChange={(next) => {
              if (disabled) return;
              draft.current = clampOpacity(next, minimum);
              changed.current = true;
              onValueChange(draft.current);
            }}
            onValueChangeFinished={() => {
              if (disabled || !changed.current) return;
              changed.current = false;
              onSlidingComplete(draft.current);
            }}>
            <Slider.Thumb>
              <Box
                modifiers={[size(20, 20), clip(Shapes.Circle), background(theme.colors.primary)]}
              />
            </Slider.Thumb>
            <Slider.Track>
              <Row modifiers={[fillMaxWidth(), height(4)]}>
                {fraction > 0 ? (
                  <Shape.RoundedCorner
                    color={theme.colors.primary}
                    cornerRadii={{ topStart: 2, bottomStart: 2 }}
                    modifiers={[weight(fraction), height(4)]}
                  />
                ) : null}
                {fraction < 1 ? (
                  <Shape.RoundedCorner
                    color={theme.colors.borderStrong}
                    cornerRadii={{ topEnd: 2, bottomEnd: 2 }}
                    modifiers={[weight(1 - fraction), height(4)]}
                  />
                ) : null}
              </Row>
            </Slider.Track>
          </Slider>
        </Host>
      </View>
    </View>
  );
}
