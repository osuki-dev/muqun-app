import { useLingui } from '@lingui/react/macro';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { SessionMap } from '@/components/session-map';
import { useGatewayRecord } from '@/hooks/use-gateway-record';
import { useLatestRef } from '@/hooks/use-render-refs';
import { loadRecordSessions } from '@/lib/gateway-client';
import { inspectMachine } from '@/lib/machine-switcher';
import { panelPickerDestination } from '@/lib/panel-picker-navigation';
import { parseSessionChoices, sessionChoices } from '@/lib/session-switcher';
import type { MachineChoice } from '@/lib/switcher-rails';
import { usePanelPickerStore } from '@/stores/panel-picker';
import { useServerSession } from '@/stores/server-session';
import { recoverWith, rethrow, settleAfter } from '@/lib/compiler-safe-control-flow';

/**
 * The one switcher sheet's route: its params, the machine connections the sheet
 * itself must not make, and the one thing only a route can do -- hand the pick
 * back through the store, because a sheet cannot return a value without pushing
 * another copy of the server screen.
 *
 * The sheet's own frame belongs to `SessionMap`, so the route adds no layout of
 * its own. A wrapper here that sized itself with `height: '100%'` collapsed to
 * nothing: inside a native form sheet the container's height is not resolved
 * when the percentage is measured, and `flex: 1` is what the other sheets in
 * this app use for exactly that reason.
 *
 * No `onClose` to hand down either: the sheet has no close button, because the
 * grabber and the swipe are the close.
 *
 * ## The machines half
 *
 * Everything below `connect` came from `sessions.tsx`, which was the route
 * behind the header's second button. Reaching a machine is a request, a
 * pending state and a navigation, none of which a picker should own, so it
 * stays in the route exactly as it was -- the sheet asks, this answers.
 *
 * The `sessions` param is the list the header had already decided from rather
 * than a read this screen makes for itself: the header concluded there was
 * something to switch between from that list, a second read could disagree with
 * it, and the rail would grow a chip while the sheet was opening.
 */
export default function PanelPickerScreen() {
  const { t } = useLingui();
  const router = useRouter();
  const choosePanel = usePanelPickerStore((state) => state.choosePanel);
  const { record, records, selectRecord } = useGatewayRecord();
  const chooseSession = useServerSession((state) => state.chooseSession);
  const params = useLocalSearchParams<{
    serverId: string;
    sessionId: string;
    paneId?: string;
    label?: string;
    sessions?: string;
    intent?: string;
    embedded?: string;
  }>();
  const [loaded, setLoaded] = useState<Record<string, Pick<MachineChoice, 'sessions' | 'error'>>>(
    {}
  );
  const [pendingId, setPendingId] = useState<string | null>(null);
  // A closed sheet must never switch machines when a slow request finally resolves.
  const generation = useRef(0);
  const busy = useRef(false);
  const routeKey = JSON.stringify([params.serverId, params.sessionId, params.intent ?? '']);
  const latestRouteKey = useLatestRef(routeKey);
  useEffect(() => {
    generation.current += 1;
    return () => {
      generation.current += 1;
    };
  }, [routeKey]);
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
    const destination = panelPickerDestination({
      newTerminal: params.intent === 'new-terminal',
      embedded: params.embedded === '1',
      choice: 'session',
      sameServer: serverId === params.serverId,
    });
    if (destination === 'picker') {
      router.setParams({
        serverId,
        sessionId,
        paneId: '',
        label: saved.find((server) => server.serverId === serverId)?.label ?? params.label,
        sessions: '',
      });
      return;
    }
    chooseSession({ serverId, sessionId });
    if (destination === 'previous') router.back();
    else
      router.dismissTo({
        pathname: '/servers/[serverId]',
        params: {
          serverId,
          sessionId,
          paneId: useServerSession.getState().panesByServer[serverId]?.[sessionId],
        },
      } as Href);
  }

  async function connect(serverId: string, sessionId?: string) {
    if (busy.current) return;
    busy.current = true;
    const request = generation.current;
    setPendingId(serverId);
    return settleAfter(
      async () => {
        return recoverWith(
          async () => {
            const target = saved.find((item) => item.serverId === serverId);
            if (!target) rethrow(new Error('Machine unavailable'));
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
          },
          () => {
            if (request === generation.current)
              setLoaded((previous) => ({
                ...previous,
                [serverId]: { error: t`Could not connect to this machine — tap to retry` },
              }));
          }
        );
      },
      () => {
        busy.current = false;
        if (request === generation.current) setPendingId(null);
      }
    );
  }

  function openPane(paneId: string) {
    if (latestRouteKey.current !== routeKey) return;
    const destination = panelPickerDestination({
      newTerminal: params.intent === 'new-terminal',
      embedded: params.embedded === '1',
      choice: 'pane',
      sameServer: true,
    });
    if (params.intent === 'new-terminal')
      chooseSession({ serverId: params.serverId, sessionId: params.sessionId || 'default' });
    choosePanel({ serverId: params.serverId, paneId });
    if (destination === 'workspace') {
      router.replace({
        pathname: '/servers/[serverId]',
        params: { serverId: params.serverId, sessionId: params.sessionId || 'default', paneId },
      } as Href);
    } else router.back();
  }

  return (
    <SessionMap
      sessionId={params.sessionId || 'default'}
      label={params.label || record?.label || t`Server`}
      activePaneId={params.paneId}
      onChoosePane={openPane}
      onCreatedPane={params.intent === 'new-terminal' ? openPane : undefined}
      machines={machines}
      serverId={params.serverId}
      pendingId={pendingId}
      onConnectMachine={(id) => {
        void connect(id);
      }}
      onChooseSession={(id, sessionId) => {
        void connect(id, sessionId);
      }}
      onAddMachine={() => router.replace('/explore')}
      onManageMachines={() => router.replace('/settings')}
    />
  );
}
