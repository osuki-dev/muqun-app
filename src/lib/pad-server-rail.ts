import type { ServerAgent, ServerAgentsSnapshot } from '@/lib/server-agents';
import { isServerAgentsStale } from '@/lib/server-agents';

export type PadServerRailSnapshotState =
  | 'unseen'
  | 'current-empty'
  | 'stale-empty'
  | 'current-agents'
  | 'stale-agents';

/**
 * Turns the mirrored snapshot into a display state without pretending that a
 * missing snapshot is a live empty result.
 */
export function padServerRailSnapshotState(
  snapshot: ServerAgentsSnapshot | undefined,
  nowMs: number
): PadServerRailSnapshotState {
  if (!snapshot) return 'unseen';

  const stale = isServerAgentsStale(snapshot, nowMs);
  if (snapshot.agents.length === 0) return stale ? 'stale-empty' : 'current-empty';
  return stale ? 'stale-agents' : 'current-agents';
}

/** A pane-less mirrored agent cannot be matched safely to the selected pane. */
export function isPadServerRailAgentSelected({
  agent,
  serverId,
  selectedServerId,
  selectedPaneId,
}: {
  agent: ServerAgent;
  serverId: string;
  selectedServerId: string | null;
  selectedPaneId: string | null | undefined;
}): boolean {
  return (
    serverId === selectedServerId
    && Boolean(agent.paneId)
    && agent.paneId === selectedPaneId
  );
}

/** Only duplicate labels need their address shown to remain distinguishable. */
export function duplicatePadServerRailLabels(labels: readonly string[]): ReadonlySet<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const label of labels) {
    const key = label.trim().toLocaleLowerCase();
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }

  return duplicates;
}
