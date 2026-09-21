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
 * Theme and colour mode stay together, followed by font, app icon, and language.
 */
import { useLingui } from '@lingui/react/macro';
import { useThemeMode, useThemeTokens } from '@osuki-dev/ui';
import { Text } from '@/components/text';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Appearance, ScrollView, StyleSheet, View } from 'react-native';

import { SettingsBlock, SettingsChoiceRow, SettingsSection } from '@/components/settings-chrome';
import { PressableScale } from '@/components/pressable-scale';
import { useReskinTransition } from '@/components/reskin-transition';
import { SettingsSegmented } from '@/components/settings-segmented';
import { appChrome } from '@/constants/appearance';
import { useAppIcon } from '@/hooks/use-app-icon';
import { type AppIconId, APP_ICON_CHOICES, appIconIsSelected } from '@/lib/app-icon';
import { useThemePack } from '@/hooks/use-theme-pack';
import { LOCALE_LABELS } from '@/i18n/locale';
import { useRenderTally } from '@/lib/render-tally';
import { useAppSettings } from '@/stores/app-settings';
import { themeVariant } from '@/constants/theme-packs';

export function SettingsAppearance({ title }: { title: string }) {
  // `t` from the hook, not the global `t` from `@lingui/core/macro` -- see the
  // note at the top of the settings screen for why.
  const { t } = useLingui();
  const router = useRouter();
  const { mode, setMode, resolvedMode } = useThemeMode();
  const reskin = useReskinTransition();
  useRenderTally('SettingsAppearance');

  const language = useAppSettings((state) => state.language);
  const homeLayout = useAppSettings((state) => state.homeLayout);
  const homeLayoutLabel = homeLayout === 'editorial' ? t`Editorial` : t`Classic`;
  const pack = useThemePack();

  /**
   * Light to dark is the largest re-skin the app does -- every pixel, and the
   * wallpaper with them -- and it was the one that still cut. It takes the
   * same wash a pack change does, lit in the primary of the half that is
   * arriving.
   *
   * Only when something will actually change. "System" on a phone that is
   * already dark, chosen from "Dark", alters the setting and not one colour;
   * a wash over an interface that does not move would be an animation with no
   * event behind it.
   */
  function chooseMode(next: 'system' | 'light' | 'dark') {
    const system = Appearance.getColorScheme() === 'dark' ? 'dark' : 'light';
    const arriving = next === 'system' ? system : next;
    if (arriving === resolvedMode) {
      setMode(next);
      return;
    }
    void reskin.run({
      kind: 'theme',
      accent: themeVariant(pack, arriving).colors.primary,
      apply: () => setMode(next),
    });
  }
  // "System" is a description rather than a name, so it is the one entry in the
  // language list that is translated. Every language is written in itself.
  const languageName = language ? LOCALE_LABELS[language] : t`System`;

  /**
   * What the Font row says it is set to.
   *
   * Two slots, one row. Naming both where they differ is the only honest
   * summary -- a reader who set a Han face for the app and left the terminal
   * alone should not read one name and wonder why their terminal looks the
   * same -- and where they are the same, or both untouched, one name says it.
   * `System` is translated for the reason it is in the language list: it is a
   * description rather than a name.
   */
  const interfaceFont = useAppSettings((state) => state.interfaceFont);
  const monoFont = useAppSettings((state) => state.monoFont);
  const system = t`System`;
  const interfaceName = interfaceFont.kind === 'file' ? interfaceFont.label : system;
  const monoName = monoFont.kind === 'file' ? monoFont.label : system;
  const fontValue = interfaceName === monoName ? interfaceName : interfaceName + ' / ' + monoName;

  return (
    <SettingsSection title={title}>
      <SettingsChoiceRow
        label={t`Home layout`}
        value={homeLayoutLabel}
        valuePosition="below"
        detail={t`Choose Home and app chrome. Colours stay with your theme.`}
        accessibilityLabel={
          // react-doctor-disable-next-line react-hooks-js/todo -- Lingui expands this macro before React Compiler runs.
          t`Home layout, ${homeLayoutLabel}`
        }
        testID="settings-home-layout-row"
        onPress={() => router.push('/settings-home-layout')}
      />
      <SettingsChoiceRow
        label={t`Theme`}
        value={pack.label}
        valuePosition="below"
        detail={t`Terminal colours follow the theme.`}
        accessibilityLabel={t`Theme, ${pack.label}`}
        testID="settings-theme-row"
        onPress={() => router.push('/settings-theme')}
      />

      <SettingsBlock label={t`Colour mode`}>
        <SettingsSegmented
          options={[
            { label: t`System`, value: 'system' },
            { label: t`Light`, value: 'light' },
            { label: t`Dark`, value: 'dark' },
          ]}
          value={mode}
          onChange={(value) => chooseMode(value as 'system' | 'light' | 'dark')}
        />
      </SettingsBlock>

      <SettingsChoiceRow
        label={t`Font`}
        value={fontValue}
        valuePosition="below"
        detail={t`Use your own font for the app and the terminal.`}
        accessibilityLabel={
          // react-doctor-disable-next-line react-hooks-js/todo -- Lingui expands this macro before React Compiler runs.
          t`Font, ${fontValue}`
        }
        testID="settings-font-row"
        onPress={() => router.push('/settings-font')}
      />

      <AppIconPicker />

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

/**
 * The icons themselves, not their names: a launcher icon is recognised, not
 * read, and a horizontally scrolling row of pictures says what a segmented control of two words
 * cannot. Each tile draws the cut for the current mode, the way the home
 * screen would.
 */
const ICON_ART: Record<AppIconId, { light: number; dark: number }> = {
  default: {
    light: require('@/assets/icons/classic/preview-light.png'),
    dark: require('@/assets/icons/classic/preview-dark.png'),
  },
  Mascot: {
    light: require('@/assets/icons/mascot/preview-light.png'),
    dark: require('@/assets/icons/mascot/preview-dark.png'),
  },
  Classic: {
    light: require('@/assets/icons/classic/preview-light.png'),
    dark: require('@/assets/icons/classic/preview-dark.png'),
  },
  Cyber: {
    light: require('@/assets/icons/cyber/preview-light.png'),
    dark: require('@/assets/icons/cyber/preview-light.png'),
  },
  Anime: {
    light: require('@/assets/icons/anime/preview-light.png'),
    dark: require('@/assets/icons/anime/preview-dark.png'),
  },
  Arcade: {
    light: require('@/assets/icons/arcade/preview-light.png'),
    dark: require('@/assets/icons/arcade/preview-dark.png'),
  },
};

function AppIconPicker() {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const { resolvedMode } = useThemeMode();
  const { icon, choose, busy, supported } = useAppIcon();
  if (!supported) return null;
  const labels: Record<AppIconId, string> = {
    default: t`Classic`,
    Mascot: t`Mascot`,
    Classic: t`Classic`,
    Cyber: 'Cyber',
    Anime: 'Anime',
    Arcade: 'Arcade',
  };
  return (
    <SettingsBlock
      label={t`App icon`}
      // Android swaps launcher aliases to change an icon, and the launcher
      // drops the running task with it: the app closes and reopens on the
      // next tap. Said up front rather than discovered.
      caption={
        <Text variant="caption" colorKey="textMuted">
          {process.env.EXPO_OS === 'android'
            ? t`The icon on your home screen. Android closes the app to apply it.`
            : t`The icon on your home screen.`}
        </Text>
      }>
      <ScrollView
        horizontal
        testID="settings-app-icons-scroll"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={iconStyles.row}
        keyboardShouldPersistTaps="handled">
        <View style={iconStyles.row} accessibilityRole="radiogroup">
          {APP_ICON_CHOICES.map((id) => {
            const selected = appIconIsSelected(id, icon);
            return (
              <PressableScale
                key={id}
                accessibilityRole="radio"
                accessibilityState={{ selected, disabled: busy }}
                accessibilityLabel={t`App icon, ${labels[id]}`}
                testID={`settings-app-icon-${id}`}
                disabled={busy}
                onPress={() => {
                  if (!selected) void choose(id);
                }}
                style={iconStyles.tile}>
                <View
                  style={[
                    iconStyles.frame,
                    { borderColor: selected ? theme.colors.primary : 'transparent' },
                  ]}>
                  <Image
                    source={ICON_ART[id][resolvedMode === 'dark' ? 'dark' : 'light']}
                    contentFit="cover"
                    accessible={false}
                    style={iconStyles.art}
                  />
                </View>
                <Text
                  variant="bodySmall"
                  style={{ color: selected ? theme.colors.text : theme.colors.textMuted }}>
                  {labels[id]}
                </Text>
              </PressableScale>
            );
          })}
        </View>
      </ScrollView>
    </SettingsBlock>
  );
}

const ICON_SIZE = 60;

const iconStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 20,
  },
  tile: {
    alignItems: 'center',
    gap: 6,
  },
  // The ring sits outside the art, so the selected icon is the same size as
  // the others and the ring is the only thing that changes.
  frame: {
    padding: 3,
    borderWidth: 2,
    borderRadius: appChrome.radius.control + 5,
    borderCurve: 'continuous',
  },
  art: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    borderRadius: appChrome.radius.control,
    borderCurve: 'continuous',
  },
});
