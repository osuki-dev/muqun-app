import { createMMKV } from 'react-native-mmkv';
import { create } from 'zustand';

import { keepKeys } from '@/lib/keep-keys';
import {
  EMPTY_HOME_THREAD_LIVE,
  homeThreadEndOutcome,
  homeThreadTapped,
  parseHomeThreads,
  type HomeThreadTap,
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
  /** Per computer, what a card tap replaced (`homeThreadEndOutcome`). Memory only. */
  taps: Record<string, HomeThreadTap>;
  target: (target: HomeThreadTarget) => void;
  /** A card tap: the target, remembering the one it replaced. */
  tap: (target: HomeThreadTarget) => void;
  /** Replaces the computer's target only while it is still `current` (a resolved task, new pills). */
  update: (current: HomeThreadTarget, next: HomeThreadTarget) => void;
  /** The reader cleared it. */
  clear: (serverId: string, only?: HomeThreadTarget) => void;
  /**
   * `target`'s conversation ended: a tap nothing was sent to is undone,
   * anything else goes. `'untapped'` when a tap was undone; `null` when
   * `target` was not the computer's target.
   */
  end: (target: HomeThreadTarget) => 'untapped' | 'ended' | null;
  keepOnly: (serverIds: readonly string[]) => void;
};

export const useHomeThreads = create<HomeThreadState>((set, get) => {
  const write = (serverId: string, next: HomeThreadTarget | null, tap?: HomeThreadTap) => {
    const { [serverId]: _target, ...others } = get().byServer;
    const { [serverId]: _tap, ...otherTaps } = get().taps;
    const byServer = next ? { ...others, [serverId]: next } : others;
    set({ byServer, taps: tap ? { ...otherTaps, [serverId]: tap } : otherTaps });
    save(byServer);
  };
  return {
    byServer: load(),
    taps: {},
    target(target) {
      write(target.serverId, target);
    },
    tap(target) {
      const { serverId } = target;
      write(
        serverId,
        target,
        homeThreadTapped(get().byServer[serverId], get().taps[serverId], target)
      );
    },
    update(current, next) {
      const { serverId } = current;
      if (get().byServer[serverId] !== current) return;
      const tap = get().taps[serverId];
      // Once a message went to a tapped target, the tap stands.
      write(
        serverId,
        next,
        tap?.tapped === current && !next.lastSent ? { ...tap, tapped: next } : undefined
      );
    },
    clear(serverId, only) {
      const existing = get().byServer[serverId];
      if (!existing || (only && existing !== only)) return;
      write(serverId, null);
    },
    end(target) {
      const { serverId } = target;
      if (get().byServer[serverId] !== target) return null;
      const outcome = homeThreadEndOutcome(target, get().taps[serverId]);
      write(serverId, outcome.next);
      return outcome.untapped ? 'untapped' : 'ended';
    },
    keepOnly(serverIds) {
      const kept = new Set(serverIds);
      const current = get().byServer;
      const byServer = keepKeys(current, (serverId) => kept.has(serverId));
      if (byServer === current) return;
      set({ byServer, taps: keepKeys(get().taps, (serverId) => kept.has(serverId)) });
      save(byServer);
    },
  };
});

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
