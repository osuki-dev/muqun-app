import { createStore } from 'zustand/vanilla';

import type { HomeServerEntry } from '@/lib/home-commands';

export type HomeWorkspaceHandoff = {
  id: number;
  target: HomeServerEntry;
  /** The owner that published before changing the selected server. */
  sourceServerId?: string;
};

type HomeWorkspaceHandoffState = {
  handoff: HomeWorkspaceHandoff | null;
  publish: (
    target: HomeServerEntry,
    isCurrent?: () => boolean,
    sourceServerId?: string
  ) => number | null;
  consume: (id: number) => HomeWorkspaceHandoff | null;
  clear: () => void;
};

let nextHandoffId = 0;

/** Ephemeral, server-scoped terminal destinations shared across Home owner changes. */
export const homeWorkspaceHandoffStore = createStore<HomeWorkspaceHandoffState>((set, get) => ({
  handoff: null,
  publish(target, isCurrent, sourceServerId) {
    if (isCurrent && !isCurrent()) return null;
    const handoff = { id: ++nextHandoffId, target, sourceServerId };
    set({ handoff });
    return handoff.id;
  },
  consume(id) {
    const handoff = get().handoff;
    if (!handoff || handoff.id !== id) return null;
    set({ handoff: null });
    return handoff;
  },
  clear() {
    if (get().handoff) set({ handoff: null });
  },
}));
