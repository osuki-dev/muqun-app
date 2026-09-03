import { Text, useThemeMode, useThemeTokens, useToast } from '@osuki-dev/ui';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { StatusBar } from 'expo-status-bar';
import { openBrowserAsync, WebBrowserPresentationStyle } from 'expo-web-browser';
import {
  ChevronRight,
  ExternalLink,
  Info,
  Mail,
  MessageSquare,
  Settings2,
  ShieldCheck,
} from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Linking, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Trans, useLingui } from '@lingui/react/macro';

import { NAV_HEADER_CONTROL_SIZE } from '@/components/nav-header';
import { ScreenHeader } from '@/components/screen-header';
import { SettingsAlerts } from '@/components/settings-alerts';
import { SettingsAppearance } from '@/components/settings-appearance';
import {
  LADDER,
  SettingsInfoRow,
  SettingsNavRow,
  SettingsSection,
} from '@/components/settings-chrome';
import { SettingsSecurity } from '@/components/settings-security';
import { SettingsServers } from '@/components/settings-servers';
import { SettingsTerminal } from '@/components/settings-terminal';
import { FEEDBACK_URL, PRIVACY_POLICY_URL, SUPPORT_EMAIL } from '@/constants/links';
import { NAV_HEADER_TOP_GAP } from '@/constants/nav-header';
import { feedback } from '@/lib/feedback';
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

/**
 * Everything the app can be told, in the order a reader asks for it.
 *
 * The order is the whole of the redesign's argument and it is worth stating.
 * The page this replaces was in the order the features landed: appearance,
 * security, alerts, servers, a one-row `Home screen`, terminal, feedback,
 * about. Five theme cards and a nine-language grid -- two decisions made once
 * per install -- occupied the entire first screen, and the paired machines, the
 * only thing on the page that changes week to week, sat below the fold under
 * two sections about switches.
 *
 * Now: the machines first, because that is what the app is about and what a
 * returning reader comes here for. Appearance second rather than last, for one
 * reason -- it holds the language list, and a reader who launched the app in a
 * language they cannot read cannot scroll past six English headings looking for
 * it. Then the two sections about how the app behaves (the terminal, then what
 * it is allowed to do when nobody is watching), then the lock on the front
 * door, then the app itself. Nine sections became six: `Home screen` moved
 * inside SERVERS, next to the list it describes, and `Feedback and support`
 * merged into ABOUT, which is where a reader looks for a way to reach a human.
 *
 * Nothing was dropped. Every control the old page could reach, this one can.
 */
