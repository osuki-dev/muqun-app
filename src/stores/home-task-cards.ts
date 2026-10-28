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
  durable?: false;
  getString: (key: string) => string | undefined;
  set: (key: string, value: string) => void;
};

const STORE_ID = 'muqun.home';
const DISMISSED_KEY = 'muqun.home.acknowledged-tasks.v1';
const HIDDEN_KEY = 'muqun.home.hidden-tasks.v1';
const PENDING_KEY = 'muqun.home.pending-dispatches.v1';
const DECK_FRONT_KEY = 'muqun.home.deck-front.v1';
/** Bound local draft serialization without evicting somebody else's unsettled work. */
const MAX_PENDING_DRAFT_BYTES = 8 * 1024 * 1024;
/** Reserve outcome/binding metadata before a new submission is transmitted. */
const PENDING_OUTCOME_RESERVE_BYTES = 2048;

export class HomeDraftStorageError extends Error {
  constructor(readonly reason: 'full' | 'unavailable') {
    super('Could not persist the outgoing draft');
    this.name = 'HomeDraftStorageError';
  }
}
/** Enough for months of finished work; the oldest acknowledgement goes first. */
const MAX_DISMISSED = 500;
/** Bound local removals independently of per-finish acknowledgements. */
const MAX_HIDDEN = 500;
export { PENDING_DISPATCH_TTL_MS } from '@/lib/home-computer-cards';

