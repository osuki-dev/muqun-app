import { useLingui as useLinguiRuntime } from '@lingui/react';
import { useLingui } from '@lingui/react/macro';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { ComputerIcon } from '@/icons';
import { ScrollView, View } from 'react-native';
import { useCallback, useEffect, useMemo } from 'react';
import { useIsFocused, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  SheetScene,
  SheetSceneFooter,
  SheetSceneRow,
  sheetSceneStyles,
} from '@/components/sheet-scene';
import { reachabilityDescription } from '@/i18n/labels';
import { useAppActive } from '@/hooks/use-app-active';
import { useGatewayRecord } from '@/hooks/use-gateway-record';
import { useMinuteNow } from '@/hooks/use-minute-now';
import { useTaskAge } from '@/hooks/use-task-age';
import { homeTargetRow } from '@/lib/home-composer';
import { DEMO_SERVER_ID } from '@/lib/demo-gateway';
import { directGatewayBaseUrl } from '@/lib/ssh-tunnel';
import { REACHABILITY_RECHECK_MS, serversToProbe } from '@/lib/server-reachability';
import { useHomeTargetPicker } from '@/stores/home-target-picker';
import { useServerLastViewed } from '@/stores/server-last-viewed';
import { useServerAgents } from '@/stores/server-agents';
import { useServerReachability } from '@/stores/server-reachability';

/**
 * Native route for choosing the gateway a Home quick action should target.
 * Choosing a row only updates the route-local picker handoff; it never selects
 * the live gateway connection.
 */
export function HomeTargetSheet() {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const theme = useThemeTokens();
  const navigation = useNavigation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const appActive = useAppActive();
  const isFocused = useIsFocused();
  const params = useLocalSearchParams<{ requestId?: string }>();
  const { record, records } = useGatewayRecord();
  const lastViewedByServer = useServerLastViewed((state) => state.byServer);
  const refreshReachabilityMany = useServerReachability((state) => state.refreshMany);
  const requestId = Number(params.requestId);
  const openRequestId = useHomeTargetPicker((state) => state.openRequestId);
  const selectedServerId = useHomeTargetPicker((state) => state.selectedServerId);
  const reachabilityByServer = useHomeTargetPicker((state) => state.reachabilityByServer);
  const agentsByServer = useServerAgents((state) => state.byServer);
  const age = useTaskAge();
  const nowMs = useMinuteNow();
  const choose = useHomeTargetPicker((state) => state.choose);
  const close = useHomeTargetPicker((state) => state.close);
  const requestIsActive = Number.isSafeInteger(requestId) && requestId === openRequestId;
  const selected = records.find((server) => server.serverId === selectedServerId);
  const probeTargets = useMemo(
    () =>
      serversToProbe(
        records.filter(
          (server) =>
            server.serverId !== DEMO_SERVER_ID &&
            !server.sshTunnel &&
            directGatewayBaseUrl(server) !== null
        ),
        lastViewedByServer,
        selectedServerId ?? record?.serverId
      ),
    [lastViewedByServer, record?.serverId, records, selectedServerId]
  );

  // `removed` covers swipe, hardware back and programmatic dismissal. The
  // cleanup only unregisters the listener, so StrictMode cannot cancel a live
  // request during its setup/cleanup probe. The event fires after the screen
  // unmounts, so the cleanup unsubscribes a microtask later, as its contract
  // asks.
  useEffect(() => {
    if (!Number.isSafeInteger(requestId)) return;
    const unsubscribe = navigation.addListener('removed', () => close(requestId));
    return () => queueMicrotask(unsubscribe);
  }, [close, navigation, requestId]);

  const refreshVisibleTargets = useCallback(
    (shouldContinue: () => boolean) => {
      void refreshReachabilityMany(probeTargets, { shouldContinue });
    },
    [probeTargets, refreshReachabilityMany]
  );

  useEffect(() => {
    if (!requestIsActive || !isFocused || !appActive) return;
    let current = true;
    const shouldContinue = () => current && isFocused && appActive;
    refreshVisibleTargets(shouldContinue);
    const timer = setInterval(() => {
      if (shouldContinue()) refreshVisibleTargets(shouldContinue);
    }, REACHABILITY_RECHECK_MS);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [appActive, isFocused, refreshVisibleTargets, requestIsActive]);

  function select(serverId: string) {
    if (!requestIsActive || !records.some((server) => server.serverId === serverId)) return;
    // An offline computer is listed, never chosen.
    if (reachabilityByServer[serverId] === 'offline') return;
    choose(requestId, serverId);
    close(requestId);
    router.back();
  }

  const contentSized = records.length <= 5;

  const rows = records.map((server) => {
    const reachability = reachabilityByServer[server.serverId] ?? 'unknown';
    const lastSeenMs = agentsByServer[server.serverId]?.checkedAtMs;
    const row = homeTargetRow({
      serverId: server.serverId,
      reachability,
      currentServerId: selectedServerId,
      ...(lastSeenMs !== undefined ? { lastSeenMs } : {}),
    });
    const caption =
      row.lastSeenMs !== undefined
        ? t`Offline · last seen ${age(row.lastSeenMs, nowMs)}`
        : _(reachabilityDescription[reachability]);
    // The current computer stays marked while it is offline: nothing switches on its own.
    const currentOffline = requestIsActive && row.current && row.offline;
    return (
      <SheetSceneRow
        key={server.serverId}
        testID={`home-target-${server.serverId}`}
        title={server.label}
        caption={caption}
        selected={requestIsActive && row.current}
        disabled={!row.selectable}
        meta={
          currentOffline ? (
            <Text variant="caption" weight="semibold" color={theme.colors.warning}>
              {t`Current`}
            </Text>
          ) : undefined
        }
        accessibilityLabel={[server.label, currentOffline ? t`Current` : null, caption]
          .filter(Boolean)
          .join(', ')}
        leading={
          <ComputerIcon
            size={20}
            color={reachability === 'live' ? theme.colors.success : theme.colors.textMuted}
          />
        }
        onPress={() => select(server.serverId)}
      />
    );
  });

  return (
    <SheetScene
      testID="home-target-sheet"
      title={t`Choose a computer`}
      caption={selected?.label}
      contentSized={contentSized}>
      {contentSized ? (
        <View style={sheetSceneStyles.scrollerContent}>
          {rows}
          <SheetSceneFooter bottomInset={insets.bottom} />
        </View>
      ) : (
        <ScrollView
          nestedScrollEnabled
          style={sheetSceneStyles.scroller}
          contentContainerStyle={sheetSceneStyles.scrollerContent}
          showsVerticalScrollIndicator={false}>
          {rows}
          <SheetSceneFooter bottomInset={insets.bottom} />
        </ScrollView>
      )}
    </SheetScene>
  );
}