export default function SettingsScreen() {
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
  const { showToast } = useToast();
  const { resolvedMode } = useThemeMode();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isPadLayout = responsiveWorkspaceLayout(width).mode === 'pad';
  useRenderTally('SettingsScreen');

  /**
   * Whether the four sections below the fold have been built yet.
   *
   * A phone shows SERVERS and the top of APPEARANCE when this page arrives;
   * TERMINAL, ALERTS, SECURITY and ABOUT are off the bottom of the screen, and
   * building them on the same frame as the ones the reader can see costs about
   * a third of the page's mount for nothing they are looking at. `SECURITY` is
   * the worst of them -- it asks the OS what kind of authentication this device
   * has the moment it mounts.
   *
   * `requestIdleCallback` rather than a timer, because the beat being waited
   * for is "the push has stopped asking for frames", not a number of
   * milliseconds -- and not `InteractionManager.runAfterInteractions`, which
   * says the same thing and is deprecated in React Native 0.86. The `timeout`
   * is the guarantee: a device that never goes idle still builds the rest of
   * the page a quarter of a second in.
   *
   * The scroll handler is the escape hatch, because a reader who flicks before
   * the push has finished is exactly the person this must not keep waiting --
   * one `setState` on the first scroll event, and the handler is dropped after
   * it.
   */
  const [deep, setDeep] = useState(false);
  useEffect(() => {
    const handle = requestIdleCallback(() => setDeep(true), { timeout: 250 });
    return () => cancelIdleCallback(handle);
  }, []);

  const version = Constants.expoConfig?.version ?? Application.nativeApplicationVersion ?? '1.1.0';
  const build = Application.nativeBuildVersion;

  async function openPrivacyPolicy() {
    await feedback('selection');
    await openBrowserAsync(PRIVACY_POLICY_URL, {
      presentationStyle: WebBrowserPresentationStyle.AUTOMATIC,
    });
  }

  async function openFeedback() {
    await feedback('selection');
    await openBrowserAsync(FEEDBACK_URL, {
      presentationStyle: WebBrowserPresentationStyle.AUTOMATIC,
    });
  }

  async function openSupportEmail() {
    await feedback('selection');
    const subject = encodeURIComponent(`Muqun ${version} feedback`);
    // A mail client is the only sensible handler, so fall back to showing the
    // address if the device has none configured.
    const opened = await Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${subject}`)
      .then(() => true)
      .catch(() => false);
    if (!opened) {
      showToast({
        variant: 'info',
        title: t`No mail app configured`,
        message: t`Reach us at ${SUPPORT_EMAIL}.`,
      });
    }
  }

  return (
    <View style={[styles.page, { backgroundColor: theme.colors.background }]}>
      <StatusBar animated style={resolvedMode === 'dark' ? 'light' : 'dark'} />

      <RenderTally id="settings">
        <ScrollView
          contentContainerStyle={[styles.content, { paddingTop: insets.top + HEADER_INSET }]}
          contentInsetAdjustmentBehavior="never"
          onScroll={deep ? undefined : () => setDeep(true)}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}>
          <SettingsServers title={t`Servers`} />
          <SettingsAppearance title={t`Appearance`} />

          {/* Everything below here is off the bottom of a phone when the page
              opens, so it is built on the frame after the push finishes rather
              than on the frame the reader is waiting for. See `deep`. */}
          {deep ? (
            <>
              {/* Servers stay full-width because their count is dynamic, and
                  Appearance keeps its segmented controls at their intended
                  width. The independent sections below can share rows on Pad;
                  their source order stays the compact reading order. */}
              <View
                testID="settings-responsive-grid"
                style={[styles.deepSections, isPadLayout && styles.deepSectionsPad]}>
                <View style={[styles.deepSection, isPadLayout && styles.deepSectionPad]}>
                  <SettingsTerminal title={t`Terminal`} />
                </View>
                <View style={[styles.deepSection, isPadLayout && styles.deepSectionPad]}>
                  <SettingsAlerts title={t`Alerts`} />
                </View>
                <View style={[styles.deepSection, isPadLayout && styles.deepSectionPad]}>
                  <SettingsSecurity title={t`Security`} />
                </View>

                {/* `Feedback and support` used to be a section of its own
                    directly above this one. Two two-row groups, both of them "the
                    app itself rather than anything it does", stacked with a
                    heading between them: one group, in the order a reader needs
                    them -- tell us something, ask us something, read the policy,
                    quote the build. */}
                <View style={[styles.deepSection, isPadLayout && styles.deepSectionPad]}>
                  <SettingsSection title={t`About`}>
                    <SettingsNavRow
                      icon={MessageSquare}
                      trailing={ExternalLink}
                      label={t`Report a bug or request a feature`}
                      detail={t`Opens the Muqun issue tracker on GitHub.`}
                      onPress={() => void openFeedback()}
                    />
                    <SettingsNavRow
                      icon={Mail}
                      trailing={ChevronRight}
                      label={t`Contact us`}
                      detail={SUPPORT_EMAIL}
                      onPress={() => void openSupportEmail()}
                    />
                    <SettingsNavRow
                      icon={ShieldCheck}
                      trailing={ExternalLink}
                      label={t`Privacy policy`}
                      onPress={() => void openPrivacyPolicy()}
                    />
                    <SettingsInfoRow
                      icon={Info}
                      label={t`Muqun`}
                      detail={
                        <Trans>
                          Version {version}
                          {build ? ` (${build})` : ''}
                        </Trans>
                      }
                    />
                  </SettingsSection>
                </View>
              </View>

              <View style={styles.footer}>
                <Settings2 size={16} color={theme.colors.textMuted} strokeWidth={2} />
                <Text variant="caption" color={theme.colors.textMuted}>
                  <Trans>Muqun settings stay on this device.</Trans>
                </Text>
              </View>
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
        <View pointerEvents="box-none" style={styles.headerContent}>
          <ScreenHeader title={t`Settings`} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  header: { position: 'absolute', top: 0, left: 0, right: 0 },
  headerContent: {
    width: '100%',
    maxWidth: SETTINGS_CONTENT_MAX_WIDTH,
    alignSelf: 'center',
  },
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
});
