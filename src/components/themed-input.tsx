import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { timing, fadeInDown, listLayout } from '@/lib/motion';
/** Adapted from @osuki-dev/ui 1.0.1: preserve input behavior; theme only control fills. */
import React, { useEffect, useMemo } from 'react';
import {
  Platform,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { resolveFontStyle, Text, useThemeTokens } from '@osuki-dev/ui';

export type InputVariant = 'underline' | 'outline';
export type InputSize = 'default' | 'compact';

export interface InputProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  variant?: InputVariant;
  size?: InputSize;
  error?: string;
  helper?: string;
  containerStyle?: ViewStyle;
  style?: TextStyle;
}

export const Input: React.FC<InputProps> = ({
  label,
  variant = 'underline',
  size = 'default',
  error,
  helper,
  containerStyle,
  style,
  onFocus,
  onBlur,
  ...textInputProps
}) => {
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();
  const input = theme.components.Input;
  const hasError = !!error;
  const hasHelper = !!helper && !hasError;
  const isMultiline = textInputProps.multiline === true;
  const numberOfLines =
    typeof textInputProps.numberOfLines === 'number' ? textInputProps.numberOfLines : 4;
  const focusProgress = useSharedValue(0);
  const errorProgress = useSharedValue(hasError ? 1 : 0);

  useEffect(() => {
    errorProgress.value = withTiming(hasError ? 1 : 0, timing(160));
  }, [errorProgress, hasError]);

  const containerStyles = useMemo<ViewStyle>(
    () => ({ width: '100%', gap: theme.spacing.sm }),
    [theme.spacing]
  );

  const inputContainerStyles = useMemo<ViewStyle>(() => {
    const verticalPadding = size === 'compact' ? theme.spacing.xs : theme.spacing[input.paddingY];
    const minHeight = isMultiline
      ? verticalPadding * 2 + Math.max(numberOfLines, 2) * 24
      : size === 'compact'
        ? 40
        : 48;

    return {
      minHeight,
      justifyContent: isMultiline ? 'flex-start' : 'center',
      backgroundColor:
        input.background === 'transparent'
          ? 'transparent'
          : surfaceBackground(theme.colors[input.background]),
      ...(variant === 'outline' && {
        borderRadius: theme.radius[input.radius],
        paddingHorizontal: theme.spacing[input.paddingX],
        paddingVertical: verticalPadding,
      }),
      ...(variant === 'underline' && {
        borderBottomWidth: 1,
        borderColor: theme.colors[input.border],
        paddingVertical: verticalPadding,
      }),
    };
  }, [
    surfaceBackground,
    input,
    isMultiline,
    numberOfLines,
    size,
    theme.colors,
    theme.radius,
    theme.spacing,
    variant,
  ]);

  const animatedInputContainerStyle = useAnimatedStyle(() => {
    const focusBorder = interpolateColor(
      focusProgress.value,
      [0, 1],
      [theme.colors[input.border], theme.colors[input.borderFocused]]
    );

    return {
      borderColor: interpolateColor(
        errorProgress.value,
        [0, 1],
        [focusBorder, theme.colors[input.borderError]]
      ),
    };
  });

  const inputStyles = useMemo<TextStyle>(() => {
    const lineHeight = size === 'compact' ? 20 : 22;

    return {
      alignSelf: 'stretch',
      ...resolveFontStyle(theme.fonts, theme.typeStyles.body.fontFamily, 'regular'),
      fontSize: size === 'compact' ? 14 : 16,
      color: theme.colors[input.foreground],
      padding: 0,
      paddingVertical: 0,
      minHeight: isMultiline ? Math.max(numberOfLines, 2) * 24 : lineHeight,
      height: isMultiline ? undefined : lineHeight,
      lineHeight,
      textAlignVertical: isMultiline ? 'top' : 'center',
      includeFontPadding: Platform.OS === 'android' ? false : undefined,
    };
  }, [
    input.foreground,
    isMultiline,
    numberOfLines,
    size,
    theme.colors,
    theme.fonts,
    theme.typeStyles.body.fontFamily,
  ]);

  const handleFocus: TextInputProps['onFocus'] = (e) => {
    focusProgress.value = withTiming(1, timing(140));
    onFocus?.(e);
  };

  const handleBlur: TextInputProps['onBlur'] = (e) => {
    focusProgress.value = withTiming(0, timing(160));
    onBlur?.(e);
  };

  return (
    <View
      testID={textInputProps.testID ? `${textInputProps.testID}-container` : undefined}
      style={[containerStyles, containerStyle]}>
      {label && (
        <Text variant="label" colorKey="textMuted">
          {label}
        </Text>
      )}
      <Animated.View
        testID={textInputProps.testID ? `${textInputProps.testID}-control` : undefined}
        style={[inputContainerStyles, animatedInputContainerStyle]}>
        <TextInput
          style={[inputStyles, style]}
          placeholderTextColor={theme.colors[input.placeholder]}
          onFocus={handleFocus}
          onBlur={handleBlur}
          {...textInputProps}
        />
      </Animated.View>
      {hasError && (
        <Animated.View
          testID={textInputProps.testID ? `${textInputProps.testID}-error` : undefined}
          entering={fadeInDown(150)}
          layout={listLayout('short')}
          style={{
            backgroundColor: surfaceBackground(theme.colors.dangerSubtle),
            borderRadius: theme.radius.pill,
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.xs,
            alignSelf: 'flex-start',
            maxWidth: '100%',
          }}>
          <Text variant="caption" colorKey="danger">
            {error}
          </Text>
        </Animated.View>
      )}
      {hasHelper && (
        <Text variant="caption" colorKey="textMuted">
          {helper}
        </Text>
      )}
    </View>
  );
};
