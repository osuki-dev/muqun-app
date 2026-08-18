import { create } from 'zustand';

/**
 * The panel picker is a sheet route, so it cannot hand its choice back through
 * the navigator without pushing another copy of the server screen. It writes
 * the pick here instead; the server screen reads it and clears it.
 */
type PanelPick = {
  serverId: string;
  paneId: string;
};

type PanelPickerState = {
  pick: PanelPick | null;
  choosePanel: (pick: PanelPick) => void;
  clearPick: () => void;
};

export const usePanelPickerStore = create<PanelPickerState>((set) => ({
  pick: null,
  choosePanel: (pick) => set({ pick }),
  clearPick: () => set({ pick: null }),
}));
