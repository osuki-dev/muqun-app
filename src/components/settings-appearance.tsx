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
import { Text, useThemeMode, useThemeTokens } from '@osuki-dev/ui';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { SettingsBlock, SettingsChoiceRow, SettingsSection } from '@/components/settings-chrome';
import { PressableScale } from '@/components/pressable-scale';
import { SettingsSegmented } from '@/components/settings-segmented';
import { appChrome } from '@/constants/appearance';
import { useAppIcon } from '@/hooks/use-app-icon';
import { type AppIconId, APP_ICONS } from '@/lib/app-icon';
import { useThemePack } from '@/hooks/use-theme-pack';
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
  const pack = useThemePack();
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
 * read, and a wrapping grid of pictures says what a segmented control of two words
 * cannot. Each tile draws the cut for the current mode, the way the home
 * screen would.
 */
const ICON_ART: Record<AppIconId, { light: number; dark: number }> = {
  default: {
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
    default: t`Mascot`,
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
        process.env.EXPO_OS === 'android'
          ? t`The icon on your home screen. Android closes the app to apply it.`
          : t`The icon on your home screen.`
      }>
      <View style={iconStyles.row} accessibilityRole="radiogroup">
        {APP_ICONS.map((id) => {
          const selected = id === icon;
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
    </SettingsBlock>
  );
}

const ICON_SIZE = 60;

const iconStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
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
