import type { GatewayRecord } from './gateway-storage';

export const PANE_CAPTURED_HISTORY_SEGMENTS_CAPABILITY = 'pane_captured_history_segments_v1';
export const CAPTURED_HISTORY_PAGE_ROWS = 240;

export interface CapturedHistorySegment {
  id: string;
  startedAtMs: number;
  sealedAtMs: number | null;
  boundaryReason: string;
  /** Kept verbatim, including blank and repeated rows. */
  rows: string[];
}

/** A page from the segments endpoint, never a legacy /history cursor or native range. */
export interface CapturedSegmentsPage {
  sessionId: string;
  paneId: string;
  generation: string;
  snapshotId: string | null;
  limit: number;
  segments: CapturedHistorySegment[];
  rowCount: number;
  byteCount: number;
  hasMore: boolean;
  nextBefore: string | null;
}

export type CapturedSegmentsRead =
  | { ok: true; page: CapturedSegmentsPage }
  | { ok: false; status: number | null; error: unknown };

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function timestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 8.64e15;
}

/** Reject a partial/malformed page instead of silently omitting its rows or boundaries. */
export function parseCapturedSegmentsPage(
  value: unknown,
  request: { sessionId: string; paneId: string; limit: number }
): CapturedSegmentsPage | null {
  const envelope = object(value);
  const data = object(envelope && 'data' in envelope ? envelope.data : value);
  if (
    !data ||
    data.session_id !== request.sessionId ||
    data.pane_id !== request.paneId ||
    data.format !== 'ansi' ||
    data.source !== 'gateway-captured' ||
    data.read_source !== 'recent-unwrapped' ||
    data.order !== 'oldest-to-newest' ||
    data.includes_live_viewport !== false ||
    typeof data.generation !== 'string' ||
    !data.generation ||
    !Array.isArray(data.segments) ||
    data.segments.length > 64 ||
    (data.availability !== 'captured' && data.availability !== 'not_captured') ||
    typeof data.has_more !== 'boolean'
  )
    return null;
  const segments: CapturedHistorySegment[] = [];
  const ids = new Set<string>();
  let rowCount = 0;
  let byteCount = 0;
  const encoder = new TextEncoder();
  for (const entry of data.segments) {
    const segment = object(entry);
    if (
      !segment ||
      typeof segment.segment_id !== 'string' ||
      !segment.segment_id ||
      ids.has(segment.segment_id) ||
      !timestamp(segment.started_at_ms) ||
      (segment.sealed_at_ms !== null && !timestamp(segment.sealed_at_ms)) ||
      typeof segment.boundary_reason !== 'string' ||
      !segment.boundary_reason ||
      !Array.isArray(segment.rows) ||
      segment.rows.length === 0 ||
      !segment.rows.every((row): row is string => typeof row === 'string')
    )
      return null;
    ids.add(segment.segment_id);
    rowCount += segment.rows.length;
    byteCount += segment.rows.reduce((total, row) => total + encoder.encode(row).length + 1, 0);
    if (rowCount > request.limit || byteCount > 256 * 1024) return null;
    segments.push({
      id: segment.segment_id,
      startedAtMs: segment.started_at_ms,
      sealedAtMs: segment.sealed_at_ms,
      boundaryReason: segment.boundary_reason,
      rows: segment.rows,
    });
  }
  const snapshotId =
    typeof data.snapshot_id === 'string' && data.snapshot_id ? data.snapshot_id : null;
  const nextBefore =
    typeof data.next_before === 'string' && data.next_before ? data.next_before : null;
  if (
    data.row_count !== rowCount ||
    data.has_more !== (nextBefore !== null) ||
    (rowCount > 0 && (snapshotId === null || data.availability !== 'captured')) ||
    (rowCount === 0 && (snapshotId !== null || nextBefore !== null))
  )
    return null;
  return {
    sessionId: request.sessionId,
    paneId: request.paneId,
    generation: data.generation,
    snapshotId,
    limit: request.limit,
    segments,
    rowCount,
    byteCount,
    hasMore: data.has_more,
    nextBefore,
  };
}

/** A renamed computer is still the owner; replacement credentials are not. */
export function capturedHistoryOwnerMatches(
  owner: GatewayRecord,
  current: GatewayRecord | null
): boolean {
  return (
    current !== null &&
    owner.serverId === current.serverId &&
    owner.url === current.url &&
    owner.token === current.token &&
    owner.deviceId === current.deviceId &&
    owner.transportKey === current.transportKey &&
    owner.transport === current.transport &&
    owner.sshTunnel?.hostId === current.sshTunnel?.hostId &&
    owner.sshTunnel?.remoteHost === current.sshTunnel?.remoteHost &&
    owner.sshTunnel?.remotePort === current.sshTunnel?.remotePort
  );
}

/**
 * Pages are newest first, and each page's segments/rows are oldest first.
 * Keep all fetched pages within the v1 retention bound; only one page is rendered.
 * A changed snapshot, shape or segment identity requires the reader's refresh.
 */
export function appendCapturedSegmentsPage(
  pages: readonly CapturedSegmentsPage[],
  page: CapturedSegmentsPage,
  before: string
): CapturedSegmentsPage[] | null {
  const first = pages[0];
  const oldest = pages.at(-1);
  if (
    !first ||
    !oldest ||
    oldest.nextBefore !== before ||
    page.rowCount === 0 ||
    first.snapshotId !== page.snapshotId ||
    first.generation !== page.generation ||
    first.sessionId !== page.sessionId ||
    first.paneId !== page.paneId ||
    first.limit !== page.limit ||
    page.nextBefore === before ||
    pages.some((entry) => entry.nextBefore !== null && entry.nextBefore === page.nextBefore)
  )
    return null;
  const known = new Map(
    pages.flatMap((entry) => entry.segments).map((segment) => [segment.id, segment])
  );
  const continued = oldest.segments[0];
  for (let index = 0; index < page.segments.length; index++) {
    const segment = page.segments[index]!;
    const previous = known.get(segment.id);
    if (
      previous &&
      (index !== page.segments.length - 1 ||
        continued?.id !== segment.id ||
        previous.startedAtMs !== segment.startedAtMs ||
        previous.sealedAtMs !== segment.sealedAtMs ||
        previous.boundaryReason !== segment.boundaryReason)
    )
      return null;
    known.set(segment.id, segment);
  }
  if (
    known.size > 64 ||
    pages.reduce((total, entry) => total + entry.rowCount, page.rowCount) > 5000 ||
    pages.reduce((total, entry) => total + entry.byteCount, page.byteCount) > 2 * 1024 * 1024
  )
    return null;
  // No text overlap matching: repeated rows in one segment or across a boundary are real rows.
  return [...pages, page];
}
