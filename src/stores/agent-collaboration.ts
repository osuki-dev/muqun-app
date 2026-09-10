import { createMMKV } from 'react-native-mmkv';
import { create } from 'zustand';

import {
  parseCollaborationTasks,
  recordCollaborationTask,
  type CollaborationTask,
  type CollaborationDraft,
} from '@/lib/agent-collaboration';

// Dispatch history stays on this device. Terminal output is never persisted.
const storage = (() => {
  try {
    return createMMKV({ id: 'muqun.agent-collaboration' });
  } catch {
    return null;
  }
})();

type CollaborationState = {
  tasks: CollaborationTask[];
  drafts: Record<string, CollaborationDraft>;
  draftOwners: Record<string, symbol>;
  claimDraft: (scope: string, owner: symbol) => void;
  saveOwnedDraft: (scope: string, owner: symbol, draft: CollaborationDraft | null) => void;
  saveDraft: (scope: string, draft: CollaborationDraft | null) => void;
  add: (task: CollaborationTask) => void;
  review: (id: string) => void;
  remove: (id: string) => void;
};

function save(tasks: CollaborationTask[]) {
  // A storage failure must not turn an already-delivered task into a send
  // failure that invites a duplicate dispatch. Keep this launch's history.
  try {
    storage?.set('tasks', JSON.stringify(tasks));
  } catch {
    /* Memory remains authoritative. */
  }
}

function restore(): CollaborationTask[] {
  try {
    return parseCollaborationTasks(storage?.getString('tasks') ?? null);
  } catch {
    return [];
  }
}

export const useAgentCollaboration = create<CollaborationState>((set) => ({
  tasks: restore(),
  drafts: {},
  draftOwners: {},
  claimDraft: (scope, owner) =>
    set((state) => ({
      draftOwners: { ...state.draftOwners, [scope]: owner },
    })),
  saveOwnedDraft: (scope, owner, draft) =>
    set((state) => {
      if (state.draftOwners[scope] !== owner) return state;
      const drafts = { ...state.drafts };
      if (draft) drafts[scope] = { ...draft, owner };
      else delete drafts[scope];
      return { drafts };
    }),
  saveDraft: (scope, draft) =>
    set((state) => {
      const drafts = { ...state.drafts };
      const draftOwners = { ...state.draftOwners };
      delete draftOwners[scope];
      if (draft) drafts[scope] = draft;
      else delete drafts[scope];
      return { drafts, draftOwners };
    }),
  add: (task) =>
    set((state) => {
      const tasks = recordCollaborationTask(state.tasks, task);
      save(tasks);
      return { tasks };
    }),
  review: (id) =>
    set((state) => {
      const tasks = state.tasks.map((task) =>
        task.id === id ? { ...task, reviewed: true } : task
      );
      save(tasks);
      return { tasks };
    }),
  remove: (id) =>
    set((state) => {
      const tasks = state.tasks.filter((task) => task.id !== id);
      save(tasks);
      return { tasks };
    }),
}));
