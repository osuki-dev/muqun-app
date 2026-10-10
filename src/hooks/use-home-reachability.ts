import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';

import {
  resolveConnectionStatus,
  resolveServerReachability,
  type ActiveServerConnection,
  type ConnectionStatus,
  type ServerChannels,
  type ServerReachability,
} from '@/lib/server-reachability';
import { useServerChannels } from '@/stores/server-channels';
import { useServerReachability } from '@/stores/server-reachability';

/**
 * The part of a computer's live channels the folded reachability turns on --
 * open, refusing, or neither -- so a socket cycling through `connecting` and
 * `backoff` against a machine that is down changes nothing here.
 */
function channelEvidence(
  sockets: Readonly<Record<string, string | undefined>>,
  streams: Readonly<Record<string, string | undefined>>,
  serverId: string
): string {
  if (sockets[serverId] === 'open' || streams[serverId] === 'open') return 'open';
  return sockets[serverId] === 'unauthorized' ? 'unauthorized' : '';
}

function channelsOf(evidence: string | undefined): ServerChannels {
  return evidence === 'open' || evidence === 'unauthorized' ? { socket: evidence } : {};
}

/**
 * Whether each computer is answering, for a screen that must re-render only
 * when one of those answers changes.
 *
 * A probe landing, a probe being marked as re-checking, a socket retrying, a
 * probe going stale without its answer changing: none of them re-render the
 * caller unless a computer's `live`/`offline`/`unknown` moves. Freshness is
 * resolved against the store's `freshnessNowMs`, which steps exactly when a
 * probe expires, inside the selector -- the caller holds no clock.
 */
export function useHomeReachability(
  serverIds: readonly string[],
  activeConnection: ActiveServerConnection | undefined
): Readonly<Record<string, ServerReachability>> {
  const channels = useServerChannels(
    useShallow((state) =>
      serverIds.map((serverId) => channelEvidence(state.sockets, state.streams, serverId))
    )
  );
  const statuses = useServerReachability(
    useShallow((state) =>
      serverIds.map((serverId, index) =>
        resolveServerReachability(
          serverId,
          state.probes[serverId],
          activeConnection,
          state.freshnessNowMs,
          channelsOf(channels[index])
        )
      )
    )
  );
  return useMemo(
    () => Object.fromEntries(serverIds.map((serverId, index) => [serverId, statuses[index]])),
    [serverIds, statuses]
  );
}

/**
 * Each computer's connection status (`live`, `unauthorized`, `offline`,
 * `reconnecting` for the selected one, or `unknown`), for a screen that lists
 * them all -- Settings › Computers -- and must re-render only when one of
 * them changes, a probe going stale included (`freshnessNowMs` steps then).
 */
export function useConnectionStatuses(
  serverIds: readonly string[],
  selectedId: string | undefined
): Readonly<Record<string, ConnectionStatus>> {
  const channels = useServerChannels(
    useShallow((state) =>
      serverIds.map(
        (serverId) => `${state.sockets[serverId] ?? ''}|${state.streams[serverId] ?? ''}`
      )
    )
  );
  const statuses = useServerReachability(
    useShallow((state) =>
      serverIds.map((serverId, index) => {
        const [socket, stream] = (channels[index] ?? '|').split('|');
        return resolveConnectionStatus({
          serverId,
          probe: state.probes[serverId],
          channels: {
            ...(socket ? { socket: socket as ServerChannels['socket'] } : {}),
            ...(stream ? { stream: stream as ServerChannels['stream'] } : {}),
          },
          selected: serverId === selectedId,
          nowMs: state.freshnessNowMs,
        });
      })
    )
  );
  return useMemo(
    () => Object.fromEntries(serverIds.map((serverId, index) => [serverId, statuses[index]])),
    [serverIds, statuses]
  );
}
