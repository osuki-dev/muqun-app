import { create } from 'zustand';

import {
  dismissNotice,
  dismissNoticeKind,
  enqueueNotice,
  type InAppNotice,
  type NoticeKind,
  type NoticeQueue,
} from '@/lib/in-app-notifications';

interface NoticeState extends NoticeQueue {
  /**
   * How tall the deck on screen is, published by the host that draws it.
   *
   * A notice is an overlay, and an overlay over a transcript is a lid on the
   * row the reader was reading. A screen that wants to keep its content clear
   * of one needs to know how much room to leave, and only the host can
   * measure that -- the card's height is its text's.
   */
  overlayHeight: number;
  enqueue: (notice: InAppNotice) => void;
  dismiss: (id: string) => void;
  dismissKind: (kind: NoticeKind) => void;
  setOverlayHeight: (height: number) => void;
  clear: () => void;
}

export const useInAppNotifications = create<NoticeState>((set) => ({
  items: [],
  seen: [],
  overlayHeight: 0,
  enqueue: (notice) => set((state) => enqueueNotice(state, notice)),
  dismiss: (id) => set((state) => dismissNotice(state, id)),
  dismissKind: (kind) => set((state) => dismissNoticeKind(state, kind)),
  setOverlayHeight: (height) =>
    set((state) => (state.overlayHeight === height ? state : { overlayHeight: height })),
  // Retain bounded receipt IDs so late duplicate callbacks stay dismissed.
  clear: () => set({ items: [], overlayHeight: 0 }),
}));
