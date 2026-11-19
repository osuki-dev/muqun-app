import type { TimelineItem } from './agent-protocol';

// Count the retained structure without serializing multi-megabyte tool output
// or visiting the rest of a payload once its budget has been exhausted.
function remainingBudget(value: unknown, budget: number, depth = 0): number {
  if (budget < 0 || depth > 20) return -1;
  if (typeof value === 'string') return budget - 24 - value.length * 2;
  if (!value || typeof value !== 'object') return budget - 16;
  budget -= 48;
  for (const key in value) {
    if (!Object.hasOwn(value, key)) continue;
    budget = remainingBudget(
      (value as Record<string, unknown>)[key],
      budget - 24 - key.length * 2,
      depth + 1
    );
    if (budget < 0) break;
  }
  return budget;
}

/** Recent transcript text is presentation only. Permissions, cursors and
 * sequence numbers always come from the Gateway for the current entry. */
export class AgentEntryPreviews {
  private readonly entries = new Map<string, TimelineItem[]>();
  read(source: string | null, asid: string) {
    return source ? this.entries.get(JSON.stringify([source, asid])) : undefined;
  }
  remember(source: string | null, asid: string, timeline: readonly TimelineItem[]) {
    if (!source) return;
    const key = JSON.stringify([source, asid]);
    this.entries.delete(key);
    const tail: TimelineItem[] = [];
    let budget = 256 * 1024;
    for (let i = timeline.length - 1; i >= 0 && i >= timeline.length - 40; i--) {
      const item = timeline[i];
      if (item.id.startsWith('temp_')) continue;
      budget = remainingBudget(item, budget);
      if (budget < 0) break;
      tail.push(item);
    }
    tail.reverse();
    if (tail.length === 0) return;
    this.entries.set(key, tail);
    if (this.entries.size > 8) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
  }
}

export const agentEntryPreviews = new AgentEntryPreviews();
