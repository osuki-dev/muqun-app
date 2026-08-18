/**
 * The lock on the front door.
 *
 * One row, and it stays one section rather than being folded into ALERTS: what
 * the app may interrupt you with and who may open it at all are not the same
 * question, and a reader looking for the second one should not have to read
 * past four switches about buzzing to find it.
 *
 * The availability probe lives here rather than on the screen, which is the
 * point of the split: asking the OS what kind of authentication this device has
 * -- on mount and again on every return to the foreground -- used to set state
 * on the whole settings page.
 */
import { useLingui } from '@lingui/react/macro';
import { useToast } from '@osuki-dev/ui';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { SettingsSection, SettingsToggleRow } from '@/components/settings-chrome';
import { feedback } from '@/lib/feedback';
import {
  authenticateForAppUnlock,
  getLocalAuthAvailability,
  type LocalAuthAvailability,
} from '@/lib/local-authentication';
import { useRenderTally } from '@/lib/render-tally';
import { useAppSettings } from '@/stores/app-settings';

export function SettingsSecurity({ title }: { title: string }) {
  const { t } = useLingui();
  const { showToast } = useToast();
  useRenderTally('SettingsSecurity');

  const appLockEnabled = useAppSettings((state) => state.appLockEnabled);
  const update = useAppSettings((state) => state.update);
  const [authAvailability, setAuthAvailability] = useState<LocalAuthAvailability | null>(null);
  const [changing, setChanging] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const availability = await getLocalAuthAvailability();
        if (!cancelled) setAuthAvailability(availability);
      } catch {
        // Keep the conservative unavailable state when the OS cannot answer.
      }
    };
    void refresh();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  async function changeAppLock(enabled: boolean) {
    if (changing) return;
    if (!enabled) {
      await update({ appLockEnabled: false });
      await feedback('selection');
      return;
    }

    setChanging(true);
    try {
      const availability = authAvailability ?? (await getLocalAuthAvailability());
      if (!authAvailability) setAuthAvailability(availability);
      if (!availability.available || !availability.enrolled) {
        showToast({
          variant: 'warning',
          title: t`App Lock unavailable`,
          message: t`Set up ${availability.label} in system settings first.`,
        });
        return;
      }
      const result = await authenticateForAppUnlock(availability.label);
      if (!result.success) return;
      await update({ appLockEnabled: true });
      await feedback('success');
      showToast({
        variant: 'success',
        title: t`App Lock enabled`,
        message: t`Muqun will use ${availability.label} when the app opens.`,
      });
    } catch {
      showToast({
        variant: 'danger',
        title: t`Could not enable App Lock`,
        message: t`Check device authentication settings and try again.`,
      });
    } finally {
      setChanging(false);
    }
  }

  return (
    <SettingsSection title={title}>
      <SettingsToggleRow
        label={t`Unlock with ${authAvailability?.label ?? t`device authentication`}`}
        detail={
          appLockEnabled
            ? t`Required on launch and after 30 seconds in the background.`
            : authAvailability?.available && authAvailability.enrolled
              ? t`Protect paired servers and terminal sessions.`
              : authAvailability
                ? t`Set up ${authAvailability.label} in system settings first.`
                : t`Checking system authentication…`
        }
        disabled={changing || !authAvailability}
        value={appLockEnabled}
        onValueChange={(value) => void changeAppLock(value)}
      />
    </SettingsSection>
  );
}
