import { create } from 'zustand';

import {
  dismissNotice,
  dismissNoticeKind,
  dismissSessionQuestions,
  enqueueNotice,
  type InAppNotice,
  type NoticeKind,
  type NoticeQueue,
} from '@/lib/in-app-notifications';

interface NoticeState extends NoticeQueue {
  enqueue: (notice: InAppNotice) => void;
  dismiss: (id: string) => void;
  dismissKind: (kind: NoticeKind) => void;
  dismissQuestions: (asid: string) => void;
  clear: () => void;
}

export const useInAppNotifications = create<NoticeState>((set) => ({
  items: [],
  seen: [],
  enqueue: (notice) => set((state) => enqueueNotice(state, notice)),
  dismiss: (id) => set((state) => dismissNotice(state, id)),
  dismissKind: (kind) => set((state) => dismissNoticeKind(state, kind)),
  dismissQuestions: (asid) => set((state) => dismissSessionQuestions(state, asid)),
  // Retain bounded receipt IDs so late duplicate callbacks stay dismissed.
  clear: () => set({ items: [] }),
}));
