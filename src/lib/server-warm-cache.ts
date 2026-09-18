import type { HealthResponse, HerdrEntity } from '@/lib/gateway-client';
import { REACHABILITY_FRESH_MS } from '@/lib/server-reachability';

/**
 * The workspace a server was in a moment ago, so opening it paints instead of
 * connecting.
 *
 * This is not the home screen's mirror (`server-agents.ts`) and not a stored
 * "online" flag. It is in memory only, it is never persisted, it holds one
 * short-lived snapshot per server, and it is only ever written from a reply
 * this process just received on the one connection it already had open. A
 * seeded screen still polls immediately; the snapshot decides what is painted
 * for the first frame, never what is true.
 *
 * The freshness window is deliberately short, and is the probe's -- see
 * `WARM_WORKSPACE_TTL_MS`.
 */
export type WarmWorkspace = {
  health: HealthResponse | null;
  sessionId: string;
  workspaces: HerdrEntity[];
  tabs: HerdrEntity[];
  panes: HerdrEntity[];
  agents: HerdrEntity[];
  /**
   * The first screen of the pane the workspace is about to land on.
   *
   * Without it, opening a server painted everything except the thing the reader
   * came for: the connection pill, the pane strip and the key row all arrived
   * from this snapshot on the first frame, and the terminal underneath them sat
   * empty until its own read came back. The chrome being instant made the wait
   * more obvious, not less.
   *
   * Kept apart from the entity lists because it is the only part of this
   * snapshot that is not a fact about the session's shape, and because it is the
   * only part a screen may decline to use -- a pane read a different way (an
   * editor, an agent's prose) is refused on arrival rather than painted wrong.
   */
  firstPane?: { paneId: string; output: string; shape: string };
};

/**
 * How long a warmed workspace may still be painted, and why it is this number.
 *
 * It is `REACHABILITY_FRESH_MS` -- the same window a status-dot probe is
 * allowed to speak for -- because the two are now one decision rather than two.
 * The warm does not run until the probe for that server has answered, and it
 * builds on the `/health` body that probe brought back
 * (`stores/server-reachability`, `lib/workspace-snapshot`). A snapshot is
 * therefore only ever as current as the probe that let it happen, and expiring
 * it on a different clock would mean painting a workspace from a health answer
 * the list had already stopped believing.
 *
 * Sharing the number also enforces the ordering that matters: the expensive
 * path must not re-run more often than the cheap one that gates it. The probe
 * rechecks at `REACHABILITY_RECHECK_MS` (30s) and this expires at 45s, so a
 * returning reader re-probes -- one request -- once or twice before the warm is
 * willing to go again. Setting this *below* the recheck would invert that: the
 * warm would come due while the gate was still holding a cached answer, and the
 * screen would spend more requests the less it had to say.
 *
 * Past it the entry is dropped rather than shown with a caveat: a workspace
 * from five minutes ago is a guess, and the connecting state is the honest
 * answer to a guess.
 */
export const WARM_WORKSPACE_TTL_MS = REACHABILITY_FRESH_MS;

/** One per server, and only a handful: this exists to make the last server
 * instant, not to hold a history of every machine the reader has visited. */
const MAX_WARM_SERVERS = 4;

const entries = new Map<string, { snapshot: WarmWorkspace; atMs: number }>();

export function rememberWarmWorkspace(
  serverId: string,
  snapshot: WarmWorkspace,
  nowMs = Date.now()
): void {
  if (!serverId || !snapshot.health) return;
  // Re-insert so the most recently written server is last in iteration order.
  entries.delete(serverId);
  entries.set(serverId, { snapshot, atMs: nowMs });
  while (entries.size > MAX_WARM_SERVERS) {
    const oldest = entries.keys().next();
    if (oldest.done) break;
    entries.delete(oldest.value);
  }
}

/** The snapshot for this server if it is recent enough to paint, else null. */
export function warmWorkspace(serverId: string, nowMs = Date.now()): WarmWorkspace | null {
  const entry = entries.get(serverId);
  if (!entry) return null;
  if (nowMs - entry.atMs > WARM_WORKSPACE_TTL_MS || nowMs < entry.atMs) {
    entries.delete(serverId);
    return null;
  }
  return entry.snapshot;
}

/** Forget one server, or every server. Unpairing and signing out use this. */
export function forgetWarmWorkspace(serverId?: string): void {
  if (serverId === undefined) entries.clear();
  else entries.delete(serverId);
}

/** Test seam: the cache is process-wide, so suites must be able to reset it. */
export function warmWorkspaceCount(): number {
  return entries.size;
}
