import type { TimelineItem } from './agent-protocol';

/**
 * One message's thinking, as one block.
 *
 * OpenCode emits a `reasoning` part per *step*, not per turn, and a step that
 * has only just begun has neither text nor a duration yet. Rendered one pill
 * each, a single turn read as "Thought · 3.1s", "Thought", "Thought" -- one
 * real pill and two empty ones, stacked, saying nothing. The empty ones are not
 * content: they are the protocol's own step boundaries showing through.
 *
 * So consecutive reasoning parts of a message collapse into one run: the texts
 * joined, the durations summed, and a run that is still empty dropped unless it
 * is the one currently arriving -- which is drawn as a live thinking mark
 * rather than as a pill with nothing in it.
 *
 * Pure, so the three rules that matter are testable without a renderer: what
 * merges, what is dropped, and which run is the live one.
 */

/** A merged run of reasoning parts, or the one still arriving. */
export interface ReasoningRun {
  /** The first part's id: the block's key, stable as the run grows. */
  key: string;
  /** Every non-empty part's text, in order. */
  text: string;
  /** The summed `duration_ms` of the parts that reported one. */
  durationMs?: number;
  /**
   * Whether this run is still being produced.
   *
   * True for a run at the end of its message that has not reported a duration:
   * a finished reasoning part always carries one, so "last and unfinished" is
   * the honest reading of "the model is thinking right now".
   */
  pending: boolean;
}

/** What a message block draws, in order. */
export type TimelineEntry =
  | { kind: 'item'; key: string; item: TimelineItem }
  | { kind: 'reasoning'; key: string; run: ReasoningRun };

function reasoningOf(
  item: TimelineItem
): Extract<TimelineItem['part'], { type: 'reasoning' }> | null {
  return item.part.type === 'reasoning' ? item.part : null;
}

/**
 * A message's items, with consecutive reasoning parts merged.
 *
 * The run keeps the position of the first part it absorbed, so the block sits
 * before whatever tool or text followed the thinking -- which is where the
 * reader expects it, and where the first of the pills used to be.
 */
export function buildTimelineEntries(items: readonly TimelineItem[]): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  let index = 0;

  while (index < items.length) {
    const item = items[index];
    if (!reasoningOf(item)) {
      entries.push({ kind: 'item', key: item.id, item });
      index += 1;
      continue;
    }

    // Absorb the whole consecutive run.
    const texts: string[] = [];
    let durationMs: number | undefined;
    const first = item;
    let last = index;
    while (last < items.length) {
      const part = reasoningOf(items[last]);
      if (!part) break;
      const text = part.text.trim();
      if (text) texts.push(text);
      if (part.duration_ms !== undefined) durationMs = (durationMs ?? 0) + part.duration_ms;
      last += 1;
    }

    const endsTheMessage = last >= items.length;
    const run: ReasoningRun = {
      key: first.id,
      text: texts.join('\n\n'),
      ...(durationMs === undefined ? {} : { durationMs }),
      pending: endsTheMessage && durationMs === undefined,
    };

    // Nothing to say and nothing still saying it: the protocol's own step
    // boundary, which is not a thing the reader asked to see.
    if (run.text || run.durationMs !== undefined || run.pending) {
      entries.push({ kind: 'reasoning', key: run.key, run });
    }
    index = last;
  }

  return entries;
}

/** `3.1s`, `12s`, `1m 05s`: the label a Thought block carries. */
export function formatThoughtDuration(ms: number): string {
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}
