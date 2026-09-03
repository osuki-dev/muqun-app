/**
 * How the app looks and which language it speaks.
 *
 * Its own component, and that is the performance half of card #678 as much as
 * the layout half: the store slices this section needs are read *here*, so a
 * switch flipping three sections down no longer re-renders the appearance
 * controls. On the page this replaces, every setting on the screen was a
 * selector on one component, and every change to any of them re-rendered all
 * of it.
 *
 * Card #683 took the two big controls out of this file entirely. The theme grid
 * and the language list were five preview cards and nine radio options built on
 * every visit to Settings, for two choices made once per install -- so each is
 * now a row that names its current answer and opens a sheet, and only the sheet
 * pays for the list. What is left inline is colour mode, which is the one
 * control here somebody flips on a Tuesday evening: it is a frequent toggle,
 * not a once-per-install decision, and a segmented control that is one tap from
 * the page should not become two.
 *
 * The order is unchanged and still argued: theme first because it is the larger
 * choice -- the pack picks which light/dark pair is in play, the mode only
 * picks which half of it is showing -- then the mode, then the language.
 */
import { useLingui } from '@lingui/react/macro';
import { useThemeMode } from '@osuki-dev/ui';
import { useRouter } from 'expo-router';

import { SettingsBlock, SettingsChoiceRow, SettingsSection } from '@/components/settings-chrome';
import { SettingsSegmented } from '@/components/settings-segmented';
import { resolveThemePack } from '@/constants/theme-packs';
import { LOCALE_LABELS } from '@/i18n/locale';
import { useRenderTally } from '@/lib/render-tally';
import { useAppSettings } from '@/stores/app-settings';

export function SettingsAppearance({ title }: { title: string }) {
  // `t` from the hook, not the global `t` from `@lingui/core/macro` -- see the
  // note at the top of the settings screen for why.
  const { t } = useLingui();
  const router = useRouter();
  const { mode, setMode } = useThemeMode();
  useRenderTally('SettingsAppearance');

  const language = useAppSettings((state) => state.language);
  const themePack = useAppSettings((state) => state.themePack);

  const pack = resolveThemePack(themePack);
  // "System" is a description rather than a name, so it is the one entry in the
  // language list that is translated. Every language is written in itself.
  const languageName = language ? LOCALE_LABELS[language] : t`System`;

  return (
    <SettingsSection title={title}>
      <SettingsChoiceRow
        label={t`Theme`}
        value={pack.label}
        detail={t`Terminal colours follow the theme.`}
        accessibilityLabel={t`Theme, ${pack.label}`}
        testID="settings-theme-row"
        onPress={() => router.push('/settings-theme')}
      />

      <SettingsBlock label={t`Color mode`}>
        <SettingsSegmented
          options={[
            { label: t`System`, value: 'system' },
            { label: t`Light`, value: 'light' },
            { label: t`Dark`, value: 'dark' },
          ]}
          value={mode}
          onChange={(value) => setMode(value as 'system' | 'light' | 'dark')}
        />
      </SettingsBlock>

      {/* The caption is the sentence the sheet carries too, and it changes with
          the answer: a pinned language and a followed one are different states,
          and the row has to say which one it is in without being opened. */}
      <SettingsChoiceRow
        label={t`Language`}
        value={languageName}
        detail={
          language
            ? t`Muqun stays in this language whatever the phone is set to.`
            : t`Muqun follows the language your phone is set to.`
        }
        accessibilityLabel={t`Language, ${languageName}`}
        testID="settings-language-row"
        onPress={() => router.push('/settings-language')}
      />
    </SettingsSection>
  );
}
