import type { HomeRecentEntry, HomeTarget } from './home-recents';
import { homeServerModel, type HomeServerPaneMode } from './home-server-model';
import type { ServerAgentsIndex } from './server-agents';

export type HomeContinueEntry = {
  key: string;
  title: string;
  atMs: number;
  destination:
    | { type: 'pane'; serverId: string; paneId?: string; cwd?: string }
    | { type: 'recent'; target: HomeTarget };
};

/** Same pane inventory/filter as Classic. Visits rank rows, never create inventory. */
export function homeContinueEntries({
  serverIds,
  hostIds,
  snapshots,
  recents,
  paneMode,
  nowMs,
}: {
  serverIds: readonly string[];
  hostIds: readonly string[];
  snapshots: ServerAgentsIndex;
  recents: readonly HomeRecentEntry[];
  paneMode: HomeServerPaneMode;
  nowMs: number;
}): HomeContinueEntry[] {
  const rows: HomeContinueEntry[] = [];
  for (const serverId of serverIds) {
    const model = homeServerModel({
      serverId,
      snapshot: snapshots[serverId],
      reachability: 'unknown',
      paneMode,
      nowMs,
    });
    for (const { key, agent } of model.rows) {
      const visited = recents.find(
        ({ target }) =>
          target.kind === 'gateway-terminal' &&
          target.serverId === serverId &&
          target.paneId === agent.paneId
      );
      rows.push({
        key,
        title: agent.name,
        atMs: visited?.atMs ?? 0,
        destination: { type: 'pane', serverId, paneId: agent.paneId, cwd: agent.cwd },
      });
    }
  }
  for (const entry of recents) {
    const target = entry.target;
    if (
      target.kind === 'ssh-host'
        ? !hostIds.includes(target.hostId)
        : !serverIds.includes(target.serverId)
    )
      continue;
    // Once the shared snapshot exists, its inventory and pane filter win over history.
    if (
      target.kind === 'gateway-terminal' &&
      snapshots[target.serverId]?.serverId === target.serverId
    )
      continue;
    rows.push({
      key: entry.key,
      title: entry.title,
      atMs: entry.atMs,
      destination: { type: 'recent', target },
    });
  }
  return rows.sort((a, b) => b.atMs - a.atMs);
}
