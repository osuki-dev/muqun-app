import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';

import {
  reachabilityOfStatus,
  resolveConnectionStatus,
  type ActiveServerConnection,
  type ConnectionStatus,
  type ServerChannels,
  type ServerReachability,
} from '@/lib/server-reachability';
import { useServerChannels } from '@/stores/server-channels';
import { useServerReachability } from '@/stores/server-reachability';

/**
 * The part of a computer's live channels its status can turn on: open,
 * refusing, or -- for the selected computer only, the one that can be
 * `reconnecting` -- retrying. Anything else is nothing, so a socket cycling
 * through `connecting` and `backoff` against another machine changes nothing
 * here.
 */
function channelEvidence(
  sockets: Readonly<Record<string, string | undefined>>,
  streams: Readonly<Record<string, string | undefined>>,
  serverId: string,
  selected: boolean
): string {
  if (sockets[serverId] === 'open' || streams[serverId] === 'open') return 'open';
  if (sockets[serverId] === 'unauthorized') return 'unauthorized';
  if (
    selected &&
    (sockets[serverId] === 'connecting' ||
      sockets[serverId] === 'backoff' ||
      streams[serverId] === 'retrying')
  )
    return 'retrying';
  return '';
}

function channelsOf(evidence: string | undefined): ServerChannels {
  if (evidence === 'open' || evidence === 'unauthorized') return { socket: evidence };
  return evidence === 'retrying' ? { socket: 'connecting' } : {};
}

/**
 * Each computer's connection status, for every screen that shows one -- Home,
 * Settings › Computers, a guide deciding whether it can run its command -- and
 * that must re-render only when one of those statuses changes.
 *
 * A probe landing, a probe being marked as re-checking, a socket retrying
 * against a machine that is not selected, a probe going stale without its
 * answer changing: none of them re-render the caller unless a status moves.
 * Freshness is resolved against the store's `freshnessNowMs`, which steps
 * exactly when a probe expires, inside the selector -- the caller holds no
 * clock. `selectedId` is the computer that may read `reconnecting`.
 */
export function useConnectionStatuses(
  serverIds: readonly string[],
  selectedId: string | undefined,
  activeConnection?: ActiveServerConnection
): Readonly<Record<string, ConnectionStatus>> {
  const channels = useServerChannels(
    useShallow((state) =>
      serverIds.map((serverId) =>
        channelEvidence(state.sockets, state.streams, serverId, serverId === selectedId)
      )
    )
  );
  const statuses = useServerReachability(
    useShallow((state) =>
      serverIds.map((serverId, index) =>
        resolveConnectionStatus({
          serverId,
          probe: state.probes[serverId],
          activeConnection,
          channels: channelsOf(channels[index]),
          selected: serverId === selectedId,
          nowMs: state.freshnessNowMs,
        })
      )
    )
  );
  return useMemo(
    () => Object.fromEntries(serverIds.map((serverId, index) => [serverId, statuses[index]])),
    [serverIds, statuses]
  );
}

/** Whether each computer is answering: the same statuses, folded to `live`/`offline`/`unknown`. */
export function useHomeReachability(
  serverIds: readonly string[],
  activeConnection: ActiveServerConnection | undefined
): Readonly<Record<string, ServerReachability>> {
  const statuses = useConnectionStatuses(serverIds, undefined, activeConnection);
  return useMemo(
    () =>
      Object.fromEntries(
        serverIds.map((serverId) => [
          serverId,
          reachabilityOfStatus(statuses[serverId] ?? 'unknown'),
        ])
      ),
    [serverIds, statuses]
  );
}
