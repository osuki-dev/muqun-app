import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { timing } from '@/lib/motion';
/** Adapted from @osuki-dev/ui 1.0.1: preserve input behavior; theme only control fills. */
import React, { useMemo } from 'react';
import {
  Platform,
  Pressable,
  TextInput,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Icon, resolveFontStyle, useThemeTokens } from '@osuki-dev/ui';

export interface SearchInputProps extends Omit<TextInputProps, 'style'> {
  value: string;
  onChangeText: (value: string) => void;
  onClear?: () => void;
  containerStyle?: ViewStyle;
  inputStyle?: TextStyle;
  clearAccessibilityLabel?: string;
}

export const SearchInput: React.FC<SearchInputProps> = ({
  value,
  onChangeText,
  onClear,
  containerStyle,
  inputStyle,
  clearAccessibilityLabel = 'Clear search',
  placeholder = 'Search',
  onFocus,
  onBlur,
  testID,
  ...props
}) => {
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();
  const input = theme.components.Input;
  const focusProgress = useSharedValue(0);
  const showClear = value.length > 0;

  const containerStyles = useMemo<ViewStyle>(
    () => ({
      minHeight: 44,
      width: '100%',
      borderWidth: 1,
      borderRadius: theme.radius.pill,
      paddingHorizontal: theme.spacing.md,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
      backgroundColor:
        input.background === 'transparent'
          ? 'transparent'
          : surfaceBackground(theme.colors[input.background]),
      borderColor: theme.colors[input.border],
    }),
    [
      surfaceBackground,
      input.background,
      input.border,
      theme.colors,
      theme.radius.pill,
      theme.spacing,
    ]
  );

  const animatedContainerStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(
      focusProgress.value,
      [0, 1],
      [theme.colors[input.border], theme.colors[input.borderFocused]]
    ),
  }));

  const textInputStyle = useMemo<TextStyle>(
    () => ({
      alignSelf: 'stretch',
      flex: 1,
      minWidth: 0,
      paddingVertical: 0,
      height: 22,
      ...resolveFontStyle(theme.fonts, theme.typeStyles.body.fontFamily, 'regular'),
      fontSize: 16,
      lineHeight: 22,
      color: theme.colors[input.foreground],
      textAlignVertical: 'center',
      includeFontPadding: Platform.OS === 'android' ? false : undefined,
    }),
    [input.foreground, theme.colors, theme.fonts, theme.typeStyles.body.fontFamily]
  );

  const handleClear = () => {
    onChangeText('');
    onClear?.();
  };

  const handleFocus: TextInputProps['onFocus'] = (event) => {
    focusProgress.value = withTiming(1, timing(140));
    onFocus?.(event);
  };

  const handleBlur: TextInputProps['onBlur'] = (event) => {
    focusProgress.value = withTiming(0, timing(160));
    onBlur?.(event);
  };

  return (
    <Animated.View
      testID={testID ? `${testID}-container` : undefined}
      style={[containerStyles, animatedContainerStyle, containerStyle]}>
      <Icon name="Search" size={18} color={theme.colors.textMuted} />
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors[input.placeholder]}
        returnKeyType="search"
        clearButtonMode="never"
        style={[textInputStyle, inputStyle]}
        onFocus={handleFocus}
        onBlur={handleBlur}
        {...props}
      />
      {showClear && (
        <Pressable
          testID={testID ? `${testID}-clear` : undefined}
          accessibilityRole="button"
          accessibilityLabel={clearAccessibilityLabel}
          onPress={handleClear}
          hitSlop={10}
          style={{ minWidth: 28, minHeight: 28, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="X" size={16} color={theme.colors.textMuted} />
        </Pressable>
      )}
    </Animated.View>
  );
};
