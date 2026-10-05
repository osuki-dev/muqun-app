import { create } from 'zustand';

/**
 * # Which run of each gateway the App last heard from
 *
 * A gateway keeps every pane's buffer in memory, so a restarted gateway
 * answers from buffers that started again empty. The App, meanwhile, still
 * holds the window it folded from the old process, and `foldPaneRead` merges
 * the new reads under it -- stale (and often duplicated) history that stays
 * on screen until the App is reopened.
 *
 * The gateway names its process with one opaque `generation` string, sent in
 * `/health` and `/api/discovery` (top level), every pane read
 * (`result.read.generation`) and parts answer (`data.generation`), every
 * streamed `pane_updated` frame that inlines output (`data.generation`), and
 * the `/api/ws` hello. This store keeps the last one seen per server, and says
 * when it changed: that is the moment every window held for that server
 * describes buffers that no longer exist, and must be dropped and read again.
 *
 * Only a *change* is a restart. The first value seen for a server is just
 * learnt -- the App may have opened long after the gateway did -- and an
 * answer without a generation (a gateway older than the field) is ignored,
 * so nothing behaves differently against one.
 */
interface GatewayGenerationState {
  /** The last generation seen per server id. */
  byServer: Record<string, string>;
  /** Restarts seen per server id since launch; bumped on every change. */
  restarts: Record<string, number>;
}

export const useGatewayGeneration = create<GatewayGenerationState>(() => ({
  byServer: {},
  restarts: {},
}));

const WRAPPERS = ['read', 'result', 'data'] as const;

/**
 * The `generation` an answer carries, wherever it sits: at the top level
 * (health, discovery, the ws hello) or inside the `result`/`read`/`data`
 * envelopes (a pane read, a parts answer, a streamed output frame).
 * `undefined` for anything without a non-empty string there.
 */
export function readGatewayGeneration(value: unknown, depth = 0): string | undefined {
  if (!value || typeof value !== 'object' || depth > 4) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.generation === 'string' && record.generation) return record.generation;
  for (const key of WRAPPERS) {
    const found = readGatewayGeneration(record[key], depth + 1);
    if (found) return found;
  }
  return undefined;
}

/**
 * Record the generation an answer from `serverId` carried. Returns `true`
 * exactly when it replaced a different, already known generation -- the
 * gateway restarted -- in which case every {@link onGatewayRestart} listener
 * for that server has already run by the time this returns, so a caller
 * holding the answer can check its own request is still current before
 * folding it into anything.
 */
export function noteGatewayGeneration(
  serverId: string | null | undefined,
  answer: unknown
): boolean {
  if (!serverId) return false;
  const generation = readGatewayGeneration(answer);
  if (!generation) return false;
  const { byServer, restarts } = useGatewayGeneration.getState();
  const previous = byServer[serverId];
  if (previous === generation) return false;
  const restarted = previous !== undefined;
  useGatewayGeneration.setState({
    byServer: { ...byServer, [serverId]: generation },
    restarts: restarted ? { ...restarts, [serverId]: (restarts[serverId] ?? 0) + 1 } : restarts,
  });
  return restarted;
}

/**
 * Run `listener` synchronously whenever `serverId`'s gateway is seen to have
 * restarted. Synchronous on purpose: it runs inside the `note` that saw the
 * new generation, before the answer that carried it reaches any fold.
 */
export function onGatewayRestart(serverId: string, listener: () => void): () => void {
  return useGatewayGeneration.subscribe((state, previous) => {
    if ((state.restarts[serverId] ?? 0) !== (previous.restarts[serverId] ?? 0)) listener();
  });
}
