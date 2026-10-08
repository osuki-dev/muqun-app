import { createStore } from 'zustand/vanilla';
import type { AgentRunStatus, TimelineItem } from '@/lib/agent-protocol';
import {
  reconcileInjectedContext,
  reconcileShellParts,
  type TimelineRenderGroup,
} from '@/lib/agent-timeline-groups';
import { classifyTool } from '@/lib/agent-tool-output';
import { splitDiagramMarkdown } from '@/lib/diagram-markdown';

/** One canonical timeline per mounted workbench; rows are derived, never mirrored back. */
export function createAgentTranscriptStore() {
  return createStore<AgentTranscriptState>((set, get) => {
    const markdownRows = new WeakMap<TimelineItem, TimelineItem[]>();
    const renderItems = (item: TimelineItem): TimelineItem[] => {
      if (item.role !== 'assistant' || item.part.type !== 'text') return [item];
      const cached = markdownRows.get(item);
      if (cached) return cached;
      const parts = splitDiagramMarkdown(item.part.text);
      // Virtualize each diagram in the existing list, never nest another list
      // inside a message. Keep the canonical timeline intact for sync/copy.
      const rows =
        parts.length > 1 && parts.some((part) => part.source !== undefined)
          ? parts
              .filter((part) => part.markdown.trim().length > 0)
              .map((part) => ({
                ...item,
                row_key:
                  part.start === 0
                    ? (item.row_key ?? item.id)
                    : `${item.row_key ?? item.id}:markdown:${part.start}`,
                part: { type: 'text' as const, text: part.markdown },
              }))
          : [item];
      markdownRows.set(item, rows);
      return rows;
    };
    const rebuild = (timeline: TimelineItem[], config = get().config) => {
      const previous = get();
      const reconciled = reconcileInjectedContext(reconcileShellParts(timeline));
      // windowStart indexes the canonical timeline, not the deduplicated list.
      // Shell copies can occupy the entire newest page; keep a real page visible
      // instead of slicing beyond the end after those copies are removed.
      const start = Math.max(0, Math.min(config.windowStart, timeline.length));
      let visible = reconciled;
      if (start > 0) {
        const windowIds = new Set(timeline.slice(start).map((item) => item.id));
        const anchor = reconciled.findIndex((item) => windowIds.has(item.id));
        const pageSize = Math.max(1, timeline.length - start);
        const fallbackStart = Math.max(0, reconciled.length - pageSize);
        // A newly appended user row can be the only surviving member of a
        // canonical window whose shell echoes were deduplicated. Keep the
        // fallback history page in that partially surviving case too, or send
        // collapses a long transcript to only the new prompt until refresh.
        const visibleStart = anchor >= 0 ? Math.min(anchor, fallbackStart) : fallbackStart;
        visible = reconciled.slice(visibleStart);
      }
      visible = visible.flatMap(renderItems);
      const nextRows: Record<string, TimelineRenderGroup> = {};
      const keys: string[] = [];
      let preceding: TimelineItem | undefined;
      for (let i = 0; i < visible.length;) {
        const first = visible[i];
        const items = [first];
        let end = i + 1;
        // User attachments belong to their bubble. Only consecutive reasoning
        // needs merging on the assistant side; tools/text are virtual rows.
        while (
          end < visible.length &&
          visible[end].message_id === first.message_id &&
          (first.role === 'user' ||
            (first.part.type === 'reasoning' && visible[end].part.type === 'reasoning'))
        )
          items.push(visible[end++]);
        const key = `grp_${first.row_key ?? first.id}`;
        const prevItem =
          first.part.type === 'text' && preceding?.part.type === 'tool' ? preceding : undefined;
        const old = previous.rows[key];
        const same =
          old?.role === first.role &&
          old.prevItem === prevItem &&
          old.items.length === items.length &&
          old.items.every((item, at) => item === items[at]);
        nextRows[key] = same ? old : { key, role: first.role, items, prevItem };
        keys.push(key);
        if (first.part.type !== 'reasoning') preceding = items.at(-1);
        i = end;
      }
      const last = visible.at(-1);
      const reasoningKey =
        config.status === 'busy' && last?.role === 'assistant' && last.part.type === 'reasoning'
          ? keys.at(-1)
          : undefined;
      const toolIds = new Set<string>();
      let backgroundTools = 0;
      let todos: AgentTranscriptState['todos'];
      for (const item of timeline) {
        if (item.part.type === 'todo' && item.part.items.length) todos = item.part.items;
        if (item.part.type !== 'tool') continue;
        toolIds.add(item.part.id);
        if (
          item.part.background &&
          item.part.state !== 'completed' &&
          item.part.state !== 'failed' &&
          classifyTool(item.part.name) !== 'shell'
        )
          backgroundTools++;
      }
      set({
        timeline,
        config,
        rows: nextRows,
        reasoningKey,
        backgroundTools,
        todos,
        keys:
          keys.length === previous.keys.length && keys.every((key, i) => key === previous.keys[i])
            ? previous.keys
            : keys,
        toolIds:
          toolIds.size === previous.toolIds.size &&
          [...toolIds].every((id) => previous.toolIds.has(id))
            ? previous.toolIds
            : toolIds,
      });
    };
    return {
      timeline: [],
      rows: {},
      keys: [],
      toolIds: new Set(),
      backgroundTools: 0,
      todos: undefined,
      reasoningKey: undefined,
      config: { windowStart: 0, status: undefined },
      setTimeline: (update, windowStart) => {
        const current = get().timeline;
        const next = typeof update === 'function' ? update(current) : update;
        const config = get().config;
        if (next !== current || (windowStart !== undefined && windowStart !== config.windowStart))
          rebuild(next, windowStart === undefined ? config : { ...config, windowStart });
      },
      configure: (config) => {
        const current = get().config;
        if (current.windowStart !== config.windowStart || current.status !== config.status)
          rebuild(get().timeline, config);
      },
    };
  });
}

interface TranscriptConfig {
  windowStart: number;
  status: AgentRunStatus | undefined;
}
export interface AgentTranscriptState {
  timeline: TimelineItem[];
  rows: Record<string, TimelineRenderGroup>;
  keys: string[];
  reasoningKey: string | undefined;
  config: TranscriptConfig;
  toolIds: ReadonlySet<string>;
  backgroundTools: number;
  todos: Extract<TimelineItem['part'], { type: 'todo' }>['items'] | undefined;
  setTimeline: (
    update: TimelineItem[] | ((previous: TimelineItem[]) => TimelineItem[]),
    windowStart?: number
  ) => void;
  configure: (config: TranscriptConfig) => void;
}
export type AgentTranscriptStore = ReturnType<typeof createAgentTranscriptStore>;
