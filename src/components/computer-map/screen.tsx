import { useLingui } from '@lingui/react/macro';
import { useLingui as useLinguiRuntime } from '@lingui/react';
import { useThemeTokens, Text } from '@osuki-dev/ui';
import { useIsFocused, useRouter } from 'expo-router';
import { lazy, Suspense, useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, TurboModuleRegistry, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SettingsChoiceRow } from '@/components/settings-chrome';
import { SettingsSegmented } from '@/components/settings-segmented';
import { SheetScene, SheetSceneFooter } from '@/components/sheet-scene';
import { DEFAULT_MAP_POSE } from '@/components/computer-map/types';
import { MapErrorBoundary } from '@/components/computer-map/error-boundary';
import { useAppActive } from '@/hooks/use-app-active';
import { useGatewayRecord } from '@/hooks/use-gateway-record';
import { useConnectionStatuses } from '@/hooks/use-home-reachability';
import { connectionStatusDescription } from '@/i18n/labels';
import { APP_NODE_ID, computerConnectionMap } from '@/lib/computer-connection-map';
import { serversToProbe } from '@/lib/server-reachability';
import { useFleetPeers } from '@/stores/fleet-peers';
import { useServerReachability } from '@/stores/server-reachability';

// An older binary can still use the list without evaluating the native module.
const GpuMap = lazy(() => import('@/components/computer-map/gpu-map'));

