import { create } from 'zustand';

import {
  probeGatewayReachable,
  setGatewayAnswerObserver,
  type HealthResponse,
} from '@/lib/gateway-client';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import { noteGatewayGeneration } from '@/stores/gateway-connection-generation';
import { assertSupportedHerdr } from '@/lib/herdr-compatibility';
import { directGatewayBaseUrl } from '@/lib/ssh-tunnel';
import type { GatewayRecord } from '@/lib/gateway-storage';
import { faultProbeDue } from '@/lib/pairing-faults';
import { pairingFaultOf, usePairingFaults } from '@/stores/pairing-faults';
import { useServerCapabilities } from '@/stores/server-capabilities';
import { retryHomeRefresh } from '@/lib/home-refresh-schedule';
import {
  needsReachabilityProbe,
  prewarmGate,
  REACHABILITY_FRESH_MS,
  REACHABILITY_TIMEOUT_MS,
  settleReachabilityProbe,
  statusRefusesPairing,
  type ReachabilityProbe,
} from '@/lib/server-reachability';

/**
 * Whether the servers on the home screen are answering.
 *
 * Never persisted, and that is the point: a probe result describes this second.
 * Reading a stored "online" off disk at launch and painting a green dot with it
 * would recreate exactly the lie this replaced.
 *
 * ## Why the fan-out is bounded rather than forbidden
 *
 * Each paired record carries its own gateway token, so a list that probed every
 * card would put every one of those tokens on the wire every time it was drawn
 * -- the same concern that makes the agent mirror a mirror instead of a fan-out
 * query (see `lib/server-agents.ts`). This used to be answered by probing one
 * server, the configured one, and saying `NOT CONNECTED` about the rest.
 *
 * That answer was truthful and unhelpful: the screen exists to say which
 * machines are up, and someone with three of them saw one light and two shrugs.
 * So the ceiling moved from one to `MAX_PROBED_SERVERS`, ordered by
 * `serversToProbe` -- and the guards that actually protect the token stayed
 * exactly where they were. A tunnelled record is still never probed, each token
 * still goes only to the server that issued it, the per-server rate limit still
 * applies, and `refreshMany` asks one server at a time.
 */
type ServerReachabilityState = {
  probes: Record<string, ReachabilityProbe>;
  /**
   * The instant probe freshness is resolved against. It advances only when
   * some probe goes stale (`REACHABILITY_FRESH_MS` after it answered), so a
   * selector that resolves reachability with it re-runs exactly then -- and a
   * screen re-renders only if an answer moved -- instead of on a ticking clock.
   * It may lag the wall clock, but never across an expiry.
   */
  freshnessNowMs: number;
  /**
   * Probe one server unless a recent enough answer is already on hand.
   * Safe to call on every focus; it is its own rate limiter.
   *
   * `force` skips that limit for an explicit refresh or computer selection.
   * Returning to a screen can reuse a recent answer; choosing a computer or
   * pulling the list down asks for its current status. In-flight checks are
   * still shared, including when forced.
   */
  refresh: (
    endpoint: ReachabilityEndpoint,
    options?: { force?: boolean; shouldContinue?: () => boolean }
  ) => Promise<void>;
  /**
   * Probe several servers, one after another.
   *
   * Sequential on purpose, and it is the half of the fan-out that keeps it
   * cheap. Four simultaneous TLS handshakes on a cold radio is exactly the kind
   * of launch cost that shows up as heat rather than as a slow screen, and
   * nothing here is waiting on the result: the dots fill in as the answers
   * arrive, in the order the reader is most likely to care about them.
   *
   * The caller decides who is in the list -- see `serversToProbe`. This only
   * guarantees that being in it costs one request at a time.
   */
  refreshMany: (
    endpoints: readonly ReachabilityEndpoint[],
    options?: { force?: boolean; shouldContinue?: () => boolean }
  ) => Promise<void>;
  /** Drops results for servers this device no longer has. */
  keepOnly: (serverIds: readonly string[]) => void;
};

