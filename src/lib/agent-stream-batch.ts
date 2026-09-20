import type { AgentDomainEvent, TimelineItem } from './agent-protocol';

// Bound native Markdown parsing and transcript layout to one update per 80 ms.
// This is a throttle: continuous output never postpones the scheduled flush.
export const AGENT_STREAM_BATCH_MS = 80;

export function createAgentStreamBatch(deliver: (event: AgentDomainEvent) => void) {
  let pending: Extract<AgentDomainEvent, { type: 'agent.timeline.upsert' }> | undefined;
  const items = new Map<string, TimelineItem>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    const event = pending;
    pending = undefined;
    if (!event) return;
    const batch = [...items.values()];
    items.clear();
    deliver({ ...event, items: batch });
  };

  return {
    push(event: AgentDomainEvent) {
      // Deletion, completion, permission and form events remain immediate and
      // ordered after all preceding text. Never merge different sessions.
      if (event.type !== 'agent.timeline.upsert') {
        flush();
        deliver(event);
        return;
      }
      if (pending && pending.asid !== event.asid) flush();
      pending = { ...event, seq: Math.max(pending?.seq ?? 0, event.seq) };
      for (const item of event.items) {
        const previous = items.get(item.id);
        if (!previous || item.seq >= previous.seq) items.set(item.id, item);
      }
      timer ??= setTimeout(flush, AGENT_STREAM_BATCH_MS);
    },
    flush,
    cancel() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      pending = undefined;
      items.clear();
    },
  };
}
