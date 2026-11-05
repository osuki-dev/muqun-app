import type { PickedFile } from '@/lib/attachments';

/**
 * Files a picker answered after the composer that opened it was rebuilt.
 *
 * Coming back from the system photo picker can re-lay a tablet's screen, and
 * the composer that asked is replaced by an identical one before the answer
 * lands. The answer waits here, per conversation, for the composer of that same
 * conversation to take it -- briefly, so a pick never surfaces somewhere stale.
 */
const picks = new Map<string, { files: PickedFile[]; at: number }>();
const listeners = new Set<() => void>();
const ORPHANED_PICK_TTL_MS = 30_000;

export function stashOrphanedPick(scope: string, files: PickedFile[]): void {
  picks.set(scope, { files, at: Date.now() });
  for (const listener of listeners) listener();
}

export function takeOrphanedPick(scope: string): PickedFile[] | undefined {
  const pick = picks.get(scope);
  if (!pick) return undefined;
  picks.delete(scope);
  return Date.now() - pick.at <= ORPHANED_PICK_TTL_MS ? pick.files : undefined;
}

export function onOrphanedPick(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
