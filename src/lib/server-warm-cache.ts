import type { HealthResponse, HerdrEntity } from '@/lib/gateway-client';

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
 * The freshness window is deliberately short. Past it the entry is dropped
 * rather than shown with a caveat: a workspace from five minutes ago is a
 * guess, and the connecting state is the honest answer to a guess.
 */
export type WarmWorkspace = {
  health: HealthResponse | null;
  sessionId: string;
  workspaces: HerdrEntity[];
  tabs: HerdrEntity[];
  panes: HerdrEntity[];
  agents: HerdrEntity[];
};

export const WARM_WORKSPACE_TTL_MS = 45_000;

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