/** The fields a probe needs, and deliberately nothing else. */
export type ReachabilityEndpoint = Pick<
  GatewayRecord,
  'serverId' | 'url' | 'token' | 'deviceId' | 'transportKey' | 'transport' | 'sshTunnel'
>;

/**
 * One flight per server. Two screens mounting together, or a focus event
 * arriving while a probe is still out, must not each open a connection.
 *
 * The promise is kept, not just the fact of it, so a second caller *joins* the
 * flight instead of returning to a store that has not been written yet. That
 * matters now the warm path waits on this: the home screen's dot probe and its
 * workspace prewarm both want the same `/health`, they start on the same focus,
 * and whichever loses the race has to be able to await the winner rather than
 * conclude there is no answer and ask again.
 */
const inFlight = new Map<string, Promise<void>>();

export const useServerReachability = create<ServerReachabilityState>((set, get) => ({
  probes: {},
  freshnessNowMs: Date.now(),

  async refresh(endpoint, options) {
    if (options?.shouldContinue?.() === false) return;
    const { serverId } = endpoint;
    // A tunnelled record is never probed at its stored `url`: that address
    // belongs to the SSH host, and for a loopback-only gateway probing it from
    // here would put the bearer token on *this phone's* loopback, which the
    // threat model treats as hostile (`docs/ssh-gateway-tunnel.md`, T1). The
    // callers already skip these; this is the structural half of that, so a new
    // caller cannot reintroduce the leak. A tunnelled server reports through
    // its tunnel badge instead.
    if (!directGatewayBaseUrl(endpoint)) return;
    // A computer that refused this pairing outright -- pair again for
    // encryption, or the token is dead -- is not asked again on every focus:
    // it said no, and will say no until the reader pairs again. It is still
    // asked once a launch and every few minutes after (`faultProbeDue`), and
    // a pull to refresh is still a question: an answer that takes the token
    // clears the entry (`noteAnswer`), which is how a refusal that was forged,
    // or a gateway rolled back, undoes itself without the reader's help.
    if (
      !options?.force &&
      pairingFaultOf(usePairingFaults.getState(), serverId) &&
      !faultProbeDue(get().probes[serverId]?.checkedAtMs, Date.now())
    )
      return;
    // Still one flight per server even when forced: two pulls in a second are
    // one question, and the second would only race the first. Awaited rather
    // than skipped so the loser of the race sees the answer -- see `inFlight`.
    const pending = inFlight.get(serverId);
    if (pending) return pending;
    if (!options?.force && !needsReachabilityProbe(get().probes[serverId])) return;

    const previous = get().probes[serverId];
    const startedAtMs = Date.now();
    // A re-check is in flight. Subscribers that only care about the answer
    // select it, so marking the probe re-renders nothing that draws a dot.
    if (previous) {
      set((state) => ({
        probes: { ...state.probes, [serverId]: { ...previous, rechecking: true } },
      }));
    }
    const flight = (async () => {
      let health: HealthResponse | null = null;
      // Held in a box: TypeScript does not see a closure assign a `let`.
      const heard: { status: number | null } = { status: null };
      const onStatus = (status: number) => {
        heard.status = status;
      };
      const ok = await probeGatewayReachable(
        endpoint,
        REACHABILITY_TIMEOUT_MS,
        (body) => {
          const answer = body as HealthResponse & Parameters<typeof assertSupportedHerdr>[0];
          noteGatewayGeneration(serverId, answer);
          if (answer?.capabilities) {
            void useServerCapabilities.getState().record(serverId, answer.capabilities);
          }
          // Kept for the warm only once it passes the same gate `loadHealth`
          // applies. A gateway whose terminal backend is down is reachable -- the
          // dot stays green and that is correct -- but its health must not become
          // a licence for the prewarm to go on and ask for workspaces. Leaving
          // `health` null there sends the warm back through `loadHealth`, which
          // raises the real reason and is caught where it always was.
          try {
            assertSupportedHerdr(answer);
            health = answer;
          } catch {
            health = null;
          }
        },
        onStatus
      );
      // A timeout or a reset says nothing about the pairing; only an answer
      // does, so an earlier refusal stands until the gateway says otherwise.
      const unauthorized =
        heard.status === null
          ? (get().probes[serverId]?.unauthorized ?? false)
          : statusRefusesPairing(heard.status);
      set((state) => ({
        probes: {
          ...state.probes,
          [serverId]: settleReachabilityProbe(
            state.probes[serverId],
            {
              serverId,
              ok,
              checkedAtMs: Date.now(),
              health: ok ? health : null,
              status: heard.status,
              ...(unauthorized ? { unauthorized } : {}),
            },
            startedAtMs
          ),
        },
      }));
      // An answer is contact: Continue stops backing off from this computer,
      // and nothing held against its pairing stands.
      if (ok) {
        retryHomeRefresh(serverId);
        usePairingFaults.getState().noteAnswer(serverId);
      }
    })();
    inFlight.set(serverId, flight);
    try {
      await flight;
    } finally {
      inFlight.delete(serverId);
      // Only reached with the flag still set when the flight threw before
      // writing its answer; the held answer must not outlive it.
      const held = get().probes[serverId];
      if (held?.rechecking) {
        set((state) => ({
          probes: { ...state.probes, [serverId]: { ...held, rechecking: false } },
        }));
      }
    }
  },

  async refreshMany(endpoints, options) {
    // Awaited in a loop rather than started together: see the doc comment on
    // the type. A rejection is impossible here -- `refresh` swallows its own --
    // but the loop is written so one bad endpoint could not strand the rest.
    for (const endpoint of endpoints) {
      if (options?.shouldContinue?.() === false) break;
      try {
        await get().refresh(endpoint, options);
      } catch {
        // One unreachable machine is not a reason to stop asking about the
        // others; that is the entire point of probing more than one.
      }
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

// A fresh authenticated response is stronger than a failed health check.
// Resolve only current pairings, so a response from a removed/replaced token
// cannot revive a different computer or invent health/capability metadata.
setGatewayAnswerObserver((endpoint) => {
  const matches = useGatewayConnectionStore
    .getState()
    .records.filter((record) => record.token === endpoint.token);
  if (matches.length !== 1) return;
  const { serverId } = matches[0]!;
  useServerReachability.setState((state) => ({
    probes: {
      ...state.probes,
      [serverId]: {
        serverId,
        ok: true,
        checkedAtMs: Date.now(),
        health: null,
        status: null,
      },
    },
  }));
});

let expiryTimer: ReturnType<typeof setTimeout> | undefined;

/** Schedules the next `freshnessNowMs` step: the first probe expiry after it. */
function scheduleProbeExpiry(): void {
  if (expiryTimer !== undefined) clearTimeout(expiryTimer);
  expiryTimer = undefined;
  const { probes, freshnessNowMs } = useServerReachability.getState();
  let next: number | undefined;
  for (const probe of Object.values(probes)) {
    const expiresAtMs = probe.checkedAtMs + REACHABILITY_FRESH_MS + 1;
    if (expiresAtMs > freshnessNowMs && (next === undefined || expiresAtMs < next)) {
      next = expiresAtMs;
    }
  }
  if (next === undefined) return;
  expiryTimer = setTimeout(
    () => useServerReachability.setState({ freshnessNowMs: Date.now() }),
    Math.max(0, next - Date.now())
  );
}

useServerReachability.subscribe((state, previous) => {
  if (state.probes !== previous.probes || state.freshnessNowMs !== previous.freshnessNowMs) {
    scheduleProbeExpiry();
  }
});

/**
 * What this store can tell the workspace prewarm about one server.
 *
 * The rule itself is pure and lives in `lib/server-reachability`; this is the
 * one place that may say the body is a `HealthResponse`, because this is where
 * it was read off the wire and put through `assertSupportedHerdr`. Callers get
 * a typed answer instead of each casting an `unknown` for themselves.
 */
export function serverPrewarmGate(
  serverId: string,
  nowMs: number = Date.now()
): { warm: boolean; health: HealthResponse | null } {
  const gate = prewarmGate(useServerReachability.getState().probes[serverId], nowMs);
  return { warm: gate.warm, health: (gate.health ?? null) as HealthResponse | null };
}
