import type {
  AgentDomainEvent,
  AgentErrorInfo,
  CompactionReason,
  CompactionStatus,
  TimelineItem,
} from '@/lib/agent-protocol';

/** Only the compaction stream's own summary, never assistant/reasoning text. */
export interface CompactionActivity {
  asid: string;
  status: CompactionStatus;
  reason: CompactionReason;
  summary: string;
  error?: AgentErrorInfo;
  startedSeq: number;
  lastSeq: number;
  /** Tail refetches re-stamp old rows, so seq alone cannot identify this run. */
  previousBoundaryIds: readonly string[];
}

type CompactionEvent = Extract<AgentDomainEvent, { type: 'agent.compaction.changed' }>;

export function beginCompaction(
  asid: string,
  reason: CompactionReason,
  seq: number,
  timeline: readonly TimelineItem[] = []
): CompactionActivity {
  return {
    asid,
    status: 'running',
    reason,
    summary: '',
    startedSeq: seq + 1,
    lastSeq: seq,
    previousBoundaryIds: timeline
      .filter((item) => item.part.type === 'compaction')
      .map((item) => item.id),
  };
}

export function applyCompactionEvent(
  current: CompactionActivity | null,
  event: CompactionEvent,
  timeline: readonly TimelineItem[] = []
): CompactionActivity | null {
  if (current?.asid !== event.asid) current = null;
  if (current && event.seq <= current.lastSeq) return current;
  const previous =
    event.status === 'started' || (event.status === 'running' && current?.status !== 'running')
      ? null
      : current;
  const summary = (previous?.summary ?? '') + (event.delta ?? '');
  // A completed stream without text has no detail to retain. Failed status
  // always survives until dismissed, even when the engine supplied no text.
  if (event.status === 'completed' && !summary.trim()) return null;
  return {
    asid: event.asid,
    status: event.status === 'started' ? 'running' : event.status,
    reason: previous?.reason ?? event.reason,
    summary,
    ...(event.status === 'failed' && (event.error ?? previous?.error)
      ? { error: event.error ?? previous?.error }
      : {}),
    startedSeq: previous?.startedSeq ?? event.seq,
    lastSeq: event.seq,
    previousBoundaryIds:
      previous?.previousBoundaryIds ??
      (event.status === 'started' || event.status === 'running'
        ? timeline.filter((item) => item.part.type === 'compaction').map((item) => item.id)
        : []),
  };
}

/** Hand finished details back to the real boundary, without making a timeline row. */
export function reconcileCompactionTimeline(
  current: CompactionActivity | null,
  items: readonly TimelineItem[],
  asid: string
): CompactionActivity | null {
  if (!current || current.asid !== asid) return current;
  const boundary = items.findLast(
    (item) =>
      item.part.type === 'compaction' &&
      item.seq >= current.startedSeq &&
      !current.previousBoundaryIds.includes(item.id)
  );
  if (!boundary || boundary.part.type !== 'compaction') return current;
  const part = boundary.part;
  const hasSummary = Boolean(part.summary?.trim());
  if (
    part.status === 'completed' &&
    hasSummary &&
    (!current.summary.trim() || part.summary === current.summary)
  )
    return null;
  // A silent resync can be the first observation of completion after a gap.
  // Never let an older running row resurrect a terminal status.
  const status = current.status === 'running' ? part.status : current.status;
  // Canonical text can fill an empty activity, never replace text already
  // received. Its revision seq is not a consumed-delta watermark: leave
  // lastSeq alone so a later-delivered real delta is still appended once.
  const summary = hasSummary && !current.summary ? (part.summary ?? '') : current.summary;
  if (status === 'completed' && !summary.trim()) return null;
  const error = status === 'failed' ? (part.error ?? current.error) : undefined;
  if (status === current.status && summary === current.summary && error === current.error)
    return current;
  return { ...current, status, summary, error };
}
