import { useThemeMode, useThemeTokens } from '@osuki-dev/ui';
import { Switch, StyleSheet, View, type ViewStyle } from 'react-native';

import { appChrome } from '@/constants/appearance';
import { feedback } from '@/lib/feedback';

/**
 * The app's switch.
 *
 * It replaces `@osuki-dev/ui`'s `Toggle`, which paints its thumb with
 * `onPrimary`. That token is a colour for *text drawn on the accent*, and this
 * app deliberately sets it to the ink `#050B12` in light mode -- white on the
 * coral only measures 3.1:1 on a button label. A thumb is not a label, so the
 * library's reuse of the token turned every light-mode switch black.
 *
 * Here the two roles are separated:
 *
 * - the thumb is the near-white of the current mode (`surface` in light, `text`
 *   in dark), which reads on the cream off-track and on the coral on-track
 *   alike;
 * - the off-track is `borderStrong`, the app's darkest neutral, because a
 *   switch track is a slot cut into the row rather than a fill laid on it and
 *   it has to hold that reading against a white card and against the canvas
 *   both. In light mode this used to be a cool `#C9CED8` doing the job on
 *   sufferance -- `surfaceRaised` was then a half-step off the card and had no
 *   backing at all -- and it now measures 1.94:1 under the white thumb against
 *   1.58:1 before, in the canvas's own hue;
 * - the on-track stays `primary`, the accent, which is what "on" means
 *   everywhere else in the app.
 */
export function Toggle({
  value,
  onValueChange,
  disabled = false,
  style,
  testID,
}: {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  style?: ViewStyle;
  testID?: string;
}) {
  const { colors } = useThemeTokens();
  const { resolvedMode } = useThemeMode();

  // No token is near-white in both modes: `surface` lifts toward white on the
  // cream canvas and sinks to `#0B111A` in the dark one.
  const thumb = resolvedMode === 'dark' ? colors.text : colors.surface;

  return (
    <View style={[styles.hitArea, disabled ? styles.disabled : null, style]}>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={(next) => {
          void feedback(next ? 'success' : 'selection');
          onValueChange(next);
        }}
        testID={testID}
        trackColor={{ false: colors.borderStrong, true: colors.primary }}
        thumbColor={thumb}
        ios_backgroundColor={colors.borderStrong}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hitArea: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: appChrome.opacity.disabled },
});
