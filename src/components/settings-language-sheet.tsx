/**
 * The language picker.
 *
 * Nine options -- follow the phone, or one of the eight languages Muqun speaks
 * -- and on the page they were a wrapping `RadioGroup` of nine bordered boxes,
 * about a third of the settings card, permanently open. Nobody opens Settings
 * to look at it twice.
 *
 * In the sheet it is what a language picker should be: one option per line,
 * scanned rather than compared, on the same frosted ground and with the same
 * left rule as every other sheet in the app -- see `sheet-scene.tsx`. Each
 * language is written in itself -- English, Traditional Chinese, Japanese --
 * because a reader looking for Chinese is not scanning for the English word for
 * it. Only "System" is translated, since it is a description rather than a name.
 *
 * The one thing that does not change is where the row lives: Appearance is
 * still second on the page, above the four sections about behaviour, because a
 * reader who launched the app in a language they cannot read is looking for
 * this and cannot read the headings on the way down to it.
 */
import { useLingui } from '@lingui/react/macro';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  SheetScene,
  SheetSceneFooter,
  SheetSceneRow,
  sheetSceneStyles,
} from '@/components/sheet-scene';
import { APP_LOCALES, LOCALE_LABELS, type LocalePreference } from '@/i18n/locale';
import { useRenderTally } from '@/lib/render-tally';
import { useAppSettings } from '@/stores/app-settings';

export function SettingsLanguageSheet({ onClose }: { onClose: () => void }) {
  // `t` from the hook, not the global `t` from `@lingui/core/macro` -- and on
  // this screen more than any other: every string here is re-rendered by the
  // very choice it offers.
  const { t } = useLingui();
  const insets = useSafeAreaInsets();
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
    <SheetScene
      testID="settings-language-sheet"
      title={t`Language`}
      caption={language ? LOCALE_LABELS[language] : t`Following your phone`}
      contentSized>
      <View style={sheetSceneStyles.scroller}>
        {/* First, and the default, so the app follows the phone until someone
            has a reason for it not to. `null` is what the store keeps -- it is
            the absence of a choice, not a tenth language. */}
        <SheetSceneRow
          title={t`System`}
          caption={t`Follow the language your phone is set to`}
          selected={language === null}
          testID={`settings-selection:${language === null ? 'on' : 'off'}:language-option-system`}
          selectedTestID="language-option-system-selected"
          onPress={() => choose(null)}
        />
        {APP_LOCALES.map((locale) => (
          <SheetSceneRow
            key={locale}
            title={LOCALE_LABELS[locale]}
            selected={language === locale}
            testID={`settings-selection:${language === locale ? 'on' : 'off'}:language-option-${locale}`}
            selectedTestID={`language-option-${locale}-selected`}
            onPress={() => choose(locale)}
          />
        ))}
        <SheetSceneFooter bottomInset={insets.bottom} />
      </View>
    </SheetScene>
  );
}
