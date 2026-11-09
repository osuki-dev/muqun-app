import { create } from 'zustand';

/**
 * A message a search hit asked to be shown, waiting for its session to open.
 *
 * The search result and the workbench that opens the session are different
 * screens (Home, the sessions sheet), so the request is handed over here: the
 * opener writes it just before it navigates, and the workbench showing that
 * session takes it, scrolls to the row and lets go of it.
 */
export interface SessionRevealRequest {
  serverId: string;
  asid: string;
  itemId: string;
  messageId: string;
  /** Distinguishes two requests for the same row, and dates the request. */
  atMs: number;
}

/** A request not taken by then belongs to a navigation that never arrived. */
export const SESSION_REVEAL_TTL_MS = 30_000;

interface SessionRevealState {
  pending: SessionRevealRequest | null;
  request: (request: Omit<SessionRevealRequest, 'atMs'>) => void;
  /** Lets go of this request, and only this one. */
  settle: (request: SessionRevealRequest) => void;
}

export const useSessionReveal = create<SessionRevealState>((set, get) => ({
  pending: null,
  request: (request) => set({ pending: { ...request, atMs: Date.now() } }),
  settle: (request) => {
    if (get().pending === request) set({ pending: null });
  },
}));
