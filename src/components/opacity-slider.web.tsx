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
  const finish = () => {
    if (disabled || !changed.current) return;
    changed.current = false;
    onSlidingComplete(draft.current);
  };

  return (
    <input
      type="range"
      min={minimum >= 1 ? 0 : minimum}
      max={1}
      step="any"
      value={current}
      disabled={disabled}
      aria-label={label}
      aria-valuetext={`${Math.round(current * 100)}%`}
      data-testid={testID}
      dir={I18nManager.isRTL ? 'rtl' : 'ltr'}
      style={{
        width: '100%',
        minWidth: 0,
        height: 48,
        margin: 0,
        accentColor: theme.colors.primary,
        colorScheme: theme.mode,
      }}
      onChange={(event) => {
        if (disabled) return;
        draft.current = clampOpacity(event.currentTarget.valueAsNumber, minimum);
        changed.current = true;
        onValueChange(draft.current);
      }}
      onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
      onPointerUp={finish}
      onPointerCancel={finish}
      onKeyUp={finish}
      onBlur={finish}
    />
  );
}