export default function ComputerMapScreen() {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const { colors } = useThemeTokens();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const active = useAppActive();
  const reducedMotion = useReducedMotion();
  const { records, record, loading, hydrationError } = useGatewayRecord();
  const statuses = useConnectionStatuses(
    records.map((server) => server.serverId),
    record?.serverId
  );
  const peers = useFleetPeers((state) => state.byServer);
  const peerReads = useFleetPeers((state) => state.statusByServer);
  const refresh = useServerReachability((state) => state.refreshMany);
  const [selectedId, setSelectedId] = useState(APP_NODE_ID);
  const [pose, setPose] = useState(DEFAULT_MAP_POSE);
  const [view, setView] = useState('map');
  const [failed, setFailed] = useState(false);
  const [nativeAvailable] = useState(
    () => Platform.OS !== 'web' && TurboModuleRegistry.get('WebGPUModule') !== null
  );
  const graph = computerConnectionMap(records, statuses, peers, t`This app`);
  const selectedServer = records.find((server) => `computer:${server.serverId}` === selectedId);
  const selectedPeers = selectedServer ? peers[selectedServer.serverId] : undefined;
  const selectedPeerRead = selectedServer ? peerReads[selectedServer.serverId] : undefined;
  const sceneColors = {
    live: colors.success,
    offline: colors.textMuted,
    unknown: colors.textMuted,
    unauthorized: colors.danger,
    repair: colors.warning,
    reconnecting: colors.warning,
    background: colors.background,
    foreground: colors.text,
    accent: colors.primary,
  };
  const showGpu =
    view === 'map' && nativeAvailable && !failed && !reducedMotion && records.length > 0;

  useEffect(() => {
    if (!focused || !active) return;
    let live = true;
    void refresh(
      serversToProbe(
        records.filter((server) => !server.sshTunnel),
        {},
        record?.serverId
      ),
      { shouldContinue: () => live }
    );
    return () => {
      live = false;
    };
  }, [active, focused, record?.serverId, records, refresh]);

  return (
    <SheetScene testID="computer-map-screen" title={t`Connection map`}>
      <ScrollView contentContainerStyle={styles.content}>
        <SettingsSegmented
          testID="computer-map-mode"
          value={view}
          onChange={setView}
          options={[
            { value: 'map', label: t`Map` },
            { value: 'list', label: t`List` },
          ]}
        />
        {loading ? (
          <Text variant="bodySmall">{t`Loading computers`}</Text>
        ) : hydrationError ? (
          <Text variant="bodySmall">{t`Could not load computers. Open Computers to try again.`}</Text>
        ) : records.length === 0 ? (
          <Text testID="computer-map-empty" variant="bodySmall">{t`No computers paired yet`}</Text>
        ) : null}
        {showGpu && focused && active ? (
          <MapErrorBoundary onError={() => setFailed(true)}>
            <Suspense fallback={<Text variant="caption">{t`Loading map…`}</Text>}>
              <GpuMap
                graph={graph}
                selectedId={selectedId}
                pose={pose}
                colors={sceneColors}
                onPose={setPose}
                onSelect={setSelectedId}
                onError={() => setFailed(true)}
              />
            </Suspense>
          </MapErrorBoundary>
        ) : null}
        {showGpu ? (
          <>
            <Text
              variant="caption"
              color={colors.textMuted}>{t`Drag to rotate · Pinch to zoom · Tap to select`}</Text>
            <Text
              variant="caption"
              color={
                colors.textMuted
              }>{t`Lines: this app. Dashed arrows: last reported computer links.`}</Text>
            <SettingsChoiceRow
              label={t`Reset view`}
              accessibilityLabel={t`Reset view`}
              value=""
              onPress={() => setPose(DEFAULT_MAP_POSE)}
            />
          </>
        ) : view === 'map' && records.length > 0 ? (
          <Text testID="computer-map-fallback" variant="caption" color={colors.textMuted}>
            {reducedMotion
              ? t`Reduced motion: list view.`
              : t`3D unavailable. Connections are listed below.`}
          </Text>
        ) : null}
        {showGpu && (graph.omittedComputers || graph.omittedPeerEdges) ? (
          <Text
            variant="caption"
            color={colors.textMuted}>{t`Some connections are omitted from the map.`}</Text>
        ) : null}
        {selectedServer ? (
          <View
            testID="computer-map-detail"
            style={[styles.detail, { borderColor: colors.border }]}>
            <Text variant="body" weight="semibold">
              {selectedServer.label}
            </Text>
            <Text variant="bodySmall">
              {_(connectionStatusDescription[statuses[selectedServer.serverId] ?? 'unknown'])}
            </Text>
            <Text
              variant="caption"
              color={colors.textMuted}>{t`Last reported by this computer`}</Text>
            {selectedPeers && selectedPeerRead !== undefined && selectedPeerRead !== 'ok' ? (
              <Text
                variant="caption"
                color={colors.warning}>{t`Could not refresh. This report may be outdated.`}</Text>
            ) : null}
            {!selectedPeers ? (
              <Text variant="caption">{t`No peer report available.`}</Text>
            ) : (
              <>
                <Text variant="caption">
                  {selectedPeers.acceptDelegations ? t`Accepting work` : t`Not accepting work`}
                </Text>
                {selectedPeers.peers.length === 0 && !selectedPeers.unidentified?.length ? (
                  <Text variant="caption">{t`No reported links.`}</Text>
                ) : (
                  selectedPeers.peers.map((peer) => (
                    <Text key={peer.peerId} variant="caption">
                      {selectedServer.label} →{' '}
                      {records.find((server) => server.serverId === peer.serverId)?.label ??
                        peer.name}
                      :{' '}
                      {peer.unauthorized
                        ? t`Pairing expired`
                        : peer.reachable
                          ? t`Reported reachable`
                          : t`Reported unreachable`}
                    </Text>
                  ))
                )}
              </>
            )}
            <SettingsChoiceRow
              label={t`Computer details`}
              accessibilityLabel={t`Computer details`}
              value=""
              onPress={() =>
                router.push({
                  pathname: '/settings-servers',
                  params: { serverId: selectedServer.serverId },
                })
              }
            />
          </View>
        ) : null}
        <SettingsChoiceRow
          label={t`This app`}
          accessibilityLabel={t`This app`}
          value=""
          onPress={() => setSelectedId(APP_NODE_ID)}
        />
        {records.map((server) => (
          <SettingsChoiceRow
            key={server.serverId}
            accessibilityLabel={`${server.label}, ${_(connectionStatusDescription[statuses[server.serverId] ?? 'unknown'])}`}
            testID={`computer-map-node-${server.serverId}`}
            label={server.label}
            value={_(connectionStatusDescription[statuses[server.serverId] ?? 'unknown'])}
            detail={`computer:${server.serverId}` === selectedId ? t`Selected` : undefined}
            onPress={() => setSelectedId(`computer:${server.serverId}`)}
          />
        ))}
        <SheetSceneFooter bottomInset={insets.bottom} />
      </ScrollView>
    </SheetScene>
  );
}
const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, gap: 12 },
  detail: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 16, gap: 10 },
});
