import { homeContinueServerId, type HomeContinueEntry } from './home-continue';
import { SERVER_AGENTS_STALE_AFTER_MS } from './server-agents';
import type { TaskState } from './task-ledger';

/** Sessions a computer's card lists before "All sessions" opens the rest. */
export const COMPUTER_SESSIONS_SHOWN = 5;

/** 0: needs the reader, 1: running, 2: anything else. */
export type SessionUrgency = 0 | 1 | 2;

/**
 * How much a session row asks for attention, from what its row shows: the
 * ledger task's state when one runs in it (it wins, as on the row), else the
 * gateway's last observation while that is still current.
 */
export function homeSessionUrgency(
  entry: HomeContinueEntry,
  taskState: TaskState | undefined,
  confirmedAtMs: number,
  nowMs: number
): SessionUrgency {
  if (taskState) {
    if (taskState === 'waiting') return 0;
    return taskState === 'working' || taskState === 'queued' || taskState === 'dispatching' ? 1 : 2;
  }
  const observation = entry.observation;
  if (!observation) return 2;
  const atMs = Math.max(observation.observedAtMs, confirmedAtMs);
  if (nowMs - atMs > SERVER_AGENTS_STALE_AFTER_MS) return 2;
  if (observation.kind === 'gateway-agent') {
    if (observation.pendingUserInput === true || observation.status === 'blocked') return 0;
    return observation.status === 'working' ? 1 : 2;
  }
  return observation.status === 'busy' || observation.status === 'retry' ? 1 : 2;
}

/**
 * One computer's sessions for its card: needs-you first, then running, then
 * the rest, each group keeping Continue's own most-recent-first order.
 */
export function computerSessionEntries(
  entries: readonly HomeContinueEntry[],
  serverId: string,
  urgency: (entry: HomeContinueEntry) => SessionUrgency
): HomeContinueEntry[] {
  return entries
    .filter((entry) => homeContinueServerId(entry) === serverId)
    .map((entry, order) => ({ entry, order, rank: urgency(entry) }))
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .map(({ entry }) => entry);
}

/** What a computer's tab says while another computer is in front. */
export type ComputerSessionBadge = { needsYou: number; running: number };

/** Per computer, its sessions needing the reader and running; computers with neither are left out. */
export function computerSessionBadges(
  entries: readonly HomeContinueEntry[],
  urgency: (entry: HomeContinueEntry) => SessionUrgency
): Record<string, ComputerSessionBadge> {
  const badges: Record<string, ComputerSessionBadge> = {};
  for (const entry of entries) {
    const serverId = homeContinueServerId(entry);
    if (!serverId) continue;
    const rank = urgency(entry);
    if (rank === 2) continue;
    const badge = (badges[serverId] ??= { needsYou: 0, running: 0 });
    if (rank === 0) badge.needsYou += 1;
    else badge.running += 1;
  }
  return badges;
}

/** Continue rows that no listed computer's card holds: SSH hosts, and computers not on Home. */
export function sessionsOutsideCards(
  entries: readonly HomeContinueEntry[],
  cardServerIds: readonly string[]
): HomeContinueEntry[] {
  const listed = new Set(cardServerIds);
  return entries.filter((entry) => {
    const serverId = homeContinueServerId(entry);
    return !serverId || !listed.has(serverId);
  });
}
