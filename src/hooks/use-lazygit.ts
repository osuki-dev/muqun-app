import { useEffect, useRef, useState } from 'react';
import { Alert, Keyboard } from 'react-native';
import { useLingui } from '@lingui/react/macro';
import { useRouter } from 'expo-router';

import { launchPaneLazygit, paneLazygitAvailable } from '@/lib/gateway-client';
import { recoverWith, settleAfter } from '@/lib/compiler-safe-control-flow';
import { usePanelPickerStore } from '@/stores/panel-picker';

/** One capability-gated launch path for both terminal sheets. */
export function useLazygit({
  enabled,
  sessionId,
  paneId,
  serverId,
}: {
  enabled: boolean;
  sessionId: string;
  paneId: string;
  serverId?: string;
}) {
  const { t } = useLingui();
  const router = useRouter();
  const [availableFor, setAvailableFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const launching = useRef(false);
  const key = `${serverId}:${sessionId}:${paneId}`;
  useEffect(() => {
    if (!enabled || !serverId || !paneId || !sessionId) return;
    let cancelled = false;
    void paneLazygitAvailable(sessionId, paneId).then(
      (available) => {
        if (!cancelled) setAvailableFor(available ? key : null);
      },
      () => {
        if (!cancelled) setAvailableFor(null);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [enabled, key, paneId, serverId, sessionId]);
  const available = enabled && availableFor === key;

  async function open() {
    if (!available || launching.current || !serverId) return;
    launching.current = true;
    setBusy(true);
    Keyboard.dismiss();
    const select = (createdPaneId: string) => {
      usePanelPickerStore.getState().choosePanel({ serverId, paneId: createdPaneId });
      router.back();
    };
    return settleAfter(
      () =>
        recoverWith(
          async () => {
            const target = await launchPaneLazygit(sessionId, paneId);
            if (target.started) select(target.paneId);
            else
              Alert.alert(
                t`Lazygit startup could not be confirmed`,
                t`A terminal was created. Open it to inspect startup; launching again could create a duplicate.`,
                [
                  { text: t`Cancel`, style: 'cancel' },
                  { text: t`Open terminal`, onPress: () => select(target.paneId) },
                ]
              );
          },
          () =>
            Alert.alert(
              t`Could not start a terminal.`,
              t`Check that lazygit is installed on the Gateway host and this pane is in a Git repository.`
            )
        ),
      () => {
        launching.current = false;
        setBusy(false);
      }
    );
  }

  return { available, busy, open };
}
