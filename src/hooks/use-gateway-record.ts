import { useCallback, useEffect } from 'react';

import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import { useSessionControlStore } from '@/stores/session-control';

export function useGatewayRecord() {
  const record = useGatewayConnectionStore((state) => state.record);
  const records = useGatewayConnectionStore((state) => state.records);
  const loading = useGatewayConnectionStore((state) => state.loading);
  const hydrate = useGatewayConnectionStore((state) => state.hydrate);
  const setRecord = useGatewayConnectionStore((state) => state.setRecord);
  const selectGatewayRecord = useGatewayConnectionStore((state) => state.selectRecord);
  const disconnectGateway = useGatewayConnectionStore((state) => state.disconnect);
  const enterDemo = useGatewayConnectionStore((state) => state.enterDemo);
  const renameRecord = useGatewayConnectionStore((state) => state.renameRecord);
  const editRecord = useGatewayConnectionStore((state) => state.editRecord);
  const removeRecordFromStore = useGatewayConnectionStore((state) => state.removeRecord);
  const resetSessionControl = useSessionControlStore((state) => state.reset);

  useEffect(() => {
    if (loading) void hydrate();
  }, [hydrate, loading]);

  const disconnect = useCallback(async () => {
    await disconnectGateway();
    resetSessionControl();
  }, [disconnectGateway, resetSessionControl]);

  const selectRecord = useCallback(
    async (serverId: string) => {
      const selected = await selectGatewayRecord(serverId);
      if (selected) resetSessionControl();
      return selected;
    },
    [resetSessionControl, selectGatewayRecord]
  );

  const removeRecord = useCallback(
    async (serverId: string) => {
      await removeRecordFromStore(serverId);
      resetSessionControl();
    },
    [removeRecordFromStore, resetSessionControl]
  );

  return {
    record,
    records,
    loading,
    setRecord,
    selectRecord,
    enterDemo,
    renameRecord,
    editRecord,
    removeRecord,
    disconnect,
  };
}
