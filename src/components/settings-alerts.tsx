/**
 * Everything the app is allowed to do when nobody is looking at it: buzz, post
 * a notification, hold a Lock Screen card, keep a home-screen tile warm.
 *
 * Grouped together because that is the question a reader arrives with -- "stop
 * it doing that" -- and answered in one section rather than spread between
 * ALERTS and a one-row HOME SCREEN further down.
 */
import { useLingui } from '@lingui/react/macro';
import { Platform } from 'react-native';

import { SettingsSection, SettingsToggleRow } from '@/components/settings-chrome';
import { clearAgentWidget, isAgentWidgetSupported } from '@/lib/agent-widget';
import { endAgentActivity, isLiveActivitySupported } from '@/lib/live-activity';
import { useRenderTally } from '@/lib/render-tally';
import { useAppSettings } from '@/stores/app-settings';

export function SettingsAlerts({ title }: { title: string }) {
  const { t } = useLingui();
  useRenderTally('SettingsAlerts');

  const androidWidgetEnabled = useAppSettings((state) => state.androidWidgetEnabled);
  const hapticsEnabled = useAppSettings((state) => state.hapticsEnabled);
  const liveActivityEnabled = useAppSettings((state) => state.liveActivityEnabled);
  const notificationsEnabled = useAppSettings((state) => state.notificationsEnabled);
  const update = useAppSettings((state) => state.update);

  const liveActivitySupported = isLiveActivitySupported();
  const agentWidgetSupported = isAgentWidgetSupported();

  return (
    <SettingsSection title={title}>
      <SettingsToggleRow
        label={t`Haptic feedback`}
        detail={t`Confirm taps, pairing, and gateway events.`}
        value={hapticsEnabled}
        onValueChange={(value) => void update({ hapticsEnabled: value })}
      />
      <SettingsToggleRow
        label={t`Gateway notifications`}
        detail={t`Receive agent blocks and gateway updates.`}
        value={notificationsEnabled}
        onValueChange={(value) => void update({ notificationsEnabled: value })}
      />
      {/* Live Activities are an iOS surface. Off iOS the row is not shown at
          all rather than shown permanently greyed out; the disabled state is
          kept for an iOS device that only needs to update. */}
      {Platform.OS === 'ios' ? (
        <SettingsToggleRow
          label={t`Live Activity`}
          detail={
            liveActivitySupported
              ? t`Keep the terminal you are watching on the Lock Screen while its agent works.`
              : t`Requires iOS 16.1 or later.`
          }
          value={liveActivityEnabled}
          disabled={!liveActivitySupported}
          onValueChange={(value) => {
            // Switching off has to clear the card as well as the preference:
            // a Live Activity outlives the screen that started it.
            if (!value) void endAgentActivity('immediate');
            void update({ liveActivityEnabled: value });
          }}
        />
      ) : null}
      {/* iOS has the Lock Screen card instead, so the row is not shown there
          rather than shown permanently greyed out. */}
      {agentWidgetSupported ? (
        <SettingsToggleRow
          label={t`Home screen widget`}
          detail={t`Show agents and their status on the home screen. Updates while Muqun is open.`}
          value={androidWidgetEnabled}
          onValueChange={(value) => {
            // The tile outlives the app, so switching off has to wipe what it
            // is showing as well as the preference.
            if (!value) void clearAgentWidget();
            void update({ androidWidgetEnabled: value });
          }}
        />
      ) : null}
    </SettingsSection>
  );
}
