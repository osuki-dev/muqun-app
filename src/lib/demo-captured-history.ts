import { CAPTURED_HISTORY_PAGE_ROWS } from './terminal-history-segments';

export const DEMO_CAPTURED_HISTORY_SESSION_ID = 'demo-captured-history';
export const DEMO_CAPTURED_HISTORY_PANE_ID = 'demo-history-pane';

const TOTAL_ROWS = 520;
const RESTART_ROW = 290;
const STARTED_AT_MS = 1_730_000_000_000;

/** Bounded terminal observations, returned in the real Gateway wire shape. */
export function demoCapturedHistory(
  sessionId: string,
  paneId: string,
  before: string | null,
  limit = CAPTURED_HISTORY_PAGE_ROWS
) {
  const captured =
    sessionId === DEMO_CAPTURED_HISTORY_SESSION_ID && paneId === DEMO_CAPTURED_HISTORY_PANE_ID;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('HTTP 400');
  let end = captured ? TOTAL_ROWS : 0;
  if (before !== null) {
    const cursor = /^demo-history-v1:(\d+):(\d+)$/.exec(before);
    end = Number(cursor?.[2]);
    if (
      !captured ||
      !cursor ||
      Number(cursor[1]) !== limit ||
      end <= 0 ||
      end >= TOTAL_ROWS ||
      (TOTAL_ROWS - end) % limit !== 0
    )
      throw new Error('HTTP 409');
  }
  const start = Math.max(0, end - limit);
  const segments = [
    {
      segment_id: 'demo-history-before-restart',
      started_at_ms: STARTED_AT_MS,
      sealed_at_ms: STARTED_AT_MS + 60_000,
      boundary_reason: 'observation-start',
      from: 0,
      to: RESTART_ROW,
    },
    {
      segment_id: 'demo-history-after-restart',
      started_at_ms: STARTED_AT_MS + 60_000,
      sealed_at_ms: null,
      boundary_reason: 'gateway-restart',
      from: RESTART_ROW,
      to: TOTAL_ROWS,
    },
  ].flatMap(({ from, to, ...segment }) => {
    const first = Math.max(start, from);
    const last = Math.min(end, to);
    return first < last
      ? [
          {
            ...segment,
            rows: Array.from(
              { length: last - first },
              (_, index) =>
                `\u001b[36m[saved ${String(first + index + 1).padStart(3, '0')}]\u001b[0m read src/theme.ts`
            ),
          },
        ]
      : [];
  });
  return {
    data: {
      session_id: sessionId,
      pane_id: paneId,
      generation: 'demo-history-generation',
      source: 'gateway-captured',
      read_source: 'recent-unwrapped',
      format: 'ansi',
      availability: captured ? 'captured' : 'not_captured',
      snapshot_id: captured ? `demo-history-snapshot-ansi-${limit}` : null,
      segments,
      row_count: end - start,
      has_more: start > 0,
      next_before: start > 0 ? `demo-history-v1:${limit}:${start}` : null,
      order: 'oldest-to-newest',
      includes_live_viewport: false,
      complete_archive: false,
    },
  };
}
