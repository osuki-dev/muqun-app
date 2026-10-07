import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { ThemeArtwork, useHasThemeArtwork } from '@/components/theme-artwork';
import { brandMark } from '@/components/brand-mark';
import { useThemeMode, useThemeTokens } from '@osuki-dev/ui';
import { Text } from '@/components/text';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import {
  HardDrive,
  Info,
  Palette,
  Bell,
  Terminal,
  ChevronRight,
  Server,
  Settings2,
} from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Trans, useLingui } from '@lingui/react/macro';

import { NAV_HEADER_CONTROL_SIZE } from '@/components/nav-header';
import { ScreenHeader } from '@/components/screen-header';
import { SettingsRegistration } from '@/components/settings-registration';
import { LADDER, SettingsNavRow, SettingsSection } from '@/components/settings-chrome';
import { SettingsSecurity } from '@/components/settings-security';
import { NAV_HEADER_TOP_GAP } from '@/constants/nav-header';
import { RenderTally, useRenderTally } from '@/lib/render-tally';
import { responsiveWorkspaceLayout } from '@/lib/responsive-layout';

/**
 * Settings stay comfortably readable when the route fills a tablet window.
 *
 * `width: '100%'` keeps the phone layout unchanged. The cap only takes effect
 * when the scene is wider than the content needs to be.
 */
const SETTINGS_CONTENT_MAX_WIDTH = 760;

/**
 * The height the floating header takes out of the top of the page.
 *
 * The header is laid over the scroll rather than stacked above it, which is how
 * the server page carries its own pills: content passes under the glass instead
 * of stopping at a band. `NAV_HEADER_TOP_GAP` + the header's controls + its own
 * 8 of bottom padding, plus a `gap` so the first section label clears the glass
 * rather than starting under it.
 */
const HEADER_INSET = NAV_HEADER_TOP_GAP + NAV_HEADER_CONTROL_SIZE + 8 + LADDER.gap;

