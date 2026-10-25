import type { TextFieldProps } from '@osuki-dev/ui';
import { useState, type Ref } from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputInstance } from 'react-native';

/** Native text and its hint change together; a React-drawn hint can overlap the first glyph. */
export function ComposerTextInput({
  inputRef,
  style,
  placeholder: fullPlaceholder,
  shortPlaceholder,
  value,
  children,
  ...props
}: TextFieldProps & { inputRef?: Ref<TextInputInstance> }) {
  const [measurement, setMeasurement] = useState<{ text: string; wraps: boolean } | null>(null);
  // These are the composer's two placements: a row flex item or a full-width expanded field.
  const { flex, width, ...inputStyle } = StyleSheet.flatten(style) ?? {};
  const placeholder =
    shortPlaceholder && (measurement?.text !== fullPlaceholder || measurement?.wraps !== false)
      ? shortPlaceholder
      : fullPlaceholder;

  return (
    <View style={{ flex, width }}>
      <TextInput
        ref={inputRef}
        {...props}
        {...(children === undefined ? { value } : {})}
        placeholder={placeholder}
        style={[inputStyle, flex !== undefined && { flexGrow: 1 }]}>
        {children}
      </TextInput>
      {shortPlaceholder && fullPlaceholder ? (
        <Text
          pointerEvents="none"
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          style={[inputStyle, styles.probe]}
          onTextLayout={(event) => {
            const wraps = event.nativeEvent.lines.length > 1;
            setMeasurement((previous) =>
              previous?.text === fullPlaceholder && previous.wraps === wraps
                ? previous
                : { text: fullPlaceholder, wraps }
            );
          }}>
          {fullPlaceholder}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  probe: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    opacity: 0,
    height: undefined,
    minHeight: undefined,
    maxHeight: undefined,
  },
});
