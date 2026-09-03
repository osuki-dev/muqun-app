import { useCallback, useEffect } from 'react';

import type { GatewayRecord } from '@/lib/gateway-storage';
import type { TunnelPhase } from '@/lib/ssh-tunnel';
import { useSshTunnelsStore } from '@/stores/ssh-tunnels';

export interface GatewayTunnel {
  /** Whether this record is reached through an SSH host at all. */
  tunnelled: boolean;
  /** For a direct record this is always `'open'`; for a tunnelled one it tracks the forward. */
  phase: TunnelPhase;
  /** The live `http://127.0.0.1:<localPort>` for a tunnelled record, else the record's own URL. */
  baseUrl: string | null;
  retry: () => void;
}

/**
 * Hold a record's SSH tunnel open while a screen needs it, and report its
 * status. A direct (non-tunnelled) record reports `open` immediately and holds
 * nothing. Releasing the hold on unmount is what lets the manager tear the
 * forward down once no screen is using the record. See `stores/ssh-tunnels.ts`
 * and `docs/ssh-gateway-tunnel.md`.
 */
export function useGatewayTunnel(
  record: GatewayRecord | null | undefined,
  enabled: boolean
): GatewayTunnel {
  const hold = useSshTunnelsStore((state) => state.hold);
  const release = useSshTunnelsStore((state) => state.release);
  const retryTunnel = useSshTunnelsStore((state) => state.retry);
  const tunnelState = useSshTunnelsStore((state) =>
    record?.sshTunnel ? state.states[record.serverId] : undefined
  );

  const tunnelled = Boolean(record?.sshTunnel);
  const serverId = record?.serverId;
  const hostId = record?.sshTunnel?.hostId;

  useEffect(() => {
    if (!record?.sshTunnel || !enabled) return;
    hold(record);
    return () => release(record);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the identity that matters is the tunnel target, not the record object.
  }, [enabled, tunnelled, serverId, hostId, hold, release]);

  const retry = useCallback(() => {
    if (serverId) retryTunnel(serverId);
  }, [retryTunnel, serverId]);

  if (!tunnelled) {
    return { tunnelled: false, phase: 'open', baseUrl: record?.url ?? null, retry };
  }
  return {
    tunnelled: true,
    phase: tunnelState?.phase ?? 'connecting',
    baseUrl: tunnelState?.baseUrl ?? null,
    retry,
  };
}
