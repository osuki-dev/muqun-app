import { useLingui } from '@lingui/react/macro';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { SessionMap } from '@/components/session-map';
import { usePanelPickerStore } from '@/stores/panel-picker';

/**
 * The panels sheet route: its params, and the one thing only a route can do --
 * hand the pick back through the store, because a sheet cannot return a value
 * without pushing another copy of the server screen.
 *
 * The sheet's own frame belongs to `SessionMap`, so the route adds no layout of
 * its own. A wrapper here that sized itself with `height: '100%'` collapsed to
 * nothing: inside a native form sheet the container's height is not resolved
 * when the percentage is measured, and `flex: 1` is what the other sheets in
 * this app use for exactly that reason.
 */
export default function PanelPickerScreen() {
  const { t } = useLingui();
  const router = useRouter();
  const choosePanel = usePanelPickerStore((state) => state.choosePanel);
  const params = useLocalSearchParams<{
    serverId: string;
    sessionId: string;
    paneId?: string;
    label?: string;
  }>();

  return (
    <SessionMap
      sessionId={params.sessionId || 'default'}
      label={params.label || t`Server`}
      activePaneId={params.paneId}
      onChoosePane={(paneId) => {
        choosePanel({ serverId: params.serverId, paneId });
        router.back();
      }}
      onClose={() => router.back()}
    />
  );
}
