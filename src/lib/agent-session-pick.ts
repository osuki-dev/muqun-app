import type { AgentSessionInfo } from './agent-protocol';

/**
 * Which session the workbench opens on, as one pure decision.
 *
 * Coming in from Home used to land on `latestSession` -- the newest
 * `updated_ms` -- which reads as "where you left off" only while nothing else
 * is moving. An agent finishing a turn in another session updates that
 * session, so a reader who picked B, went Home and came back was shown A: the
 * screen was tracking the host's activity, not the reader's choice.
 *
 * The reader's choice is a fact the host does not hold, so the app keeps it
 * (`agent-session-memory.ts`) and this decides what to do with it. Newest
 * activity is still the answer when there is no choice to honour, or when the
 * session it named is gone.
 *
 * Pure, and separate from where the memory is kept, so the rule can be read
 * and tested without a native store.
 */

/** The session with the newest activity, or null when there is none. */
export function latestSession(list: readonly AgentSessionInfo[]): AgentSessionInfo | null {
  let best: AgentSessionInfo | null = null;
  for (const item of list) {
    if (!best || (item.updated_ms ?? 0) > (best.updated_ms ?? 0)) best = item;
  }
  return best;
}

/**
 * The session the reader last opened, while this list still has it.
 *
 * A remembered asid that is not in the list is a session that was deleted,
 * moved out of this workspace, or fell off the end of a bounded listing. It is
 * not an error and it is not worth a notice: the reader is simply somewhere
 * they have not chosen yet, and newest activity is the best answer there is.
 */
export function pickSessionToOpen(
  list: readonly AgentSessionInfo[],
  remembered?: string
): AgentSessionInfo | null {
  if (remembered) {
    const kept = list.find((session) => session.asid === remembered);
    if (kept) return kept;
  }
  return latestSession(list);
}
