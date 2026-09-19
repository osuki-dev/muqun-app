import {
  isServerAgentsStale,
  paneLocationCaption,
  serverAgentsAgeParts,
  visibleServerAgents,
  type ServerAgent,
  type ServerAgentsSnapshot,
} from '@/lib/server-agents';
import { padServerRailSnapshotState, type PadServerRailSnapshotState } from '@/lib/pad-server-rail';
import { agentStatusesAreCurrent, type ServerReachability } from '@/lib/server-reachability';

export type HomeServerPaneMode = 'agents' | 'all';

export type HomeServerSnapshotState = PadServerRailSnapshotState;

export type HomeServerCaption =
  | { kind: 'status'; status: ServerAgent['status'] }
  | { kind: 'location'; text: string };

export type HomeServerRow = {
  /** The source object is kept intact for the row's press callback. */
  agent: ServerAgent;
  /** JSON keeps the server and pane/row identity structurally distinct. */
  key: string;
  caption?: HomeServerCaption;
  spokenCaption?: HomeServerCaption;
};

export type HomeServerModelInput = {
  serverId: string;
  snapshot: ServerAgentsSnapshot | undefined;
  reachability: ServerReachability;
  paneMode: HomeServerPaneMode;
  nowMs: number;
};

export type HomeServerModel = {
  serverId: string;
  snapshot: ServerAgentsSnapshot | undefined;
  snapshotState: HomeServerSnapshotState;
  stale: boolean;
  /** Whether cached agent statuses may retain their current status treatment. */
  agentStatusesCurrent: boolean;
  age: ReturnType<typeof serverAgentsAgeParts> | undefined;
  rows: HomeServerRow[];
};

/**
 * Selects the bounded, read-only data that both Home layouts render.
 *
 * Reachability describes a current probe; it never turns a cached snapshot
 * into a live query. A snapshot from another server is treated as missing so
 * a delayed or mis-keyed store update cannot put one server's panes on another
 * card.
 */
export function homeServerModel({
  serverId,
  snapshot: candidate,
  reachability,
  paneMode,
  nowMs,
}: HomeServerModelInput): HomeServerModel {
  const snapshot = candidate?.serverId === serverId ? candidate : undefined;
  if (!snapshot) {
    return {
      serverId,
      snapshot: undefined,
      snapshotState: 'unseen',
      stale: false,
      agentStatusesCurrent: false,
      age: undefined,
      rows: [],
    };
  }

  const stale = isServerAgentsStale(snapshot, nowMs);
  const agentStatusesCurrent = agentStatusesAreCurrent(reachability, stale);
  const visibleAgents = visibleServerAgents(snapshot.agents, paneMode);
  const snapshotState = padServerRailSnapshotState(snapshot, nowMs);

  return {
    serverId,
    snapshot,
    snapshotState,
    stale,
    agentStatusesCurrent,
    age: serverAgentsAgeParts(snapshot, nowMs),
    rows: visibleAgents.map((agent) => {
      const location = paneLocationCaption(agent.name, agent.cwd);
      const blockedCaption: HomeServerCaption | undefined =
        agent.hasAgent && agentStatusesCurrent && agent.status === 'blocked'
          ? { kind: 'status', status: agent.status }
          : undefined;
      const locationCaption: HomeServerCaption | undefined = location
        ? { kind: 'location', text: location }
        : undefined;

      return {
        agent,
        key: JSON.stringify([
          serverId,
          agent.paneId ? 'pane' : 'row',
          agent.paneId ? agent.paneId : agent.id,
        ]),
        caption: blockedCaption ?? locationCaption,
        spokenCaption:
          agent.hasAgent && agentStatusesCurrent
            ? { kind: 'status', status: agent.status }
            : locationCaption,
      };
    }),
  };
}
