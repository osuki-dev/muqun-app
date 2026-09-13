import { Host, Slider } from '@expo/ui/swift-ui';
import {
  accessibilityIdentifier,
  accessibilityLabel,
  accessibilityValue,
  disabled as disabledModifier,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import { useThemeTokens } from '@osuki-dev/ui';
import { useEffect, useRef } from 'react';
import { I18nManager } from 'react-native';

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
  const draft = useRef(current);
  const changed = useRef(false);
  useEffect(() => {
    if (!changed.current) draft.current = current;
    if (disabled) changed.current = false;
  }, [current, disabled]);

  return (
    <Host
      style={{ height: 48, alignSelf: 'stretch' }}
      colorScheme={theme.mode}
      ignoreSafeArea="all"
      layoutDirection={I18nManager.isRTL ? 'rightToLeft' : 'leftToRight'}>
      <Slider
        value={current}
        min={minimum >= 1 ? 0 : minimum}
        max={1}
        modifiers={[
          tint(theme.colors.primary),
          disabledModifier(disabled),
          accessibilityLabel(label),
          accessibilityValue(`${Math.round(current * 100)}%`),
          ...(testID ? [accessibilityIdentifier(testID)] : []),
        ]}
        onValueChange={(next) => {
          if (disabled) return;
          draft.current = clampOpacity(next, minimum);
          changed.current = true;
          onValueChange(draft.current);
        }}
        onEditingChanged={(editing) => {
          if (editing || disabled || !changed.current) return;
          changed.current = false;
          onSlidingComplete(draft.current);
        }}
      />
    </Host>
  );
}
