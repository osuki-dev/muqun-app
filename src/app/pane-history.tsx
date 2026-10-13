import { useLingui } from '@lingui/react/macro';
import { useLocalSearchParams } from 'expo-router';

import { PaneHistorySheet } from '@/components/pane-history-sheet';
import { SheetScene } from '@/components/sheet-scene';
import { Text } from '@/components/text';
import { PANE_CAPTURED_HISTORY_SEGMENTS_CAPABILITY } from '@/lib/terminal-history-segments';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import { useServerCapabilities } from '@/stores/server-capabilities';

export default function PaneHistoryScreen() {
  const { t } = useLingui();
  const params = useLocalSearchParams<{ serverId?: string; sessionId?: string; paneId?: string }>();
  const record = useGatewayConnectionStore((state) =>
    state.records.find((entry) => entry.serverId === params.serverId)
  );
  const enabled = useServerCapabilities((state) =>
    params.serverId
      ? state.byServer[params.serverId]?.includes(PANE_CAPTURED_HISTORY_SEGMENTS_CAPABILITY) ===
        true
      : false
  );
  if (!record || !params.sessionId || !params.paneId) {
    return (
      <SheetScene title={t`Saved terminal history`}>
        <Text>{t`Unavailable`}</Text>
      </SheetScene>
    );
  }
  return (
    <PaneHistorySheet
      key={`${params.serverId}/${params.sessionId}/${params.paneId}`}
      record={record}
      sessionId={params.sessionId}
      paneId={params.paneId}
      enabled={enabled}
    />
  );
}
