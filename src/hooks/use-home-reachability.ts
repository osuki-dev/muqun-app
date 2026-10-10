import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { useDeadlineNow } from '@/hooks/use-deadline-now';
import {
  REACHABILITY_FRESH_MS,
  resolveServerReachability,
  type ActiveServerConnection,
  type ServerChannels,
  type ServerReachability,
} from '@/lib/server-reachability';
import { useServerChannels } from '@/stores/server-channels';
import { useServerReachability } from '@/stores/server-reachability';

const subscribeProbes = (onChange: () => void) => useServerReachability.subscribe(onChange);

/** The first instant after `afterMs` at which some probe stops being fresh. */
function nextProbeExpiry(afterMs: number): number | undefined {
  let next: number | undefined;
  for (const probe of Object.values(useServerReachability.getState().probes)) {
    const expiresAtMs = probe.checkedAtMs + REACHABILITY_FRESH_MS + 1;
    if (expiresAtMs > afterMs && (next === undefined || expiresAtMs < next)) next = expiresAtMs;
  }
  return next;
}

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
 * A probe landing, a probe being marked as re-checking, a socket retrying: none
 * of them re-render the caller unless a computer's `live`/`offline`/`unknown`
 * moves. Freshness runs on a deadline clock rather than a tick -- the screen
 * learns that a probe has gone stale at the moment it does, and at no other
 * time. `nowMs` is that clock, for children that resolve the same probes.
 */
export function useHomeReachability(
  serverIds: readonly string[],
  activeConnection: ActiveServerConnection | undefined
): { reachabilityByServer: Readonly<Record<string, ServerReachability>>; nowMs: number } {
  const nowMs = useDeadlineNow(subscribeProbes, nextProbeExpiry);
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
          nowMs,
          channelsOf(channels[index])
        )
      )
    )
  );
  const reachabilityByServer = useMemo(
    () => Object.fromEntries(serverIds.map((serverId, index) => [serverId, statuses[index]])),
    [serverIds, statuses]
  );
  return { reachabilityByServer, nowMs };
}
