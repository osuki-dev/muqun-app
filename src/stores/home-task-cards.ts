import { createMMKV } from 'react-native-mmkv';
import { create } from 'zustand';

import { dismissedKey, type PendingDispatch } from '@/lib/home-computer-cards';

type KeyValueStore = {
  getString: (key: string) => string | undefined;
  set: (key: string, value: string) => void;
};

const STORE_ID = 'muqun.home';
const DISMISSED_KEY = 'muqun.home.acknowledged-tasks.v1';
/** Enough for months of finished work; the oldest acknowledgement goes first. */
const MAX_DISMISSED = 500;
/** A sent goal no task ever answered stops claiming the computer is busy. */
export const PENDING_DISPATCH_TTL_MS = 2 * 60_000;

function openStore(): KeyValueStore {
  try {
    return createMMKV({ id: STORE_ID });
  } catch {
    const memory = new Map<string, string>();
    return {
      getString: (key) => memory.get(key),
      set: (key, value) => {
        memory.set(key, value);
      },
    };
  }
}

let storage: KeyValueStore | null = null;
function store(): KeyValueStore {
  if (!storage) storage = openStore();
  return storage;
}

function loadDismissed(): string[] {
  try {
    const parsed = JSON.parse(store().getString(DISMISSED_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter((key) => typeof key === 'string') : [];
  } catch {
    return [];
  }
}

let nextPendingId = 0;

type HomeTaskCardsState = {
  /** Finished tasks the reader acknowledged: off the card, still in the Tasks sheet. */
  dismissed: readonly string[];
  /** Goals the dock sent that no task has answered yet. In memory only. */
  pending: readonly PendingDispatch[];
  acknowledge: (serverId: string, taskId: string) => void;
  /** The dock sent a goal; the card shows it until the task frame lands. */
  dispatched: (serverId: string, goal: string) => string;
  /** The send failed, or the task came back with the answer. */
  settle: (id: string) => void;
  /** The goal's attachments could not be sent: the row stays and says so. */
  attachmentFailed: (id: string) => void;
  /**
   * What a tap on a failed row does: the dock sends the draft it kept
   * (text and attachments) again. `null` while no dock is mounted.
   */
  retryFailedSend: (() => void) | null;
  setRetryFailedSend: (retry: (() => void) | null) => void;
  /** The row whose work is being opened (`taskOpeningKey`): it shows a loading state. */
  opening: string | null;
  setOpening: (key: string | null) => void;
};

export function taskOpeningKey(serverId: string, taskId: string): string {
  return `${serverId}\u0000${taskId}`;
}

/** The row `key` shows its loading state until `open` settles (unless another row took over). */
export function showOpeningWhile(key: string, open: Promise<void>): void {
  useHomeTaskCards.getState().setOpening(key);
  void open.then(() => {
    if (useHomeTaskCards.getState().opening === key) useHomeTaskCards.getState().setOpening(null);
  });
}

export const useHomeTaskCards = create<HomeTaskCardsState>((set, get) => ({
  dismissed: loadDismissed(),
  pending: [],
  retryFailedSend: null,
  setRetryFailedSend(retry) {
    set({ retryFailedSend: retry });
  },
  opening: null,
  setOpening(key) {
    set({ opening: key });
  },
  acknowledge(serverId, taskId) {
    const key = dismissedKey(serverId, taskId);
    if (get().dismissed.includes(key)) return;
    const dismissed = [...get().dismissed, key].slice(-MAX_DISMISSED);
    set({ dismissed });
    try {
      store().set(DISMISSED_KEY, JSON.stringify(dismissed));
    } catch {
      // Kept for this launch.
    }
  },
  dispatched(serverId, goal) {
    const id = `dispatch-${++nextPendingId}`;
    const now = Date.now();
    set((state) => ({
      pending: [
        // A retry replaces the row its failure left, rather than standing beside it.
        ...state.pending.filter(
          (item) =>
            now - item.atMs < PENDING_DISPATCH_TTL_MS &&
            !(item.attachmentFailed && item.serverId === serverId && item.goal === goal)
        ),
        { id, serverId, goal, atMs: now },
      ],
    }));
    return id;
  },
  settle(id) {
    set((state) => ({ pending: state.pending.filter((item) => item.id !== id) }));
  },
  attachmentFailed(id) {
    set((state) => ({
      pending: state.pending.map((item) =>
        item.id === id ? { ...item, attachmentFailed: true as const } : item
      ),
    }));
  },
}));
