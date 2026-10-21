import { createMMKV } from 'react-native-mmkv';
import { create } from 'zustand';

import { keepKeys } from '@/lib/keep-keys';
import {
  EMPTY_HOME_THREAD_LIVE,
  parseHomeThreads,
  type HomeThreadLive,
  type HomeThreadTarget,
} from '@/lib/home-thread';

type KeyValueStore = {
  getString: (key: string) => string | undefined;
  set: (key: string, value: string) => void;
};

const STORE_ID = 'muqun.home';
const THREADS_KEY = 'muqun.home.thread.v1';

/** MMKV, as `home-agent-choice` keeps the dock's other picks; memory when absent. */
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

function load(): Record<string, HomeThreadTarget> {
  try {
    return parseHomeThreads(store().getString(THREADS_KEY));
  } catch {
    return {};
  }
}

function save(byServer: Record<string, HomeThreadTarget>) {
  try {
    store().set(THREADS_KEY, JSON.stringify(byServer));
  } catch {
    // Kept in memory for this launch.
  }
}

type HomeThreadState = {
  /** The conversation each computer's next Home message goes to (see `lib/home-thread`). */
  byServer: Record<string, HomeThreadTarget>;
  target: (target: HomeThreadTarget) => void;
  /** Replaces the computer's target only while it is still `current` (a resolved task, new pills). */
  update: (current: HomeThreadTarget, next: HomeThreadTarget) => void;
  /** The reader cleared it, or the conversation ended. */
  clear: (serverId: string, only?: HomeThreadTarget) => void;
  keepOnly: (serverIds: readonly string[]) => void;
};

export const useHomeThreads = create<HomeThreadState>((set, get) => ({
  byServer: load(),
  target(target) {
    const byServer = { ...get().byServer, [target.serverId]: target };
    set({ byServer });
    save(byServer);
  },
  update(current, next) {
    if (get().byServer[current.serverId] !== current) return;
    const byServer = { ...get().byServer, [current.serverId]: next };
    set({ byServer });
    save(byServer);
  },
  clear(serverId, only) {
    const existing = get().byServer[serverId];
    if (!existing || (only && existing !== only)) return;
    const { [serverId]: _cleared, ...byServer } = get().byServer;
    set({ byServer });
    save(byServer);
  },
  keepOnly(serverIds) {
    const kept = new Set(serverIds);
    const current = get().byServer;
    const byServer = keepKeys(current, (serverId) => kept.has(serverId));
    if (byServer === current) return;
    set({ byServer });
    save(byServer);
  },
}));

type HomeThreadLiveState = {
  /** `homeThreadKey` of the conversation `live` describes. */
  key: string | null;
  live: HomeThreadLive;
  /** A read answered that the session does not exist. */
  notFound: boolean;
  publish: (key: string, live: HomeThreadLive) => void;
  markNotFound: (key: string) => void;
  reset: (key: string | null) => void;
};

/**
 * What the strip shows of the target, as its feed last read it. Memory only,
 * and one conversation at a time: the strip subscribes to it narrowly, so a
 * streamed reply re-renders the strip and not Home.
 */
export const useHomeThreadLive = create<HomeThreadLiveState>((set, get) => ({
  key: null,
  live: EMPTY_HOME_THREAD_LIVE,
  notFound: false,
  publish(key, live) {
    if (get().key !== key) return;
    set({ live });
  },
  markNotFound(key) {
    if (get().key !== key) return;
    set({ notFound: true });
  },
  reset(key) {
    if (get().key === key) return;
    set({ key, live: EMPTY_HOME_THREAD_LIVE, notFound: false });
  },
}));
