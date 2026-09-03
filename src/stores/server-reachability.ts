import { create } from 'zustand';

import { probeGatewayReachable } from '@/lib/gateway-client';
import { directGatewayBaseUrl } from '@/lib/ssh-tunnel';
import type { GatewayRecord } from '@/lib/gateway-storage';
import {
  needsReachabilityProbe,
  REACHABILITY_TIMEOUT_MS,
  type ReachabilityProbe,
} from '@/lib/server-reachability';

/**
 * Whether the servers on the home screen are answering.
 *
 * Never persisted, and that is the point: a probe result describes this second.
 * Reading a stored "online" off disk at launch and painting a green dot with it
 * would recreate exactly the lie this replaced.
 *
 * ## Why only one server is probed
 *
 * Each paired record carries its own gateway token. Probing every card would
 * put every one of those tokens on the wire every time the list is drawn --
 * which is the same reason the agent mirror exists instead of a fan-out query
 * (see `lib/server-agents.ts`). So the list probes the server the app is
 * already configured for and nothing else, and says `NOT CONNECTED` about the
 * rest, which is the truthful description of a machine nobody asked.
 */
type ServerReachabilityState = {
  probes: Record<string, ReachabilityProbe>;
  /**
   * Probe one server unless a recent enough answer is already on hand.
   * Safe to call on every focus; it is its own rate limiter.
   *
   * `force` skips that limit and is for a pull-to-refresh and nothing else.
   * The limiter exists because returning to a screen is not a question; a hand
   * pulling the list down is, and answering it with a cached probe is how a
   * refresh control comes to mean nothing.
   */
  refresh: (
    endpoint: Pick<
      GatewayRecord,
      'serverId' | 'url' | 'token' | 'deviceId' | 'transportKey' | 'transport'
    > & Pick<GatewayRecord, 'sshTunnel'>,
    options?: { force?: boolean }
  ) => Promise<void>;
  /** Drops results for servers this device no longer has. */
  keepOnly: (serverIds: readonly string[]) => void;
};

/**
 * One flight per server. Two screens mounting together, or a focus event
 * arriving while a probe is still out, must not each open a connection.
 */
const inFlight = new Set<string>();

export const useServerReachability = create<ServerReachabilityState>((set, get) => ({
  probes: {},

  async refresh(endpoint, options) {
    const { serverId } = endpoint;
    // A tunnelled record is never probed at its stored `url`: that address
    // belongs to the SSH host, and for a loopback-only gateway probing it from
    // here would put the bearer token on *this phone's* loopback, which the
    // threat model treats as hostile (`docs/ssh-gateway-tunnel.md`, T1). The
    // callers already skip these; this is the structural half of that, so a new
    // caller cannot reintroduce the leak. A tunnelled server reports through
    // its tunnel badge instead.
    if (!directGatewayBaseUrl(endpoint)) return;
    // Still one flight per server even when forced: two pulls in a second are
    // one question, and the second would only race the first.
    if (inFlight.has(serverId)) return;
    if (!options?.force && !needsReachabilityProbe(get().probes[serverId])) return;

    inFlight.add(serverId);
    try {
      const ok = await probeGatewayReachable(endpoint, REACHABILITY_TIMEOUT_MS);
      set((state) => ({
        probes: { ...state.probes, [serverId]: { serverId, ok, checkedAtMs: Date.now() } },
      }));
    } finally {
      inFlight.delete(serverId);
    }
  },

  keepOnly(serverIds) {
    const known = new Set(serverIds);
    const probes = Object.fromEntries(
      Object.entries(get().probes).filter(([serverId]) => known.has(serverId))
    );
    if (Object.keys(probes).length === Object.keys(get().probes).length) return;
    set({ probes });
  },
}));
