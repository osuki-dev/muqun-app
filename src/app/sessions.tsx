import { useLingui } from '@lingui/react/macro';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { MachineSwitcherSheet, type MachineChoice } from '@/components/machine-switcher-sheet';
import { useGatewayRecord } from '@/hooks/use-gateway-record';
import { loadRecordSessions } from '@/lib/gateway-client';
import { inspectMachine } from '@/lib/machine-switcher';
import { parseSessionChoices, sessionChoices } from '@/lib/session-switcher';
import { useServerSession } from '@/stores/server-session';

export default function SessionSwitcherScreen() {
  const { t } = useLingui();
  const router = useRouter();
  const { record, records, selectRecord } = useGatewayRecord();
  const chooseSession = useServerSession((state) => state.chooseSession);
  const params = useLocalSearchParams<{
    serverId: string;
    sessionId: string;
    sessions?: string;
    embedded?: string;
  }>();
  const [loaded, setLoaded] = useState<Record<string, Pick<MachineChoice, 'sessions' | 'error'>>>(
    {}
  );
  const [pendingId, setPendingId] = useState<string | null>(null);
  // A closed sheet must never switch machines when a slow request finally resolves.
  const generation = useRef(0);
  const busy = useRef(false);
  useEffect(
    () => () => {
      generation.current += 1;
    },
    []
  );
  const saved =
    record && !records.some((item) => item.serverId === record.serverId)
      ? [record, ...records]
      : records;
  const machines: MachineChoice[] = saved.map((item) => ({
    id: item.serverId,
    label: item.label,
    ...(item.serverId === params.serverId
      ? { sessions: parseSessionChoices(params.sessions) }
      : {}),
    ...loaded[item.serverId],
  }));

  async function select(serverId: string, sessionId: string, request: number) {
    if (request !== generation.current) return;
    if (serverId !== params.serverId && !(await selectRecord(serverId)))
      throw new Error('Machine unavailable');
    if (request !== generation.current) return;
    chooseSession({ serverId, sessionId });
    if (serverId === params.serverId || params.embedded === '1') router.back();
    else
      router.dismissTo({
        pathname: '/servers/[serverId]',
        params: {
          serverId,
          sessionId,
          paneId: useServerSession.getState().panesByServer[serverId]?.[sessionId],
        },
      });
  }

  async function connect(serverId: string, sessionId?: string) {
    if (busy.current) return;
    busy.current = true;
    const request = generation.current;
    setPendingId(serverId);
    try {
      const target = saved.find((item) => item.serverId === serverId);
      if (!target) throw new Error('Machine unavailable');
      if (serverId === params.serverId && sessionId) {
        await select(serverId, sessionId, request);
        return;
      }
      const choices = await inspectMachine({
        load: async () => sessionChoices((await loadRecordSessions(target)).sessions),
        current: () => request === generation.current,
        choose: (id) => select(serverId, id, request),
        requested: sessionId ?? useServerSession.getState().byServer[serverId],
      });
      if (!choices) return;
      setLoaded((previous) => ({ ...previous, [serverId]: { sessions: choices } }));
    } catch {
      if (request === generation.current)
        setLoaded((previous) => ({
          ...previous,
          [serverId]: { error: t`Could not connect to this machine — tap to retry` },
        }));
    } finally {
      busy.current = false;
      if (request === generation.current) setPendingId(null);
    }
  }

  return (
    <MachineSwitcherSheet
      machines={machines}
      serverId={params.serverId}
      sessionId={params.sessionId || ''}
      pendingId={pendingId}
      onConnect={(id) => {
        void connect(id);
      }}
      onChoose={(id, sessionId) => {
        void connect(id, sessionId);
      }}
      onClose={() => {
        generation.current += 1;
        router.back();
      }}
      onAdd={() => router.replace('/explore')}
      onManage={() => router.replace('/settings')}
    />
  );
}
