import { useLingui } from '@lingui/react/macro';
import { useLocalSearchParams } from 'expo-router';

import { PaneHistorySheet } from '@/components/pane-history-sheet';
import { SheetScene } from '@/components/sheet-scene';
import { Text } from '@osuki-dev/ui';
import { DEMO_SERVER_ID, demoHealth, demoRecord, isDemoActive } from '@/lib/demo-gateway';
import { PANE_CAPTURED_HISTORY_SEGMENTS_CAPABILITY } from '@/lib/terminal-history-segments';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import { useServerCapabilities } from '@/stores/server-capabilities';

export default function PaneHistoryScreen() {
  const { t } = useLingui();
  const params = useLocalSearchParams<{ serverId?: string; sessionId?: string; paneId?: string }>();
  const savedRecord = useGatewayConnectionStore((state) =>
    state.records.find((entry) => entry.serverId === params.serverId)
  );
  const servesSegments = useServerCapabilities((state) =>
    params.serverId
      ? state.byServer[params.serverId]?.includes(PANE_CAPTURED_HISTORY_SEGMENTS_CAPABILITY) ===
        true
      : false
  );
  const demo = params.serverId === DEMO_SERVER_ID && isDemoActive();
  const record = savedRecord ?? (demo ? demoRecord : undefined);
  const enabled = demo
    ? demoHealth().capabilities.includes(PANE_CAPTURED_HISTORY_SEGMENTS_CAPABILITY)
    : servesSegments;
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
