import { asRecord } from './record';
import { sameData } from './same-data';
import { parseTaskView, type TaskView } from './task-ledger';
import type { ServerTasksIndex } from './server-tasks-state';

export const HOME_SUMMARY_CAPABILITY = 'home_task_summary_v1';
export const HOME_COLLECTOR_CAPABILITY = 'home_task_collector_v1';
export type HomeSource = { peer_id: string; grant_id: string };
export type HomeSummaryFrame = {
  t: 'home';
  sourceId: string;
  generation: string;
  revision: number;
  snapshot: boolean;
  tasks: TaskView[];
  removed: string[];
  defaultCwd?: string | null;
};
export type HomeStatusFrame = {
  t: 'home_status';
  sourceId: string;
  status: 'unavailable' | 'unsupported';
};
export type HomeFrame = HomeSummaryFrame | HomeStatusFrame;
export type HomeSummary = {
  generation: string;
  revision: number;
  tasks: TaskView[];
  receivedAtMs: number;
};
const validId = (id: unknown): id is string =>
  typeof id === 'string' && id.length > 0 && id.length <= 128 && !/[\u0000-\u001f]/.test(id);

export function parseHomeFrame(value: unknown): HomeFrame | null {
  const rec = asRecord(value);
  if (!rec || !validId(rec.source_id)) return null;
  if (rec.t === 'home_status') {
    return rec.status === 'unavailable' || rec.status === 'unsupported'
      ? { t: 'home_status', sourceId: rec.source_id, status: rec.status }
      : null;
  }
  if (
    rec.t !== 'home' ||
    !validId(rec.generation) ||
    typeof rec.revision !== 'number' ||
    !Number.isSafeInteger(rec.revision) ||
    rec.revision < 1 ||
    typeof rec.snapshot !== 'boolean' ||
    !Array.isArray(rec.tasks) ||
    rec.tasks.length > 100 ||
    !Array.isArray(rec.removed) ||
    rec.removed.length > 100 ||
    !rec.removed.every(validId)
  )
    return null;
  const tasks: TaskView[] = [];
  for (const value of rec.tasks) {
    const row = asRecord(value);
    if (
      !row ||
      typeof row.updated_ms !== 'number' ||
      !Number.isSafeInteger(row.updated_ms) ||
      row.updated_ms < 0 ||
      (row.kind !== 'command' && row.kind !== 'delegation') ||
      typeof row.title !== 'string' ||
      row.title.length > 512
    )
      return null;
    const task = parseTaskView(value);
    if (!task || !validId(task.taskId)) return null;
    tasks.push(task);
  }
  if (new Set(tasks.map((task) => task.taskId)).size !== tasks.length) return null;
  return {
    t: 'home',
    sourceId: rec.source_id,
    generation: rec.generation,
    revision: rec.revision,
    snapshot: rec.snapshot,
    tasks,
    removed: rec.removed,
    ...(typeof rec.default_cwd === 'string' || rec.default_cwd === null
      ? { defaultCwd: rec.default_cwd }
      : {}),
  };
}

/** Null means a gap: retain the displayed cache, but return to direct reads. */
export function applyHomeFrame(
  previous: HomeSummary | undefined,
  frame: HomeSummaryFrame,
  nowMs: number
): HomeSummary | null {
  const sameGeneration = previous?.generation === frame.generation;
  if (sameGeneration && frame.revision <= previous.revision) return previous;
  if (!frame.snapshot && (!sameGeneration || frame.revision !== previous.revision + 1)) return null;
  const tasks = new Map(
    (frame.snapshot ? [] : (previous?.tasks ?? [])).map((task) => [task.taskId, task])
  );
  const held = new Map(previous?.tasks.map((task) => [task.taskId, task]));
  for (const id of frame.removed) tasks.delete(id);
  for (const task of frame.tasks) {
    const known = held.get(task.taskId);
    tasks.set(task.taskId, known && sameData(known, task) ? known : task);
  }
  const ordered = [...tasks.values()].sort(
    (a, b) => b.updatedMs - a.updatedMs || a.taskId.localeCompare(b.taskId)
  );
  if (ordered.length > 100) return null;
  const same =
    previous?.tasks.length === ordered.length &&
    previous.tasks.every((task, index) => task === ordered[index]);
  return {
    generation: frame.generation,
    revision: frame.revision,
    tasks: same ? previous.tasks : ordered,
    receivedAtMs: nowMs,
  };
}

