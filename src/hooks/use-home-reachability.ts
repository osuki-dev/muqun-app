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
import { pairingFaultOf, usePairingFaults } from '@/stores/pairing-faults';
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
 * Each computer's status, folded by `fold`, as an array in `serverIds` order
 * that changes identity only when a folded value does.
 */
function useFoldedStatuses<T>(
  serverIds: readonly string[],
  selectedId: string | undefined,
  activeConnection: ActiveServerConnection | undefined,
  fold: (status: ConnectionStatus) => T
): T[] {
  const channels = useServerChannels(
    useShallow((state) =>
      serverIds.map((serverId) =>
        channelEvidence(state.sockets, state.streams, serverId, serverId === selectedId)
      )
    )
  );
  // What is held against each pairing; a refusal remembered across launches.
  const faults = usePairingFaults(
    useShallow((state) => serverIds.map((serverId) => pairingFaultOf(state, serverId)))
  );
  return useServerReachability(
    useShallow((state) =>
      serverIds.map((serverId, index) =>
        fold(
          resolveConnectionStatus({
            serverId,
            probe: state.probes[serverId],
            activeConnection,
            channels: channelsOf(channels[index]),
            fault: faults[index],
            selected: serverId === selectedId,
            nowMs: state.freshnessNowMs,
          })
        )
      )
    )
  );
}

const asIs = (status: ConnectionStatus) => status;

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
  const statuses = useFoldedStatuses(serverIds, selectedId, activeConnection, asIs);
  return useMemo(
    () => Object.fromEntries(serverIds.map((serverId, index) => [serverId, statuses[index]])),
    [serverIds, statuses]
  );
}

/**
 * Whether each computer is answering: the same statuses, folded to
 * `live`/`offline`/`unknown` inside the selector, so a status that moves
 * without changing the fold (unknown to reconnecting, say) re-renders nothing.
 */
export function useHomeReachability(
  serverIds: readonly string[],
  activeConnection: ActiveServerConnection | undefined
): Readonly<Record<string, ServerReachability>> {
  const reachability = useFoldedStatuses(
    serverIds,
    undefined,
    activeConnection,
    reachabilityOfStatus
  );
  return useMemo(
    () => Object.fromEntries(serverIds.map((serverId, index) => [serverId, reachability[index]])),
    [serverIds, reachability]
  );
}
