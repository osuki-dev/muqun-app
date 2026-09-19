import { useThemeTokens } from '@osuki-dev/ui';
import { Text } from '@/components/text';
import { StyleSheet, type StyleProp, type TextStyle } from 'react-native';

/**
 * A field's placeholder, drawn as text rather than as the platform's hint.
 *
 * A `TextInput` draws its typed value from spans and its placeholder from the
 * native view's own typeface, and those are two different code paths. The
 * value follows the reader's font everywhere. The hint did on stock Android
 * and did not on the owner's phone, where every other piece of text on the
 * same sheet was in their face and the one line inside the field was in the
 * system's. The view typeface is resolved once, when the family prop is set,
 * and an OEM text stack is free to have its own opinion about it; nothing in
 * JavaScript can see which happened.
 *
 * A kit `Text` has no such second path: it is the component every other line
 * on the screen already uses, so a placeholder drawn with it is in the right
 * font by construction, on every device. The native hint stays on the field,
 * transparent, because it is what a screen reader announces for an empty
 * field and what gives an empty multiline field its height.
 *
 * Laid over the field, never beside it, and deaf to touches: a tap on the
 * placeholder is a tap on the field.
 */
export function FieldPlaceholder({
  text,
  visible,
  color,
  style,
}: {
  text: string | undefined;
  visible: boolean;
  /** The placeholder tint; the theme's subtle text when a field names none. */
  color: string | undefined;
  /** The field's own text metrics and padding, so the two lines coincide. */
  style: StyleProp<TextStyle>;
}) {
  const { colors } = useThemeTokens();
  if (!visible || !text) return null;
  return (
    <Text
      accessible={false}
      importantForAccessibility="no"
      pointerEvents="none"
      color={color ?? colors.textSubtle}
      style={StyleSheet.flatten([styles.placeholder, style])}>
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({
  // In flow inside the overlay that the field lays over itself, so the
  // overlay's own alignment decides where the line sits.
  placeholder: {
    alignSelf: 'stretch',
  },
});
