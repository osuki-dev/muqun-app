import { createMMKV } from 'react-native-mmkv';
import { create } from 'zustand';

import type { ServerTasksIndex } from '@/lib/server-tasks-state';
import type { TaskView } from '@/lib/task-ledger';
import { useServerTasksStore } from '@/stores/server-tasks';

import {
  acknowledgementsHeld,
  dismissedKey,
  hiddenTaskKey,
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
const HIDDEN_KEY = 'muqun.home.hidden-tasks.v1';
/** Enough for months of finished work; the oldest acknowledgement goes first. */
const MAX_DISMISSED = 500;
/** Bound local removals independently of per-finish acknowledgements. */
const MAX_HIDDEN = 500;
export { PENDING_DISPATCH_TTL_MS } from '@/lib/home-computer-cards';
/** How many failed Sent rows are kept, holding their drafts, at most. */
export const MAX_FAILED_ROWS = 10;

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
    if (!Array.isArray(parsed)) return [];
    // Kept before acknowledgements were per finish: they stand for the first.
    return parsed
      .filter((key): key is string => typeof key === 'string')
      .map((key) => (key.split('\n').length === 2 ? `${key}\n0` : key));
  } catch {
    return [];
  }
}

function saveDismissed(dismissed: readonly string[]): void {
  loadedDismissed = dismissed;
  try {
    store().set(DISMISSED_KEY, JSON.stringify(dismissed));
  } catch {
    // Kept for this launch.
  }
}
let loadedDismissed: readonly string[] = [];

function loadHidden(): string[] {
  try {
    const parsed: unknown = JSON.parse(store().getString(HIDDEN_KEY) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter((key): key is string => typeof key === 'string').slice(-MAX_HIDDEN)
      : [];
  } catch {
    return [];
  }
}

let nextPendingId = 0;

type HomeTaskCardsState = {
  /** Finished tasks the reader acknowledged: off the card, still in the Tasks sheet. */
  dismissed: readonly string[];
  /** Removed from Home only; retained offline and across task state changes. */
  hidden: readonly string[];
  hide: (serverId: string, task: Pick<TaskView, 'taskId'>) => void;
  /** Goals the dock sent that no task has answered yet. In memory only. */
  pending: readonly PendingDispatch[];
  /** This finish of this task was seen: off the card until it finishes again. */
  acknowledge: (serverId: string, task: Pick<TaskView, 'taskId' | 'reopenCount'>) => void;
  /** Let go of acknowledgements whose task went back to work. */
  followLedgers: (index: ServerTasksIndex) => void;
  /** The dock sent a goal; the card shows it until the task frame lands. */
  dispatched: (serverId: string, goal: string) => string;
  /** The send failed, or the task came back with the answer. */
  settle: (id: string) => void;
  /** The send failed: the row stays, says why, and keeps what to send again. */
  failed: (id: string, reason: string, resend: PendingResend) => void;
  /** It went to a session directly: the row stands for it until its task appears. */
  bound: (id: string, asid: string) => void;
  /** Its session's agent replied: the row reads like a task in that state. */
  replied: (id: string, state: 'working' | 'done' | 'failed', atMs: number) => void;
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
  dismissed: (loadedDismissed = loadDismissed()),
  hidden: loadHidden(),
  hide(serverId, task) {
    const key = hiddenTaskKey(serverId, task.taskId);
    if (get().hidden.includes(key)) return;
    const hidden = [...get().hidden, key].slice(-MAX_HIDDEN);
    try {
      store().set(HIDDEN_KEY, JSON.stringify(hidden));
    } catch {
      // Keep the removal for this launch when storage is unavailable.
    }
    set({ hidden });
  },
  pending: [],
  rowActions: null,
  setRowActions(actions) {
    set({ rowActions: actions });
  },
  opening: null,
  setOpening(key) {
    set({ opening: key });
  },
  acknowledge(serverId, task) {
    const key = dismissedKey(serverId, task);
    if (get().dismissed.includes(key)) return;
    saveDismissed([...get().dismissed, key].slice(-MAX_DISMISSED));
    set({ dismissed: loadedDismissed });
  },
  followLedgers(index) {
    const dismissed = acknowledgementsHeld(get().dismissed, index);
    if (dismissed === get().dismissed) return;
    saveDismissed(dismissed);
    set({ dismissed });
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
    set((state) => {
      const pending = state.pending.map((item) =>
        item.id === id ? { ...item, failed: true as const, reason, resend } : item
      );
      // A failed row stays until acted on; past the cap the oldest goes first.
      const failed = pending.filter((item) => item.failed).sort((a, b) => a.atMs - b.atMs);
      const over = new Set(
        failed.slice(0, Math.max(0, failed.length - MAX_FAILED_ROWS)).map((item) => item.id)
      );
      return { pending: over.size ? pending.filter((item) => !over.has(item.id)) : pending };
    });
  },
  bound(id, asid) {
    set((state) => ({
      pending: state.pending.map((item) => (item.id === id ? { ...item, asid } : item)),
    }));
  },
  replied(id, reply, atMs) {
    set((state) => ({
      pending: state.pending.map((item) =>
        item.id === id && item.reply?.state !== reply
          ? { ...item, reply: { state: reply, atMs } }
          : item
      ),
    }));
  },
}));

// A task the ledger shows back at work loses its acknowledgement, so its next
// finish shows on the card (a gateway that counts reopens says so in the key
// too; one that does not, only by the state change).
useHomeTaskCards.getState().followLedgers(useServerTasksStore.getState().index);
useServerTasksStore.subscribe((state, previous) => {
  if (state.index !== previous.index) useHomeTaskCards.getState().followLedgers(state.index);
});