function openStore(): KeyValueStore {
  try {
    return createMMKV({ id: STORE_ID });
  } catch {
    const memory = new Map<string, string>();
    return {
      durable: false,
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

/**
 * The Sent rows as they were when the app last ran. A goal sent from Home
 * that never became a ledger task -- a native Codex session on a gateway
 * without session delivery -- is known to this device alone, and this row
 * was all the card had: in memory only, it went with the process, and the
 * work looked as if it had never been sent. Read back without trust, and
 * pruned by the card's own rules.
 */
function loadPending(nowMs: number): PendingDispatch[] {
  try {
    const parsed: unknown = JSON.parse(store().getString(PENDING_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    const rows: PendingDispatch[] = [];
    for (const raw of parsed) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as Record<string, unknown>;
      if (
        typeof item.id !== 'string' ||
        typeof item.serverId !== 'string' ||
        typeof item.goal !== 'string' ||
        typeof item.atMs !== 'number' ||
        !Number.isFinite(item.atMs)
      )
        continue;
      const row: PendingDispatch = {
        id: item.id,
        serverId: item.serverId,
        goal: item.goal,
        atMs: item.atMs,
        ...(item.failed === true ? { failed: true as const } : {}),
        ...(item.unconfirmed === true ? { unconfirmed: true as const } : {}),
        ...(typeof item.reason === 'string' ? { reason: item.reason } : {}),
        ...(isResend(item.resend) ? { resend: item.resend } : {}),
        ...(typeof item.asid === 'string' && item.asid ? { asid: item.asid } : {}),
        ...(isReply(item.reply) ? { reply: item.reply } : {}),
      };
      if (pendingShown(row, nowMs)) rows.push(row);
    }
    return rows;
  } catch {
    return [];
  }
}

function isResend(value: unknown): value is PendingResend {
  if (!value || typeof value !== 'object') return false;
  const resend = value as Record<string, unknown>;
  return (
    typeof resend.text === 'string' &&
    Array.isArray(resend.attachments) &&
    resend.attachments.every((entry) => typeof entry === 'string') &&
    typeof resend.params === 'object' &&
    resend.params !== null
  );
}

function isReply(value: unknown): value is NonNullable<PendingDispatch['reply']> {
  if (!value || typeof value !== 'object') return false;
  const reply = value as Record<string, unknown>;
  return (
    (reply.state === 'working' || reply.state === 'done' || reply.state === 'failed') &&
    typeof reply.atMs === 'number'
  );
}

function savePending(pending: readonly PendingDispatch[], required = false): void {
  const serialized = JSON.stringify(pending);
  if (
    required &&
    new TextEncoder().encode(serialized).length + pending.length * PENDING_OUTCOME_RESERVE_BYTES >
      MAX_PENDING_DRAFT_BYTES
  )
    throw new HomeDraftStorageError('full');
  const destination = store();
  if (required && destination.durable === false) throw new HomeDraftStorageError('unavailable');
  try {
    // These are owned, unsettled submissions, including retryable drafts.
    // A cache-size policy must not silently delete their only durable copy.
    destination.set(PENDING_KEY, serialized);
  } catch {
    if (required) throw new HomeDraftStorageError('unavailable');
    // Kept for this launch.
  }
}

/** A loaded row's number, so a new row never takes an id a kept one holds. */
function pendingIdCounter(pending: readonly PendingDispatch[]): number {
  let highest = 0;
  for (const item of pending) {
    const number = Number(item.id.match(/^dispatch-(\d+)$/)?.[1]);
    if (Number.isFinite(number) && number > highest) highest = number;
  }
  return highest;
}

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

const loadedPending = loadPending(Date.now());
let nextPendingId = pendingIdCounter(loadedPending);

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
  dispatched: (serverId: string, goal: string, draft?: PendingResend) => string;
  /** The send failed, or the task came back with the answer. */
  settle: (id: string) => void;
  /** The send failed: the row stays, says why, and keeps what to send again. */
  failed: (id: string, reason: string, resend: PendingResend) => void;
  /** Keep an unknown receipt and its draft, without offering it as a failed resend. */
  unconfirmed: (id: string, asid: string | undefined, resend: PendingResend) => void;
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
    /** Ask the computer whether an unconfirmed send reached it (the dock's delivery check). */
    check?: (item: PendingDispatch) => void;
  } | null;
  setRowActions: (actions: HomeTaskCardsState['rowActions']) => void;
  /** The row whose work is being opened (`taskOpeningKey`): it shows a loading state. */
  opening: string | null;
  setOpening: (key: string | null) => void;
  /** The computer last brought to the front of the phone's sheaf, across launches. */
  deckFront: string | null;
  setDeckFront: (serverId: string) => void;
};

function loadDeckFront(): string | null {
  try {
    return store().getString(DECK_FRONT_KEY) ?? null;
  } catch {
    return null;
  }
}

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

export const useHomeTaskCards = create<HomeTaskCardsState>((setState, get) => {
  // The Sent rows are written down with every change, like acknowledgements.
  const set: typeof setState = (partial) => {
    setState(partial);
    savePending(get().pending);
  };
  return {
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
    pending: loadedPending,
    rowActions: null,
    setRowActions(actions) {
      set({ rowActions: actions });
    },
    opening: null,
    setOpening(key) {
      set({ opening: key });
    },
    deckFront: loadDeckFront(),
    setDeckFront(serverId) {
      if (get().deckFront === serverId) return;
      try {
        store().set(DECK_FRONT_KEY, serverId);
      } catch {
        // Kept for this launch.
      }
      setState({ deckFront: serverId });
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
    dispatched(serverId, goal, draft) {
      const id = `dispatch-${++nextPendingId}`;
      const now = Date.now();
      const pending = [
        // Equal text is not a submission identity: another draft may carry
        // different files. Explicit retry settles its own row after acceptance.
        ...get().pending.filter((item) => pendingShown(item, now)),
        { id, serverId, goal, atMs: now, ...(draft ? { resend: draft } : {}) },
      ];
      // Refuse the new send before the network side effect, retaining both its
      // composer and all previous drafts if storage or the byte budget fails.
      savePending(pending, true);
      setState({ pending });
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
    unconfirmed(id, asid, resend) {
      set((state) => ({
        pending: state.pending.map((item) =>
          item.id === id ? { ...item, unconfirmed: true as const, asid, resend } : item
        ),
      }));
    },
    bound(id, asid) {
      set((state) => ({
        pending: state.pending.map((item) => (item.id === id ? { ...item, asid } : item)),
      }));
    },
    replied(id, reply, atMs) {
      set((state) => ({
        pending: state.pending.map((item) =>
          item.id === id && (item.reply?.state !== reply || item.unconfirmed)
            ? { ...item, unconfirmed: undefined, reply: { state: reply, atMs } }
            : item
        ),
      }));
    },
  };
});

// A task the ledger shows back at work loses its acknowledgement, so its next
// finish shows on the card (a gateway that counts reopens says so in the key
// too; one that does not, only by the state change).
useHomeTaskCards.getState().followLedgers(useServerTasksStore.getState().index);
useServerTasksStore.subscribe((state, previous) => {
  if (state.index !== previous.index) useHomeTaskCards.getState().followLedgers(state.index);
});
