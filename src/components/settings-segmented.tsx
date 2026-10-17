/**
 * The settings page's segmented control: colour mode, terminal text size, and
 * the agent view default when its flag is on.
 *
 * It is `@osuki-dev/ui`'s `Tabs` with the sliding indicator: the list paints
 * the track and the pack's `tabs.background` artwork once, and one selection
 * pill travels to the chosen trigger (or lands in place under reduce motion),
 * so switching reads as an answer rather than a redraw. Track and pill are
 * opaque marks whatever the surface slider says (`surface-decorator.tsx`), and
 * their radius is the appearance profile's segmented track radius.
 *
 * What is left here is what the kit has no opinion about: sentence-case labels
 * with room for tall scripts, and test identifiers that carry the selection.
 */
import { Tabs, useThemeTokens, Text, type TextProps } from '@osuki-dev/ui';
import { StyleSheet } from 'react-native';

import { useRenderTally } from '@/lib/render-tally';

export type SegmentedOption = { label: string; value: string };

/**
 * How the labels are cased.
 *
 * `sentence` is the default and the app's rule: a segment says "All models",
 * not "ALL MODELS". The kit's `Tabs.Label` carries `textTransform: 'uppercase'`
 * in its type style, which is a decision about signage rather than about this
 * control -- and it makes a proper noun unreadable as itself ("OPENCODE GO").
 * `uppercase` is kept so a caller that genuinely wants the kit's signage can
 * ask for it rather than forking the component.
 */
export type SegmentedCase = 'sentence' | 'uppercase';

export function SettingsSegmented({
  options,
  value,
  onChange,
  testID,
  textCase = 'sentence',
  labelWeight,
}: {
  options: SegmentedOption[];
  value: string;
  onChange: (value: string) => void;
  testID?: string;
  /** @default 'sentence' */
  textCase?: SegmentedCase;
  /** Override sentence-case labels; uppercase labels keep the kit typography. */
  labelWeight?: TextProps['weight'];
}) {
  const theme = useThemeTokens();
  useRenderTally('SettingsSegmented');

  return (
    <Tabs.Root
      value={value}
      onValueChange={onChange}
      variant="pill"
      size="compact"
      indicator="slide">
      <Tabs.List testID={testID}>
        {options.map((option) => (
          <Tabs.Trigger
            key={option.value}
            value={option.value}
            // Android's native driver omits selected. Expose the same source
            // state in a test identifier, without changing spoken labels.
            testID={`settings-selection:${option.value === value ? 'on' : 'off'}:${testID ?? 'segment'}-${option.value}`}>
            {textCase === 'sentence' ? (
              // The kit's label style with its `textTransform` turned off, in
              // the reader's face. The line height is taller than the label's
              // own so a Thai cluster has room in the compact segment.
              <Text
                variant="label"
                transform="none"
                weight={labelWeight ?? 'semibold'}
                numberOfLines={1}
                maxFontSizeMultiplier={1.18}
                color={option.value === value ? theme.colors.text : theme.colors.textMuted}
                style={[
                  styles.sentenceLabel,
                  { lineHeight: Math.ceil(theme.typeStyles.label.fontSize * 1.6) },
                ]}>
                {option.label}
              </Text>
            ) : (
              <Tabs.Label>{option.label}</Tabs.Label>
            )}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
    </Tabs.Root>
  );
}

const styles = StyleSheet.create({
  /**
   * No `fontWeight` and no `fontFamily`: the `weight` prop goes through the
   * kit's registry, the one place that knows what the reader's file can serve.
   * `includeFontPadding` is left on: a segment is a pill with a fixed height
   * and a hostile face's ascenders have nowhere to go without it.
   */
  sentenceLabel: {
    textAlign: 'center',
    flexShrink: 1,
  },
});
