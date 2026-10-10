import { createMMKV } from 'react-native-mmkv';
import { create } from 'zustand';

import {
  dismissedKey,
  pendingShown,
  type PendingDispatch,
  type PendingResend,
} from '@/lib/home-computer-cards';

type KeyValueStore = {
  getString: (key: string) => string | undefined;
  set: (key: string, value: string) => void;
};

const STORE_ID = 'muqun.home';
const DISMISSED_KEY = 'muqun.home.acknowledged-tasks.v1';
/** Enough for months of finished work; the oldest acknowledgement goes first. */
const MAX_DISMISSED = 500;
export { PENDING_DISPATCH_TTL_MS } from '@/lib/home-computer-cards';

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
  /** The send failed: the row stays, says why, and keeps what to send again. */
  failed: (id: string, reason: string, resend: PendingResend) => void;
  /** It went to a session directly: the row stands for it until its task appears. */
  bound: (id: string, asid: string) => void;
  /**
   * What a tap on a row does, from the dock that sent it: a failed one is
   * sent again exactly as it was, a bound one opens its session. `null` while
   * no dock is mounted.
   */
  rowActions: {
    retry: (item: PendingDispatch) => void;
    open: (item: PendingDispatch) => void;
  } | null;
  setRowActions: (actions: HomeTaskCardsState['rowActions']) => void;
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
  rowActions: null,
  setRowActions(actions) {
    set({ rowActions: actions });
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
            pendingShown(item, now) &&
            !(item.failed && item.serverId === serverId && item.goal === goal)
        ),
        { id, serverId, goal, atMs: now },
      ],
    }));
    return id;
  },
  settle(id) {
    set((state) => ({ pending: state.pending.filter((item) => item.id !== id) }));
  },
  failed(id, reason, resend) {
    set((state) => ({
      pending: state.pending.map((item) =>
        item.id === id ? { ...item, failed: true as const, reason, resend } : item
      ),
    }));
  },
  bound(id, asid) {
    set((state) => ({
      pending: state.pending.map((item) => (item.id === id ? { ...item, asid } : item)),
    }));
  },
}));
