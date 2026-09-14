import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import { useFocusEffect } from 'expo-router';
import QuickCrypto from 'react-native-quick-crypto';
import {
  loadRecordWorkHealth,
  loadRecordAgentProfiles,
  sendBoundWorkRequest,
  watchBoundWorkChanges,
} from '@/lib/gateway-client';
import type { GatewayRecord } from '@/lib/gateway-storage';
import { createWorkApi } from '@/lib/work-api';
import { WorkController, workCapabilities } from '@/lib/work-controller';
import { WorkControllerCache, workPairingFingerprint } from '@/lib/work-controller-cache';
import { createRecordWorkJournal } from '@/lib/work-journal-native';

// Real pending metadata survives process termination; demo metadata follows its fixture lifetime.
const digest = (text: string) => QuickCrypto.createHash('sha256').update(text).digest('hex');
const controllers = new WorkControllerCache<WorkController>(digest);
// The module cache outlives the task route, so unpairing must retire it even
// when no task component is mounted. Loading failures are not removal events.
useGatewayConnectionStore.subscribe((state) => {
  if (state.loading || state.hydrationError) return;
  const records =
    state.record && !state.records.some((record) => record.serverId === state.record?.serverId)
      ? [...state.records, state.record]
      : state.records;
  controllers.retain(records);
});
function controllerFor(record: GatewayRecord, sessionId: string) {
  return controllers.get(
    record,
    sessionId,
    (captured) =>
      new WorkController(
        createWorkApi(captured, sessionId, sendBoundWorkRequest),
        async (context) =>
          workCapabilities(
            await loadRecordWorkHealth(captured, context),
            captured.serverId,
            sessionId
          ),
        () => QuickCrypto.randomBytes(24).toString('hex'),
        (context) => loadRecordAgentProfiles(captured, context),
        createRecordWorkJournal(captured, {
          pairingFingerprint: workPairingFingerprint(captured, digest),
          sessionId,
        })
      )
  );
}
export function useWorkController(record: GatewayRecord, sessionId: string) {
  const controller = useMemo(() => controllerFor(record, sessionId), [record, sessionId]);
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  );
  useFocusEffect(
    useCallback(() => {
      controller.activate();
      // Re-entry refreshes capability/updates only; an existing reading snapshot stays pinned.
      if (!controller.getSnapshot().tasks.length && !controller.getSnapshot().detail)
        void controller.refresh();
      const timer = setInterval(() => void controller.checkUpdates(), 15000);
      return () => {
        clearInterval(timer);
        controller.deactivate();
      };
    }, [controller])
  );
  const cursor =
    state.view === 'detail' ? state.detail?.cursor : (state.summaryCursor ?? state.detail?.cursor);
  useFocusEffect(
    useCallback(() => {
      if (!state.capabilities.records || cursor === undefined) return;
      const abort = new AbortController();
      void watchBoundWorkChanges(record, sessionId, cursor, {
        signal: abort.signal,
        isCurrent: () => !abort.signal.aborted,
        onChanges: () => controller.notifyUpdates(),
        onReset: () => controller.notifyUpdates(),
        onUnavailable: () => controller.markUnavailable(),
      }).catch(() => {
        /* Read-only changes polling remains the fallback. */
      });
      return () => abort.abort();
    }, [record, sessionId, controller, cursor, state.capabilities.records])
  );
  return { controller, state };
}
