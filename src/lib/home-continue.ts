import type { HomeRecentEntry, HomeSessionObservation, HomeTarget } from './home-recents';
import {
  homeServerModel,
  type HomeServerModel,
  type HomeServerPaneMode,
} from './home-server-model';
import {
  SERVER_AGENTS_STALE_AFTER_MS,
  type ServerAgent,
  type ServerAgentsIndex,
} from './server-agents';
import type { ServerReachability } from './server-reachability';

type HomeContinueAge = NonNullable<HomeServerModel['age']>;

export type HomeContinueObservation =
  | {
      kind: 'gateway-agent';
      /** Present only while the shared Home model considers the mirrored status current. */
      status?: ServerAgent['status'];
      age: HomeContinueAge;
      stale: boolean;
    }
  | {
      kind: 'opencode-session';
      /** Present only while the Gateway's observation remains current and not known offline. */
      status?: HomeSessionObservation['status'];
      age: HomeContinueAge;
      stale: boolean;
    };

export type HomeContinueEntry = {
  key: string;
  title: string;
  atMs: number;
  /** Structured gateway agent identity, if the pane snapshot reported one. */
  agentLabel?: string;
  /** Latest gateway observation; this is never inferred from visit history. */
  observation?: HomeContinueObservation;
  destination:
    | { type: 'pane'; serverId: string; paneId?: string; cwd?: string }
    | { type: 'recent'; target: HomeTarget };
};

/** The first screenful is generous; expansion is only useful after it. */
export const HOME_CONTINUE_INITIAL_LIMIT = 10;

export function visibleHomeContinueEntries(
  entries: readonly HomeContinueEntry[],
  expanded: boolean
): readonly HomeContinueEntry[] {
  return expanded ? entries : entries.slice(0, HOME_CONTINUE_INITIAL_LIMIT);
}

export function shouldShowHomeContinueOverflow(entries: readonly HomeContinueEntry[]): boolean {
  return entries.length > HOME_CONTINUE_INITIAL_LIMIT;
}

/** Same pane inventory/filter as Classic. Visits rank rows, never create inventory. */
export function homeContinueEntries({
  serverIds,
  hostIds,
  snapshots,
  recents,
  reachabilityByServer,
  paneMode,
  nowMs,
}: {
  serverIds: readonly string[];
  hostIds: readonly string[];
  snapshots: ServerAgentsIndex;
  recents: readonly HomeRecentEntry[];
  reachabilityByServer: Readonly<Record<string, ServerReachability | undefined>>;
  paneMode: HomeServerPaneMode;
  nowMs: number;
}): HomeContinueEntry[] {
  const rows: HomeContinueEntry[] = [];
  for (const serverId of serverIds) {
    if (reachabilityByServer[serverId] === 'offline') continue;
    const model = homeServerModel({
      serverId,
      snapshot: snapshots[serverId],
      reachability: reachabilityByServer[serverId] ?? 'unknown',
      paneMode,
      nowMs,
    });
    for (const { key, agent, spokenCaption } of model.rows) {
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
        ...(agent.agentLabel ? { agentLabel: agent.agentLabel } : {}),
        observation:
          agent.hasAgent && model.age
            ? {
                kind: 'gateway-agent',
                age: model.age,
                stale: model.stale,
                ...(spokenCaption?.kind === 'status' ? { status: spokenCaption.status } : {}),
              }
            : undefined,
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
    if (target.kind !== 'ssh-host' && reachabilityByServer[target.serverId] === 'offline') continue;
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
      observation:
        target.kind === 'opencode-session' && entry.sessionObservation
          ? openCodeObservation(
              entry.sessionObservation,
              reachabilityByServer[target.serverId] ?? 'unknown',
              nowMs
            )
          : undefined,
      destination: { type: 'recent', target },
    });
  }
  return rows.sort((a, b) => b.atMs - a.atMs);
}

function openCodeObservation(
  observation: HomeSessionObservation,
  reachability: ServerReachability,
  nowMs: number
): HomeContinueObservation {
  const stale = nowMs - observation.observedAtMs > SERVER_AGENTS_STALE_AFTER_MS;
  return {
    kind: 'opencode-session',
    age: observationAgeParts(observation.observedAtMs, nowMs),
    stale,
    ...(!stale && reachability !== 'offline' ? { status: observation.status } : {}),
  };
}

function observationAgeParts(observedAtMs: number, nowMs: number): HomeContinueAge {
  const seconds = Math.max(0, Math.round((nowMs - observedAtMs) / 1000));
  if (seconds < 90) return { unit: 'now', value: 0 };
  if (seconds < 3600) return { unit: 'minute', value: Math.floor(seconds / 60) };
  if (seconds < 86400) return { unit: 'hour', value: Math.floor(seconds / 3600) };
  return { unit: 'day', value: Math.floor(seconds / 86400) };
}