/** Settings keeps server management behind a single entry above appearance. */
export default function SettingsScreen() {
  const router = useRouter();
  const profile = useAppearanceProfile();
  const surfaceBackground = useSurfaceBackground();
  // Loose text on this page -- the two lines below the last card -- has no card
  // under it, so against a pack's wallpaper it is read on whatever the picture
  // happens to put there. `SettingsSection` already solved this for its
  // instrument labels; these two are the only other bare strings on the page.
  const hasShell = useHasThemeArtwork('shell.wallpaper');
  // `t` from the hook, not the global `t` from `@lingui/core/macro`.
  //
  // React Compiler is enabled, and it will memoize a global `t` call whose
  // arguments have not changed -- it has no way to know the result also depends
  // on the active locale. The symptom is a half-translated screen after a
  // language switch: `<Trans>` elements move and everything built from a `t`
  // call keeps the old language. The hook's `t` is bound to the Lingui context,
  // so the compiler sees a dependency that actually changes.
  const { t } = useLingui();
  const theme = useThemeTokens();
  const { resolvedMode } = useThemeMode();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isPadLayout = responsiveWorkspaceLayout(width).mode === 'pad';
  // The hugging plate `SettingsSection` already gives its instrument labels,
  // for the two bare strings at the end of the page that have no card of their
  // own. `null` when no pack supplies a wallpaper: on a flat ground the text is
  // read against `background` either way, and a plate there is a box nobody
  // asked for.
  const plate = hasShell
    ? {
        backgroundColor: surfaceBackground(theme.colors.background),
        paddingHorizontal: LADDER.gap,
        paddingVertical: LADDER.tight,
        borderRadius: profile.radius.sm,
        overflow: 'hidden' as const,
      }
    : null;
  useRenderTally('SettingsScreen');

  // Defer the lower entries and native security check until navigation settles.
  const [deep, setDeep] = useState(false);
  useEffect(() => {
    const handle = requestIdleCallback(() => setDeep(true), { timeout: 250 });
    return () => cancelIdleCallback(handle);
  }, []);

  const version = Constants.expoConfig?.version ?? Application.nativeApplicationVersion ?? '1.1.0';
  const build = Application.nativeBuildVersion;

  return (
    <View style={[styles.page, { backgroundColor: surfaceBackground(theme.colors.background) }]}>
      <ThemeArtwork slot="shell.wallpaper" />
      <StatusBar animated style={resolvedMode === 'dark' ? 'light' : 'dark'} />

      <RenderTally id="settings">
        <ScrollView
          contentContainerStyle={[styles.content, { paddingTop: insets.top + HEADER_INSET }]}
          contentInsetAdjustmentBehavior="never"
          onScroll={deep ? undefined : () => setDeep(true)}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}>
          <SettingsSection title={t`Servers`}>
            <SettingsNavRow
              icon={Server}
              trailing={ChevronRight}
              label={t`Servers`}
              testID="settings-servers-row"
              onPress={() => router.push('/settings-servers')}
            />
          </SettingsSection>
          <SettingsSection title={t`Appearance`}>
            <SettingsNavRow
              icon={Palette}
              trailing={ChevronRight}
              label={t`Appearance`}
              testID="settings-appearance-row"
              onPress={() => router.push('/settings-appearance')}
            />
          </SettingsSection>

          {/* Everything below here is off the bottom of a phone when the page
              opens, so it is built on the frame after the push finishes rather
              than on the frame the reader is waiting for. See `deep`. */}
          {deep ? (
            <>
              {/* The remaining groups share columns on tablets. */}
              <View
                testID="settings-responsive-grid"
                style={[styles.deepSections, isPadLayout && styles.deepSectionsPad]}>
                <View style={[styles.deepSection, isPadLayout && styles.deepSectionPad]}>
                  <SettingsSection title={t`Terminal`}>
                    <SettingsNavRow
                      icon={Terminal}
                      trailing={ChevronRight}
                      label={t`Terminal`}
                      testID="settings-terminal-row"
                      onPress={() => router.push('/settings-terminal')}
                    />
                  </SettingsSection>
                </View>
                <View style={[styles.deepSection, isPadLayout && styles.deepSectionPad]}>
                  <SettingsSection title={t`Alerts`}>
                    <SettingsNavRow
                      icon={Bell}
                      trailing={ChevronRight}
                      label={t`Alerts`}
                      testID="settings-alerts-row"
                      onPress={() => router.push('/settings-alerts')}
                    />
                  </SettingsSection>
                </View>
                <View style={[styles.deepSection, isPadLayout && styles.deepSectionPad]}>
                  <SettingsSecurity title={t`Security`} />
                </View>

                <View style={[styles.deepSection, isPadLayout && styles.deepSectionPad]}>
                  <SettingsSection title={t`Storage`}>
                    <SettingsNavRow
                      icon={HardDrive}
                      trailing={ChevronRight}
                      label={t`Storage`}
                      testID="settings-storage-row"
                      onPress={() => router.push('/settings-storage')}
                    />
                  </SettingsSection>
                </View>
                <View style={[styles.deepSection, isPadLayout && styles.deepSectionPad]}>
                  <SettingsSection title={t`About`}>
                    <SettingsNavRow
                      icon={Info}
                      trailing={ChevronRight}
                      label={t`About`}
                      testID="settings-about-row"
                      onPress={() => router.push('/settings-about')}
                    />
                  </SettingsSection>
                </View>
              </View>

              <View style={[styles.footer, plate ? { ...plate, alignSelf: 'flex-start' } : null]}>
                <Settings2 size={16} color={theme.colors.textMuted} strokeWidth={2} />
                <Text variant="caption" color={theme.colors.textMuted} style={styles.footerText}>
                  <Trans>Muqun settings stay on this device.</Trans>
                </Text>
              </View>

              {/* The end of the page, and the only thing on this screen that is
                  the app rather than a setting. The version used to be a row in
                  `About`, which is where a reader looks for it deliberately --
                  but it is also the thing anyone is asked to quote in a bug
                  report, and a centred line under the mark is easier to find
                  and to read back than the trailing detail of a list row.
                  It is here *instead of* there, not as well: the same string
                  twice on one screen is a question about whether they agree. */}
              <View style={styles.brand}>
                <Image
                  // The rendered mascot with a real alpha channel, not the
                  // launcher icon: that one carries an opaque plate, which on a
                  // themed page reads as a square nobody asked for. Two cuts,
                  // because the dark master is lit for a dark ground and its
                  // rim would fringe on a light one. `resolvedMode` rather than
                  // the system scheme, so a theme chosen in Appearance counts.
                  source={brandMark(resolvedMode)}
                  style={styles.brandMark}
                  contentFit="contain"
                  // Decorative: the version beneath it already names the app,
                  // and the screen is titled `Settings`.
                  accessible={false}
                />
                <Text
                  variant="caption"
                  color={theme.colors.textMuted}
                  // Centred under the mark, so the plate hugs from the middle
                  // rather than from the leading edge.
                  style={
                    plate
                      ? { ...styles.brandVersion, ...plate, alignSelf: 'center' }
                      : styles.brandVersion
                  }>
                  <Trans>
                    Version {version}
                    {build ? ` (${build})` : ''}
                  </Trans>
                </Text>
              </View>
              <SettingsRegistration />
            </>
          ) : null}
        </ScrollView>
      </RenderTally>

      {/* Last, and absolutely positioned, so the page scrolls underneath the
          glass rather than stopping at it -- the same relationship the server
          page's pills have with the terminal behind them. It used to sit in a
          band above the scroll, which is the one thing on this screen that
          could not have come from the same app as the server page. */}
      <View pointerEvents="box-none" style={styles.header}>
        <ScreenHeader title={t`Settings`} contentMaxWidth={SETTINGS_CONTENT_MAX_WIDTH} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  header: { position: 'absolute', top: 0, left: 0, right: 0 },
  content: {
    width: '100%',
    maxWidth: SETTINGS_CONTENT_MAX_WIDTH,
    alignSelf: 'center',
    paddingHorizontal: LADDER.gutter,
    paddingBottom: LADDER.section + LADDER.gutter,
    gap: LADDER.section,
  },
  deepSections: {
    gap: LADDER.section,
  },
  deepSectionsPad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: LADDER.gutter,
  },
  deepSection: { minWidth: 0 },
  deepSectionPad: {
    flexBasis: '48%',
    flexGrow: 1,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: LADDER.gap,
    paddingHorizontal: LADDER.tight,
  },
  // A row lays its children out at their intrinsic width, so this line ran past
  // the plate's right edge in any language whose translation is longer than the
  // English -- Japanese renders it as 牧群（ぼくぐん）の設定は…, half again as
  // wide. Shrinking is what lets it wrap instead. `minWidth: 0` goes with it
  // because `flexShrink` alone will not take a box below its content width.
  footerText: { flexShrink: 1, minWidth: 0 },
  brand: {
    alignItems: 'center',
    gap: LADDER.tight,
    // The page's own `gap: LADDER.section` already sits above this, so the mark
    // is not crowded by the line about settings staying on the device.
    paddingBottom: LADDER.gutter,
  },
  // Larger than the flat mark was: this artwork is rendered with depth and
  // reads as a smudge below about this size.
  brandMark: { width: 88, height: 88 },
  // Centred even when the string wraps, which it does in the locales that spell
  // `Version` out at length.
  brandVersion: { textAlign: 'center' },
});
