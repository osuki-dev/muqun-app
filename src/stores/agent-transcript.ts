import { createStore } from 'zustand/vanilla';
import type { AgentRunStatus, ShellInfo, TimelineItem } from '@/lib/agent-protocol';
import { reconcileShellParts, type TimelineRenderGroup } from '@/lib/agent-timeline-groups';
import { classifyTool } from '@/lib/agent-tool-output';

const EMPTY_SHELLS: readonly ShellInfo[] = [];

/** One canonical timeline per mounted workbench; rows are derived, never mirrored back. */
export function createAgentTranscriptStore() {
  return createStore<AgentTranscriptState>((set, get) => {
    const rebuild = (timeline: TimelineItem[], config = get().config) => {
      const previous = get();
      const visible = reconcileShellParts(timeline, config.shells).slice(config.windowStart);
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
      config: { shells: EMPTY_SHELLS, windowStart: 0, status: undefined },
      setTimeline: (update) => {
        const current = get().timeline;
        const next = typeof update === 'function' ? update(current) : update;
        if (next !== current) rebuild(next);
      },
      configure: (config) => {
        const current = get().config;
        if (
          current.shells !== config.shells ||
          current.windowStart !== config.windowStart ||
          current.status !== config.status
        )
          rebuild(get().timeline, config);
      },
    };
  });
}

interface TranscriptConfig {
  shells: readonly ShellInfo[];
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
  setTimeline: (update: TimelineItem[] | ((previous: TimelineItem[]) => TimelineItem[])) => void;
  configure: (config: TranscriptConfig) => void;
}
export type AgentTranscriptStore = ReturnType<typeof createAgentTranscriptStore>;
