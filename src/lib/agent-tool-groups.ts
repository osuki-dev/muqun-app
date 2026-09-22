import type { TimelineEntry } from './agent-reasoning';
import type { TimelineItem, ToolPart } from './agent-protocol';
import {
  classifyTool,
  shellExitFromMetadata,
  shellTimedOutFromMetadata,
} from './agent-tool-output';

type ItemEntry = Extract<TimelineEntry, { kind: 'item' }>;

export type RoutineToolEntry = ItemEntry & {
  item: TimelineItem & { part: ToolPart };
};

export type ToolDisplayEntry =
  | { kind: 'entry'; key: string; entry: TimelineEntry; sourceIndex: number }
  | {
      kind: 'tool-group';
      key: string;
      entries: readonly RoutineToolEntry[];
      sourceIndex: number;
    };

const ROUTINE_TOOL_KINDS = new Set(['shell', 'read', 'glob', 'grep', 'search', 'web']);

/** Completed, low-signal calls that can sit behind one disclosure row. */
export function isRoutineToolEntry(entry: TimelineEntry): entry is RoutineToolEntry {
  if (entry.kind !== 'item' || entry.item.part.type !== 'tool') return false;
  const part = entry.item.part;
  if (part.state !== 'completed' || part.error) return false;

  const kind = classifyTool(part.name);
  if (!ROUTINE_TOOL_KINDS.has(kind)) return false;
  if (kind !== 'shell') return true;

  const exit = shellExitFromMetadata(part.metadata);
  return !shellTimedOutFromMetadata(part.metadata) && (exit === undefined || exit === 0);
}

/**
 * Fold only adjacent routine calls, without crossing prose, thinking, or an
 * important/actionable tool. The first call owns the key so appending another
 * completed call does not reset the disclosure state.
 */
export function groupRoutineToolEntries(
  entries: readonly TimelineEntry[]
): readonly ToolDisplayEntry[] {
  const grouped: ToolDisplayEntry[] = [];
  let run: RoutineToolEntry[] = [];
  let runStart = 0;

  const flush = () => {
    if (run.length === 0) return;
    if (run.length === 1) {
      const entry = run[0];
      grouped.push({ kind: 'entry', key: entry.key, entry, sourceIndex: runStart });
    } else {
      grouped.push({
        kind: 'tool-group',
        key: `tool-group:${run[0].item.id}`,
        entries: run,
        sourceIndex: runStart,
      });
    }
    run = [];
  };

  entries.forEach((entry, sourceIndex) => {
    if (isRoutineToolEntry(entry)) {
      if (run.length === 0) runStart = sourceIndex;
      run.push(entry);
      return;
    }
    flush();
    grouped.push({ kind: 'entry', key: entry.key, entry, sourceIndex });
  });
  flush();
  return grouped;
}
