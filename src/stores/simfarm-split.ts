import { create } from 'zustand';

/**
 * Which servers are showing the simulator beside their terminal.
 *
 * A store rather than state in the workspace, because the control that flips it
 * lives in the quick actions sheet -- a route of its own, unmounted the moment
 * it closes. The workspace is what reads it.
 *
 * Deliberately not persisted, and keyed by server for the same reason the pane
 * view memory is: it is a decision about the machine on screen right now, and
 * the setting is what survives a restart. Coming back to the app and finding a
 * column of someone else's simulator where the terminal used to be is not a
 * preference being honoured, it is a surprise.
 */
type SimfarmSplitState = {
  openByServer: Record<string, boolean>;
  isOpen: (serverId: string | undefined) => boolean;
  toggle: (serverId: string) => void;
  close: (serverId: string) => void;
};

export const useSimfarmSplit = create<SimfarmSplitState>((set, get) => ({
  openByServer: {},

  isOpen(serverId) {
    return serverId ? get().openByServer[serverId] === true : false;
  },

  toggle(serverId) {
    if (!serverId) return;
    set((state) => ({
      openByServer: { ...state.openByServer, [serverId]: !state.openByServer[serverId] },
    }));
  },

  close(serverId) {
    if (!serverId) return;
    set((state) =>
      state.openByServer[serverId]
        ? { openByServer: { ...state.openByServer, [serverId]: false } }
        : state
    );
  },
}));
