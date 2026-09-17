import type { TimelineItem, TimelineRole } from './agent-session';

/**
 * One rendered message: the timeline's flat per-part items grouped back into
 * the shape OpenCode's own UI renders — a message owns its parts, so the
 * reasoning ("thinking") and the tool calls made inside it fold into a single
 * block instead of scrolling past as separate list rows.
 */
export interface TimelineRenderGroup {
  key: string;
  role: TimelineRole;
  items: TimelineItem[];
  /** The timeline item directly before this group, for tool-output dedup. */
  prevItem?: TimelineItem;
}

/** Cheap identity signature for reuse: item ids+revisions plus the prior item. */
function groupSignature(group: Pick<TimelineRenderGroup, 'items' | 'prevItem'>): string {
  const parts: string[] = [];
  for (const item of group.items) {
    parts.push(`${item.id}:${item.updated_ms ?? 0}`);
  }
  const prev = group.prevItem;
  parts.push(prev ? `p${prev.id}:${prev.updated_ms ?? 0}` : 'p-');
  return parts.join('|');
}

/**
 * Group consecutive timeline items that share a `message_id` into one message.
 *
 * `previous` carries the groups the last render emitted. A group whose items
 * (ids + revision) and preceding item are unchanged is **reused as the same
 * object reference**, so memoised message cells skip rendering on the SSE ticks
 * of a *different* message — a streamed reply then costs one cell re-render
 * instead of the whole visible list.
 */
export function buildTimelineGroups(
  items: TimelineItem[],
  previous?: readonly TimelineRenderGroup[]
): TimelineRenderGroup[] {
  const groups: TimelineRenderGroup[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const last = groups[groups.length - 1];
    if (last && last.items[0].message_id === item.message_id) {
      last.items.push(item);
      continue;
    }
    const prevItem = i > 0 ? items[i - 1] : undefined;
    const candidate: TimelineRenderGroup = {
      key: `grp_${item.id}`,
      role: item.role,
      items: [item],
      prevItem,
    };
    // Reuse the previous group rendered at the same position when nothing in
    // it changed; the reference staying identical is what lets memo skip.
    const prior = previous?.[groups.length];
    if (
      prior &&
      prior.key === candidate.key &&
      groupSignature(prior) === groupSignature(candidate)
    ) {
      groups.push(prior);
    } else {
      groups.push(candidate);
    }
  }
  return groups;
}
