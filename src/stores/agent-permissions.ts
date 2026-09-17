import { create } from 'zustand';

import type { PermissionDecision, PermissionRequest } from '@/lib/agent-session';

/**
 * The permissions waiting for an answer, indexed by the call they came from.
 *
 * A permission card is drawn under the tool row whose `part.id` matches its
 * `source_tool_call_id`. The obvious way to do that is to hand every card the
 * pending list and let it search -- which is what this replaces, and which
 * meant one permission arriving changed the object every memoised tool card
 * was comparing against. A single `external_directory` prompt re-rendered
 * every tool card in the transcript, including the diffs.
 *
 * A store instead, selected by call id: zustand re-renders only the subscribers
 * whose selected value actually changed, so the one card the permission belongs
 * to redraws and nothing else does. The same shape as `agent-sheet-bridge`,
 * one step smaller.
 */
interface AgentPermissionStore {
  /** Only the requests that name a call; the rest live in the footer. */
  byToolCall: Readonly<Record<string, PermissionRequest>>;
  /** Answering is the workbench's, which owns the session and the transport. */
  decide: ((permissionId: string, decision: PermissionDecision) => Promise<void>) | null;
  publish: (requests: readonly PermissionRequest[]) => void;
  setDecider: (decide: AgentPermissionStore['decide']) => void;
  reset: () => void;
}

const EMPTY: Readonly<Record<string, PermissionRequest>> = Object.freeze({});

/** Whether two indexes name the same requests, by id. */
function sameIndex(
  a: Readonly<Record<string, PermissionRequest>>,
  b: Readonly<Record<string, PermissionRequest>>
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

export const useAgentPermissionStore = create<AgentPermissionStore>((set, get) => ({
  byToolCall: EMPTY,
  decide: null,
  publish: (requests) => {
    const next: Record<string, PermissionRequest> = {};
    for (const request of requests) {
      if (request.source_tool_call_id) next[request.source_tool_call_id] = request;
    }
    // A stream tick that changed nothing here commits nothing, so a permission
    // that is still pending does not re-render the card it is attached to on
    // every frame of the turn it is blocking.
    if (sameIndex(get().byToolCall, next)) return;
    set({ byToolCall: Object.keys(next).length === 0 ? EMPTY : next });
  },
  setDecider: (decide) => set({ decide }),
  reset: () => set({ byToolCall: EMPTY, decide: null }),
}));

/** The request attached to one tool call, if there is one. */
export function usePermissionForToolCall(toolCallId: string): PermissionRequest | undefined {
  return useAgentPermissionStore((state) => state.byToolCall[toolCallId]);
}

/** How to answer one, or `null` when no workbench is mounted behind the card. */
export function usePermissionDecider(): AgentPermissionStore['decide'] {
  return useAgentPermissionStore((state) => state.decide);
}
