import { forwardRef, useCallback, useState } from 'react';
import {
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { FieldPlaceholder } from '@/components/field-placeholder';

/**
 * `TextInput`, with a placeholder that is in the reader's font on every device.
 *
 * Every text field in the app is this one. See `field-placeholder.tsx` for why
 * the platform's own hint cannot be trusted with a reader-installed face: it is
 * drawn from the native view's typeface, not from the spans the typed value is
 * drawn from, and the two disagreed on the owner's phone in every field at
 * once. So the hint is kept -- transparent -- for the screen reader and for the
 * height it gives an empty multiline field, and the visible placeholder is a
 * kit `Text` laid over the same box.
 *
 * The field's style is split in two, because the wrapper now stands where the
 * input stood in its parent's layout: what places a box among its siblings
 * (flex, width, margins, self-alignment) moves to the wrapper, and everything
 * else -- padding, borders, fill, type -- stays on the input. The placeholder
 * takes the input's type and padding, which is what makes the two lines land
 * on each other without either file knowing the other's numbers.
 */

const PLACEMENT_KEYS = [
  'flex',
  'flexGrow',
  'flexShrink',
  'flexBasis',
  'alignSelf',
  'width',
  'minWidth',
  'maxWidth',
  'margin',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'marginHorizontal',
  'marginVertical',
  'marginStart',
  'marginEnd',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'zIndex',
] as const;

const TYPE_KEYS = [
  'fontFamily',
  'fontSize',
  'fontStyle',
  'fontWeight',
  'letterSpacing',
  'lineHeight',
  'textAlign',
  'includeFontPadding',
  'padding',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'paddingHorizontal',
  'paddingVertical',
  'paddingStart',
  'paddingEnd',
  'borderWidth',
  'borderTopWidth',
  'borderLeftWidth',
  'borderRightWidth',
  'borderBottomWidth',
] as const;

type Loose = Record<string, unknown>;

/** The three styles one field style becomes. Exported for its test. */
export function splitFieldStyle(style: TextInputProps['style']): {
  wrapper: ViewStyle;
  input: TextStyle;
  placeholder: TextStyle;
} {
  const flat = (StyleSheet.flatten(style) ?? {}) as Loose;
  const wrapper: Loose = {};
  const input: Loose = { ...flat };
  const placeholder: Loose = {};
  for (const key of PLACEMENT_KEYS) {
    if (flat[key] === undefined) continue;
    wrapper[key] = flat[key];
    delete input[key];
  }
  // A field that flexed among its siblings now fills the wrapper that flexes
  // in its place; one that did not keeps its natural height.
  if (wrapper.flex !== undefined || wrapper.flexGrow !== undefined) input.flexGrow = 1;
  for (const key of TYPE_KEYS) {
    if (flat[key] === undefined) continue;
    // Borders are transparent on the placeholder: only their width is wanted,
    // so the text starts where the input's text starts.
    placeholder[key] = flat[key];
  }
  if (Object.keys(placeholder).some((key) => key.startsWith('border'))) {
    placeholder.borderColor = 'transparent';
  }
  return {
    wrapper: wrapper as ViewStyle,
    input: input as TextStyle,
    placeholder: placeholder as TextStyle,
  };
}

export const FontedTextInput = forwardRef<TextInput, TextInputProps>(function FontedTextInput(
  {
    style,
    placeholder,
    placeholderTextColor,
    value,
    defaultValue,
    onChangeText,
    multiline,
    ...rest
  },
  ref
) {
  // An uncontrolled field still has to know when it is empty.
  const [typed, setTyped] = useState(defaultValue ?? '');
  const handleChangeText = useCallback(
    (next: string) => {
      setTyped(next);
      onChangeText?.(next);
    },
    [onChangeText]
  );
  const empty = (value ?? typed).length === 0;
  const parts = splitFieldStyle(style);

  return (
    <View style={parts.wrapper}>
      <TextInput
        ref={ref}
        {...rest}
        multiline={multiline}
        value={value}
        defaultValue={defaultValue}
        onChangeText={handleChangeText}
        placeholder={placeholder}
        placeholderTextColor="transparent"
        style={parts.input}
      />
      {/* A single line is centred in its box by the platform; a multiline field
          starts at the top. The overlay does the same. */}
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, multiline ? styles.top : styles.centre]}>
        <FieldPlaceholder
          text={placeholder}
          visible={empty}
          color={typeof placeholderTextColor === 'string' ? placeholderTextColor : undefined}
          style={parts.placeholder}
        />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  top: { justifyContent: 'flex-start' },
  centre: { justifyContent: 'center' },
});
