import { create } from 'zustand';

type HomeAgentPickerState = {
  openRequestId: number | null;
  serverId: string | null;
  completedRequestId: number | null;
  /** The agent the reader chose, or `null` when the sheet was dismissed. */
  completedAgentId: string | null;
  begin: (serverId: string) => number;
  /** Ends a request, with the agent picked or with none. */
  complete: (requestId: number, agentId: string | null) => void;
};

let nextRequestId = 0;

/**
 * The "More agents" sheet hands back the agent the reader picked without
 * starting anything itself. Home owns the command that starts a session -- its
 * duplicate-tap guard, readiness gate and intent claims -- so the sheet only
 * answers, and the launch row runs the command from where it already is. The
 * same handoff `home-target-picker` makes for the gateway sheet.
 */
export const useHomeAgentPicker = create<HomeAgentPickerState>((set, get) => ({
  openRequestId: null,
  serverId: null,
  completedRequestId: null,
  completedAgentId: null,

  begin(serverId) {
    const requestId = ++nextRequestId;
    set({
      openRequestId: requestId,
      serverId,
      completedRequestId: null,
      completedAgentId: null,
    });
    return requestId;
  },

  complete(requestId, agentId) {
    if (get().openRequestId !== requestId) return;
    set({ openRequestId: null, completedRequestId: requestId, completedAgentId: agentId });
  },
}));
