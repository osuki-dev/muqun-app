import type { CollaborationTask } from './agent-collaboration';

/** A removed selection stays empty rather than silently selecting another dispatch. */
export function selectedCollaborationTask(tasks: CollaborationTask[], selectedId: string | null) {
  return tasks.find((task) => task.id === selectedId);
}

export type CollaborationOutputSnapshot = {
  text: string;
  signature: string;
  hasNewOutput: boolean;
};

/** Observation updates the indicator only; a deliberate refresh replaces the reading snapshot. */
export function observeCollaborationOutput(
  previous: CollaborationOutputSnapshot | undefined,
  observed: { text: string; signature: string },
  refresh = false
): CollaborationOutputSnapshot {
  if (!previous || refresh) return { ...observed, hasNewOutput: false };
  return { ...previous, hasNewOutput: previous.signature !== observed.signature };
}

/** Async work may finish, but only a lease from the current lifetime may publish it. */
export function createCollaborationRequestGuard() {
  let generation = 0;
  return {
    invalidate() {
      generation += 1;
    },
    capture() {
      const captured = generation;
      return () => captured === generation;
    },
  };
}

/** Reuse the object when unchanged so pruning does not create render loops. */
export function retainCollaborationSnapshots(
  snapshots: Record<string, CollaborationOutputSnapshot>,
  retained: ReadonlySet<string>
): Record<string, CollaborationOutputSnapshot> {
  const ids = Object.keys(snapshots);
  if (ids.every((id) => retained.has(id))) return snapshots;
  return Object.fromEntries(ids.filter((id) => retained.has(id)).map((id) => [id, snapshots[id]]));
}
