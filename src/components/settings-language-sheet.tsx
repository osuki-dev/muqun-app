/**
 * The language picker.
 *
 * Nine options -- follow the phone, or one of the eight languages Muqun speaks
 * -- and on the page they were a wrapping `RadioGroup` of nine bordered boxes,
 * about a third of the settings card, permanently open. Nobody opens Settings
 * to look at it twice.
 *
 * In the sheet it is what a language picker should be: one option per line,
 * scanned rather than compared, in the same card-with-hairlines the rest of the
 * page is built from. Each language is written in itself -- English, Traditional
 * Chinese, Japanese -- because a reader looking for Chinese is not scanning for the English
 * word for it. Only "System" is translated, since it is a description rather
 * than a name.
 *
 * The one thing that does not change is where the row lives: APPEARANCE is
 * still second on the page, above the four sections about behaviour, because a
 * reader who launched the app in a language they cannot read is looking for
 * this and cannot read the headings on the way down to it. It is now one row
 * away instead of on the page, which is one tap, not one more screen to search.
 */
import { useLingui } from '@lingui/react/macro';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { Check } from 'lucide-react-native';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { PressableScale } from '@/components/pressable-scale';
import { LADDER, SettingsCard } from '@/components/settings-chrome';
import { SettingsSheet } from '@/components/settings-sheet';
import { APP_LOCALES, LOCALE_LABELS, type LocalePreference } from '@/i18n/locale';
import { timing } from '@/lib/motion';
import { useRenderTally } from '@/lib/render-tally';
import { useAppSettings } from '@/stores/app-settings';

export function SettingsLanguageSheet({ onClose }: { onClose: () => void }) {
  // `t` from the hook, not the global `t` from `@lingui/core/macro` -- and on
  // this screen more than any other: every string here is re-rendered by the
  // very choice it offers.
  const { t } = useLingui();
  useRenderTally('SettingsLanguageSheet');

  const language = useAppSettings((state) => state.language);
  const update = useAppSettings((state) => state.update);

  /**
   * Apply, then leave -- the same order the theme sheet uses, and for a sharper
   * reason here: the write re-renders this sheet in the new language on its way
   * out, so the last thing seen is the app already speaking it.
   */
  function choose(next: LocalePreference) {
    if (next !== language) void update({ language: next });
    onClose();
  }

  return (
    <SettingsSheet
      title={t`Language`}
      caption={
        language
          ? t`Muqun stays in this language whatever the phone is set to.`
          : t`Muqun follows the language your phone is set to.`
      }
      closeLabel={t`Close language picker`}
      onClose={onClose}>
      <SettingsCard>
        {/* First, and the default, so the app follows the phone until someone
            has a reason for it not to. `null` is what the store keeps -- it is
            the absence of a choice, not a tenth language. */}
        <LanguageRow
          label={t`System`}
          testID="language-option-system"
          selected={language === null}
          onSelect={() => choose(null)}
        />
        {APP_LOCALES.map((locale) => (
          <LanguageRow
            key={locale}
            label={LOCALE_LABELS[locale]}
            testID={`language-option-${locale}`}
            selected={language === locale}
            onSelect={() => choose(locale)}
          />
        ))}
      </SettingsCard>
    </SettingsSheet>
  );
}

/**
 * One language.
 *
 * A tick rather than the theme sheet's ring, because the shapes are different:
 * a ring belongs around a tile, and a rule drawn around one row inside a carded
 * list reads as a box that escaped. It is still one accent mark per decision,
 * and it still cross-fades on `micro` rather than appearing -- the tick is
 * always laid out, so the row does not reflow when the choice moves.
 */
function LanguageRow({
  label,
  testID,
  selected,
  onSelect,
}: {
  label: string;
  testID: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const theme = useThemeTokens();
  useRenderTally('LanguageRow');
  const on = useSharedValue(selected ? 1 : 0);

  useEffect(() => {
    on.value = withTiming(selected ? 1 : 0, timing('micro'));
  }, [on, selected]);

  const markStyle = useAnimatedStyle(() => ({ opacity: on.value }));

  return (
    <PressableScale
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      testID={testID}
      onPress={onSelect}
      style={styles.row}>
      <Text variant="bodySmall" numberOfLines={1} style={styles.rowLabel}>
        {label}
      </Text>
      <Animated.View
        pointerEvents="none"
        testID={selected ? `${testID}-selected` : undefined}
        style={markStyle}>
        <Check size={18} color={theme.colors.primary} strokeWidth={2.5} />
      </Animated.View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  // Shorter than the page's 60pt row: nothing here carries a second line, and
  // nine rows at page height would not fit a sheet worth opening.
  row: {
    minHeight: 48,
    paddingHorizontal: LADDER.gutter,
    paddingVertical: LADDER.gap,
    flexDirection: 'row',
    alignItems: 'center',
    gap: LADDER.snug,
  },
  rowLabel: { flex: 1, minWidth: 0, lineHeight: 20, includeFontPadding: false },
});
