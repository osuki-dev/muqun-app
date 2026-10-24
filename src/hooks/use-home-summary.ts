import { useServerTasksStore } from '@/stores/server-tasks';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { startHomeSummary } from '@/lib/home-summary-controller';
import { HOME_SUMMARY_CAPABILITY } from '@/lib/home-summary';
import { gatewaySocketFor } from '@/lib/gateway-socket-runtime';
import { useHomeSummary } from '@/stores/home-summary';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import { useServerCapabilities } from '@/stores/server-capabilities';

export function useHomeSummarySync(serverIds: readonly string[], enabled: boolean) {
  const config = useHomeSummary((state) => state.config);
  const records = useGatewayConnectionStore((state) => state.records);
  const summaryIds = useServerCapabilities(
    useShallow((state) =>
      records
        .map((record) => record.serverId)
        .filter(
          (id) =>
            state.byServer[id]?.includes(HOME_SUMMARY_CAPABILITY) &&
            records.some((record) => record.serverId === id && !record.sshTunnel)
        )
    )
  );
  const eligible = JSON.stringify(summaryIds);
  const paired = JSON.stringify(records.map((record) => record.serverId));
  useEffect(() => {
    useHomeSummary.getState().keepOnly(JSON.parse(paired) as string[]);
    if (!enabled) return;
    let close: (() => void) | undefined;
    const start = () => {
      close?.();
      close = undefined;
      if (AppState.currentState !== 'active') return;
      close = startHomeSummary({
        pairedIds: JSON.parse(paired) as string[],
        summaryIds: JSON.parse(eligible) as string[],
        config,
        schedule: (run, delayMs) => {
          const timer = setTimeout(run, delayMs);
          return () => clearTimeout(timer);
        },
        connect: (id, sources, receive, lost) => {
          const socket = gatewaySocketFor(id);
          const releaseState = socket.onStateChange((state) => {
            if (
              state === 'backoff' ||
              state === 'unauthorized' ||
              state === 'unavailable' ||
              state === 'superseded'
            )
              lost();
          });
          const release = socket.watchHome(sources, { onHome: receive, onUnavailable: lost });
          return {
            close: () => {
              releaseState();
              release();
            },
          };
        },
        accept: (frame) => {
          if (frame.t === 'home_status') {
            useHomeSummary.getState().disconnected(frame.sourceId);
            return true;
          }
          const previous = useHomeSummary.getState().summaries[frame.sourceId];
          const accepted = useHomeSummary.getState().accept(frame);
          const advanced =
            previous?.generation !== frame.generation || frame.revision > previous.revision;
          if (accepted && advanced && frame.defaultCwd !== undefined)
            useServerTasksStore.getState().setDefaultCwd(frame.sourceId, frame.defaultCwd);
          return accepted;
        },
        clear: () => useHomeSummary.getState().disconnected(),
        selected: (collectorId) => useHomeSummary.setState({ collectorId }),
      });
    };
    start();
    const listener = AppState.addEventListener('change', start);
    return () => {
      listener.remove();
      close?.();
    };
  }, [eligible, paired, config, enabled]);
  return useHomeSummary(useShallow((state) => serverIds.filter((id) => !state.live[id])));
}
