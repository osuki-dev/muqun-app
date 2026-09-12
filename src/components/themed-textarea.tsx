/** Adapted from @osuki-dev/ui 1.0.1: preserve input behavior; theme only control fills. */
import React, { useMemo } from 'react';
import { type TextInputProps, type TextStyle, type ViewStyle } from 'react-native';
import { useThemeTokens } from '@osuki-dev/ui';
import { Input } from '@/components/themed-input';

export interface TextareaProps extends Omit<TextInputProps, 'multiline' | 'style'> {
  label?: string;
  error?: string;
  helper?: string;
  minRows?: number;
  maxRows?: number;
  containerStyle?: ViewStyle;
  style?: TextStyle;
}

export const Textarea: React.FC<TextareaProps> = ({
  minRows = 4,
  maxRows,
  containerStyle,
  style,
  textAlignVertical = 'top',
  ...props
}) => {
  const theme = useThemeTokens();
  const rows = Math.max(2, minRows);
  const maxHeight = maxRows ? Math.max(rows, maxRows) * 24 + theme.spacing.md : undefined;

  const inputStyle = useMemo<TextStyle>(
    () => ({
      minHeight: rows * 24 + theme.spacing.md,
      maxHeight,
      textAlignVertical,
      lineHeight: 24,
      ...style,
    }),
    [maxHeight, rows, style, textAlignVertical, theme.spacing.md]
  );

  return (
    <Input
      variant="outline"
      containerStyle={containerStyle}
      style={inputStyle}
      multiline
      scrollEnabled={!!maxRows}
      {...props}
    />
  );
};
