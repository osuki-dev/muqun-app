import { create } from 'zustand';

/**
 * The two things the OpenCode setup sheet cannot express as a route param.
 *
 * The sheet is a `formSheet` route now, so it is mounted by the navigator
 * rather than by the server card that raised it, and the card's own readiness
 * probe -- the one whose result decides whether the card shows a warning -- is
 * a closure over that card's state. Registering it here keeps one probe per
 * server: several cards are on screen at once and a single slot would have the
 * last one to mount answering for all of them.
 *
 * `openAgentFor` is the same handoff `stores/panel-picker.ts` makes: a sheet
 * cannot navigate somewhere else and dismiss itself in one gesture without
 * stacking a screen under itself, so it writes where the reader asked to go
 * and the card reads it and clears it.
 */
type OpenCodeGuideState = {
  probes: Readonly<Record<string, () => Promise<boolean>>>;
  openAgentFor: string | null;
  registerProbe: (serverId: string, probe: () => Promise<boolean>) => void;
  clearProbe: (serverId: string) => void;
  requestOpenAgent: (serverId: string) => void;
  clearOpenAgent: () => void;
};

export const useOpenCodeGuideStore = create<OpenCodeGuideState>((set) => ({
  probes: {},
  openAgentFor: null,
  registerProbe: (serverId, probe) =>
    set((state) => ({ probes: { ...state.probes, [serverId]: probe } })),
  clearProbe: (serverId) =>
    set((state) => {
      if (!(serverId in state.probes)) return state;
      const next = { ...state.probes };
      delete next[serverId];
      return { probes: next };
    }),
  requestOpenAgent: (serverId) => set({ openAgentFor: serverId }),
  clearOpenAgent: () => set({ openAgentFor: null }),
}));
