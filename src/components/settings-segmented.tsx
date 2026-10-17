/**
 * The settings page's segmented control: colour mode, terminal text size, and
 * the agent view default when its flag is on.
 *
 * It is `@osuki-dev/ui`'s `Tabs` -- the same list chrome, the same triggers, the
 * same 11pt all-caps labels, the same `accessibilityRole="tab"` and
 * `selected` state the e2e flow asserts on. Nothing about the look is
 * re-decided here. The selection is the kit's sliding indicator, so the pill
 * *moves* rather than cutting from one segment to the next, and its corner is
 * the profile's option radius (`components.Tabs.optionRadius`; Editorial: 2pt
 * inside a 4pt track).
 *
 * The track and the pill are both solid at any surface opacity: the
 * `overlay` layering's fills are marks, not surfaces, so `AppSurfaceDecorator`
 * leaves them alone (see `usePillTabsLayering` for the surfaces that thin).
 * A control's track says where the choices are and which half of them you are
 * not on, and it has to stay legible against any wallpaper a pack ships; a
 * translucent pill on a solid track shows the track through itself and the
 * selected side goes muddy. Two opaque fills, one mark.
 *
 * The pack's `tabs.background` artwork is the track's decoration
 * (`AppSurfaceDecorator` maps `tabs.track` onto it), under the pill, so
 * neither the mark nor the chosen side loses contrast to it.
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
              // The kit's own label style, with its `textTransform` turned off.
              //
              // This used to be React Native's `Text`, carrying the kit's font
              // size and tracking copied out of `theme.typeStyles.label` by
              // hand -- and not its family, because there is no family in a
              // type style to copy. So the one control on the page where a
              // reader picks their font was the one control on the page that
              // never changed face: "the tabs' font did not change". The kit's
              // `Text` reads the whole of the style, family included, through
              // `resolveFontStyle`, and `transform` is the prop that says no to
              // the uppercasing without forking anything.
              //
              // Thai came through here too. It had its own branch, pinned to
              // Android's `sans-serif`, on the argument that the compact label's
              // fitting pass clips final clusters -- which left a Thai reader
              // who installed a Thai face looking at the system's. The line
              // height below is the taller of the two the branches used, so the
              // clusters have the room that branch was really after, and the
              // face is the reader's in every script.
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
   * No `fontWeight` and no `fontFamily`.
   *
   * Both used to be here. The family was never set, which is what kept this
   * control on the system face; the weight was `'600'`, which on Android is
   * the last weight below the threshold where the platform stops finding a
   * registered typeface and answers with its own (see
   * `theme/interface-font-registry.ts`). Neither belongs in a style: the
   * `weight` prop above goes through the kit's registry, which is the one
   * place that knows what the reader's file can actually serve.
   *
   * `includeFontPadding` is left on. A segment is a pill with a fixed height
   * and a hostile face's ascenders have nowhere to go without it.
   */
  sentenceLabel: {
    textAlign: 'center',
    flexShrink: 1,
  },
});
