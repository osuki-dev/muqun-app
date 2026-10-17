import { create } from 'zustand';

import {
  dismissNotice,
  dismissNoticeKind,
  dismissSessionNotices,
  dismissSessionQuestions,
  enqueueNotice,
  resolveQuestionNotice,
  reopenQuestionNotice,
  type QuestionNoticeIdentity,
  type InAppNotice,
  type NoticeKind,
  type NoticeQueue,
} from '@/lib/in-app-notifications';
import type { TaskView } from '@/lib/task-ledger';

interface NoticeState extends NoticeQueue {
  enqueue: (notice: InAppNotice) => void;
  dismiss: (id: string) => void;
  dismissKind: (kind: NoticeKind) => void;
  dismissQuestions: (asid: string, serverId: string) => void;
  resolveQuestion: (question: QuestionNoticeIdentity) => void;
  reopenQuestion: (question: QuestionNoticeIdentity) => void;
  dismissSession: (asid: string) => void;
  clear: () => void;
}

/**
 * The reader opened or acknowledged a task from Home: what was said about its
 * session ("Agent blocked", "Agent done") is no longer news.
 */
export function dismissTaskNotices(task: TaskView): void {
  if (task.binding.kind === 'agent_session') {
    useInAppNotifications.getState().dismissSession(task.binding.asid);
  }
}

export const useInAppNotifications = create<NoticeState>((set) => ({
  items: [],
  seen: [],
  enqueue: (notice) => set((state) => enqueueNotice(state, notice)),
  dismiss: (id) => set((state) => dismissNotice(state, id)),
  dismissKind: (kind) => set((state) => dismissNoticeKind(state, kind)),
  dismissQuestions: (asid, serverId) =>
    set((state) => dismissSessionQuestions(state, asid, serverId)),
  resolveQuestion: (question) => set((state) => resolveQuestionNotice(state, question)),
  reopenQuestion: (question) => set((state) => reopenQuestionNotice(state, question)),
  dismissSession: (asid) => set((state) => dismissSessionNotices(state, asid)),
  // Retain bounded receipt IDs so late duplicate callbacks stay dismissed.
  clear: () => set({ items: [] }),
}));
