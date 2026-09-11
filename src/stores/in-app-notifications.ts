import { create } from 'zustand';

import {
  dismissNotice,
  enqueueNotice,
  type InAppNotice,
  type NoticeQueue,
} from '@/lib/in-app-notifications';

interface NoticeState extends NoticeQueue {
  enqueue: (notice: InAppNotice) => void;
  dismiss: (id: string) => void;
  clear: () => void;
}

export const useInAppNotifications = create<NoticeState>((set) => ({
  items: [],
  seen: [],
  enqueue: (notice) => set((state) => enqueueNotice(state, notice)),
  dismiss: (id) => set((state) => dismissNotice(state, id)),
  // Retain bounded receipt IDs so late duplicate callbacks stay dismissed.
  clear: () => set({ items: [] }),
}));
