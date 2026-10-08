import { useLingui } from '@lingui/react/macro';
import { useToast } from '@osuki-dev/ui';
import { openBrowserAsync, WebBrowserPresentationStyle } from 'expo-web-browser';
import { BookOpen, Code, ExternalLink, MessageSquare, ShieldCheck } from 'lucide-react-native';
import { ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SettingsCard, SettingsNavRow } from '@/components/settings-chrome';
import { SheetScene, SheetSceneFooter } from '@/components/sheet-scene';
import { FEEDBACK_URL, PRIVACY_POLICY_URL, SOURCE_URL, SUPPORT_GUIDE_URL } from '@/constants/links';
import { feedback } from '@/lib/feedback';

export default function SettingsAboutScreen() {
  const { t } = useLingui();
  const { showToast } = useToast();
  const insets = useSafeAreaInsets();

  /**
   * The manual, and the one row on this page that can fail in the reader's hand.
   *
   * The three rows under it open with the same call and do not guard it, which
   * is a gap rather than a precedent -- but this is the row a reader reaches
   * *because* something is already not working, and a rejected promise on that
   * row is a tap that does nothing and says nothing. The toast is the app's
   * existing one; it never throws, and the row stays where it was.
   */
  async function openGuide() {
    await feedback('selection');
    try {
      await openBrowserAsync(SUPPORT_GUIDE_URL, {
        presentationStyle: WebBrowserPresentationStyle.AUTOMATIC,
      });
    } catch {
      showToast({
        variant: 'warning',
        title: t`Could not open the guide`,
        message: t`No app on this phone opens web pages. The guide is at muqun.dev/support.`,
      });
    }
  }

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

  async function openSource() {
    await feedback('selection');
    await openBrowserAsync(SOURCE_URL, {
      presentationStyle: WebBrowserPresentationStyle.AUTOMATIC,
    });
  }

  return (
    <SheetScene testID="settings-about-sheet" title={t`About`}>
      <ScrollView contentInsetAdjustmentBehavior="never" showsVerticalScrollIndicator={false}>
        <SettingsCard flush>
          {/* First in the group, and above "report a bug" on purpose:
                        a reader who cannot work something out should meet the
                        manual before they meet the issue tracker. It carries a
                        glyph like every other row in this card, so the four
                        labels keep one left edge. */}
          <SettingsNavRow
            icon={BookOpen}
            trailing={ExternalLink}
            accessibilityRole="link"
            label={t`How to use Muqun`}
            detail={t`Guides for pairing, the terminal, agents and themes`}
            testID="settings-guide-row"
            onPress={() => void openGuide()}
          />
          <SettingsNavRow
            icon={MessageSquare}
            trailing={ExternalLink}
            label={t`Report a bug or request a feature`}
            detail={t`Opens the Muqun issue tracker on GitHub.`}
            onPress={() => void openFeedback()}
          />
          <SettingsNavRow
            icon={Code}
            trailing={ExternalLink}
            label={t`Source code`}
            onPress={() => void openSource()}
          />
          <SettingsNavRow
            icon={ShieldCheck}
            trailing={ExternalLink}
            label={t`Privacy policy`}
            onPress={() => void openPrivacyPolicy()}
          />
        </SettingsCard>
        <SheetSceneFooter bottomInset={insets.bottom} />
      </ScrollView>
    </SheetScene>
  );
}