/** A Home-only projection. Full task data and detail subscriptions remain untouched. */
export function projectHomeTasks(
  direct: ServerTasksIndex,
  summaries: Readonly<Record<string, HomeSummary>>,
  live: Readonly<Record<string, boolean>>,
  previous: ServerTasksIndex
): ServerTasksIndex {
  const index = { ...direct };
  for (const [serverId, summary] of Object.entries(summaries)) {
    // A lost collector does not make the older direct cache authoritative.
    // Keep the last summary until a direct read has actually caught up.
    if (!live[serverId] && (direct[serverId]?.fetchedAt ?? 0) > summary.receivedAtMs) continue;
    const known = new Map(direct[serverId]?.tasks.map((task) => [task.taskId, task]));
    const old = new Map(previous[serverId]?.tasks.map((task) => [task.taskId, task]));
    const tasks = summary.tasks.map((task) => {
      const full = known.get(task.taskId);
      const merged =
        full && (full.receivedAtMs ?? 0) > summary.receivedAtMs
          ? full
          : {
              ...full,
              ...task,
              goal: full?.goal ?? '',
              progress: live[serverId] ? task.progress : undefined,
              receivedAtMs: summary.receivedAtMs,
            };
      const held = old.get(task.taskId);
      return held && sameData({ ...held, receivedAtMs: 0 }, { ...merged, receivedAtMs: 0 })
        ? held
        : merged;
    });
    for (const task of known.values()) {
      if (
        !summary.tasks.some((item) => item.taskId === task.taskId) &&
        (task.receivedAtMs ?? 0) > summary.receivedAtMs
      )
        tasks.push(task);
    }
    tasks.sort((a, b) => b.updatedMs - a.updatedMs || a.taskId.localeCompare(b.taskId));
    const oldEntry = previous[serverId];
    index[serverId] =
      oldEntry?.tasks.length === tasks.length &&
      oldEntry.tasks.every((task, i) => task === tasks[i])
        ? oldEntry
        : { tasks, fetchedAt: summary.receivedAtMs };
  }
  return Object.keys(index).length === Object.keys(previous).length &&
    Object.entries(index).every(([id, entry]) => previous[id] === entry)
    ? previous
    : index;
}

export type Collector = { serverId: string; sources: Record<string, HomeSource> };
export type HomeSummaryConfig = { preferred: string | null; collectors: Collector[] };
export const NO_HOME_SUMMARY: HomeSummaryConfig = { preferred: null, collectors: [] };
export function parseHomeSummaryConfig(value: unknown): HomeSummaryConfig {
  const rec = asRecord(value);
  if (!rec || (rec.preferred !== null && !validId(rec.preferred)) || !Array.isArray(rec.collectors))
    return NO_HOME_SUMMARY;
  const collectors: Collector[] = [];
  for (const item of rec.collectors.slice(0, 16)) {
    const row = asRecord(item);
    if (!row || !validId(row.serverId)) continue;
    const sources: Record<string, HomeSource> = {};
    for (const [id, source] of Object.entries(asRecord(row.sources) ?? {}).slice(0, 16)) {
      const pair = asRecord(source);
      if (validId(id) && pair && validId(pair.peer_id) && validId(pair.grant_id))
        sources[id] = { peer_id: pair.peer_id, grant_id: pair.grant_id };
    }
    if (!collectors.some((collector) => collector.serverId === row.serverId))
      collectors.push({ serverId: row.serverId, sources });
  }
  return rec.preferred === null ||
    collectors.some((collector) => collector.serverId === rec.preferred)
    ? { preferred: rec.preferred, collectors }
    : NO_HOME_SUMMARY;
}

/** Single-computer installations never choose a collector, even with old preferences. */
export function collectorOrder(
  config: HomeSummaryConfig,
  pairedIds: readonly string[]
): Collector[] {
  if (pairedIds.length < 2 || !config.preferred) return [];
  return config.collectors
    .filter((collector) => pairedIds.includes(collector.serverId))
    .sort(
      (a, b) => Number(b.serverId === config.preferred) - Number(a.serverId === config.preferred)
    );
}
