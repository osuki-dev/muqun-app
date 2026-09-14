import type { WorkDetail, WorkReconciliation } from './work-api';
import type { CollaborationOutputSnapshot } from './collaboration-presentation';

export type WorkViewAnchor = {
  itemId: string | null;
  relativeOffset: number;
  rawOffset: number;
  snapshotId?: string;
};
export type WorkTaskView = {
  detail: WorkDetail;
  selectedAttemptId: string | null;
  selectedResultId: string | null;
  recipientId: string | null;
  requiresRefresh: boolean;
  hasUpdates: boolean;
  lifecycleObservation: WorkReconciliation | null;
};
type Entry = {
  view: WorkTaskView;
  anchors: Partial<Record<'detail' | 'output', WorkViewAnchor>>;
  outputs: Record<
    string,
    { instanceId: string; snapshot: CollaborationOutputSnapshot; identity: string }
  >;
};

// A conservative retained-size estimate, including UTF-16 strings and object overhead.
// Never use TextEncoder here: Hermes does not provide it on every supported build.
function retainedBytes(value: unknown): number {
  if (typeof value === 'string') return value.length * 2 + 16;
  if (!value || typeof value !== 'object') return 8;
  return Object.entries(value).reduce(
    (size, [key, child]) => size + key.length * 2 + 16 + retainedBytes(child),
    32
  );
}
function cleanAnchor(anchor: WorkViewAnchor): WorkViewAnchor | undefined {
  if (
    (anchor.itemId !== null && anchor.itemId.length > 512) ||
    (anchor.snapshotId?.length ?? 0) > 512 ||
    !Number.isFinite(anchor.relativeOffset) ||
    !Number.isFinite(anchor.rawOffset)
  )
    return;
  return {
    ...anchor,
    relativeOffset: Math.max(-1_000_000, Math.min(1_000_000, anchor.relativeOffset)),
    rawOffset: Math.max(0, Math.min(1_000_000, anchor.rawOffset)),
  };
}

/** In-memory presentation only. Pairing/session ownership comes from its controller. */
export class WorkViewMemory {
  private readonly entries = new Map<string, Entry>();
  private protectedIds = new Set<string>();
  private listAnchor: WorkViewAnchor | undefined;
  private outputSequence = 0;
  constructor(
    private readonly maxTasks = 20,
    private readonly maxBytes = 16 * 1024 * 1024
  ) {}
  protect(ids: readonly (string | null | undefined)[]) {
    this.protectedIds = new Set(ids.filter((id): id is string => !!id));
  }
  private put(id: string, entry: Entry): boolean {
    const bytes = retainedBytes(entry);
    if (bytes > this.maxBytes) return false;
    const candidates = new Map(this.entries);
    candidates.delete(id);
    candidates.set(id, entry);
    const size = () =>
      [...candidates.values()].reduce((sum, value) => sum + retainedBytes(value), 0);
    for (const key of candidates.keys()) {
      if (candidates.size <= this.maxTasks && size() <= this.maxBytes) break;
      if (key !== id && !this.protectedIds.has(key)) candidates.delete(key);
    }
    if (candidates.size > this.maxTasks || size() > this.maxBytes) return false;
    this.entries.clear();
    for (const [key, value] of candidates) this.entries.set(key, value);
    return true;
  }
  remember(view: WorkTaskView): boolean {
    const id = view.detail.task.id;
    const previous = this.entries.get(id);
    const retained = this.put(id, {
      view,
      anchors: previous?.anchors ?? {},
      outputs: previous?.outputs ?? {},
    });
    // An oversized refreshed view still lives in the active controller. Never
    // restore an older cached revision after that active view is left behind.
    if (!retained && previous?.view.detail !== view.detail) this.entries.delete(id);
    return retained;
  }
  recall(id: string): WorkTaskView | undefined {
    const entry = this.entries.get(id);
    if (entry) {
      this.entries.delete(id);
      this.entries.set(id, entry);
    }
    return entry?.view;
  }
  output(taskId: string, attemptId: string, instanceId: string) {
    const output = this.entries.get(taskId)?.outputs[attemptId];
    return output?.instanceId === instanceId ? output.snapshot : undefined;
  }
  outputIdentity(taskId: string, attemptId: string, instanceId: string) {
    const output = this.entries.get(taskId)?.outputs[attemptId];
    return output?.instanceId === instanceId ? output.identity : undefined;
  }
  forgetOutput(taskId: string, attemptId: string) {
    const entry = this.entries.get(taskId);
    if (!entry?.outputs[attemptId]) return;
    const outputs = { ...entry.outputs };
    delete outputs[attemptId];
    this.entries.set(taskId, { ...entry, outputs });
  }
  rememberOutput(
    taskId: string,
    attemptId: string,
    instanceId: string,
    snapshot: CollaborationOutputSnapshot
  ) {
    const entry = this.entries.get(taskId);
    const previous = entry?.outputs[attemptId];
    const identity =
      previous?.instanceId === instanceId && previous.snapshot.signature === snapshot.signature
        ? previous.identity
        : `output:${++this.outputSequence}`;
    return entry
      ? this.put(taskId, {
          ...entry,
          outputs: { ...entry.outputs, [attemptId]: { instanceId, snapshot, identity } },
        })
      : false;
  }
  anchor(region: 'list' | 'detail' | 'output', taskId?: string) {
    return region === 'list'
      ? this.listAnchor
      : taskId
        ? this.entries.get(taskId)?.anchors[region]
        : undefined;
  }
  saveAnchor(region: 'list' | 'detail' | 'output', anchor: WorkViewAnchor, taskId?: string) {
    const cleaned = cleanAnchor(anchor);
    if (!cleaned) return;
    if (region === 'list') this.listAnchor = cleaned;
    else if (taskId) {
      const entry = this.entries.get(taskId);
      if (entry) this.put(taskId, { ...entry, anchors: { ...entry.anchors, [region]: cleaned } });
    }
  }
  clear() {
    this.entries.clear();
    this.protectedIds.clear();
    this.listAnchor = undefined;
  }
  get usage() {
    return {
      tasks: this.entries.size,
      bytes: [...this.entries.values()].reduce((sum, entry) => sum + retainedBytes(entry), 0),
    };
  }
}
