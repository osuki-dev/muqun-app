import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

import {
  parseServerSessionIndex,
  rememberServerSession,
  SERVER_SESSION_STORAGE_KEY,
  type ServerSessionIndex,
} from '@/lib/session-switcher';

/**
 * Which backend session the reader was last looking at on each server, and the
 * channel the switcher sheet hands a fresh choice back through.
 *
 * Two things in one store because they are two halves of the same answer: the
 * sheet is a route of its own and cannot return a value without pushing another
 * copy of the workspace (see `stores/panel-picker`), so it writes the pick here
 * for the workspace to pick up and clear -- and the same tap is what the next
 * visit should land on, so it is persisted in the same breath.
 *
 * Stored the way the last-viewed marks and the agent mirror are
 * (`stores/server-last-viewed`, `stores/server-agents`): a per-server index in
 * the keychain, hydrated once, written on change. Not because a session id is a
 * secret, but because it is read once per server visit inside an effect that is
 * already async, and one storage mechanism for per-server prefs is worth more
 * than a marginally faster read.
 */
type SessionPick = {
  serverId: string;
  sessionId: string;
};

type ServerSessionState = {
  hydrated: boolean;
  byServer: ServerSessionIndex;
  hydrate: () => Promise<void>;
  /** The pick the sheet just made, until the workspace has acted on it. */
  pick: SessionPick | null;
  /** Hands the choice to the workspace and records it for the next visit. */
  chooseSession: (pick: SessionPick) => void;
  clearPick: () => void;
  /** Records a choice without asking the workspace to move to it. */
  remember: (serverId: string, sessionId: string) => Promise<void>;
};

export const useServerSession = create<ServerSessionState>((set, get) => ({
  hydrated: false,
  byServer: {},
  pick: null,

  async hydrate() {
    if (get().hydrated) return;
    // Claimed before the read so two screens mounting together cannot both
    // start one, and a second call cannot clobber a choice that raced it.
    set({ hydrated: true });
    const stored = await loadIndex();
    // Anything written during the read wins: it is a tap that already happened,
    // and the stored copy describes the last launch.
    set((state) => ({ byServer: { ...stored, ...state.byServer } }));
  },

  chooseSession(pick) {
    // The pick lands synchronously so the workspace can act on this tap, and
    // the keychain write follows on its own time.
    set({ pick });
    void get().remember(pick.serverId, pick.sessionId);
  },

  clearPick() {
    if (get().pick) set({ pick: null });
  },

  async remember(serverId, sessionId) {
    // Hydrated first, always: writing an index built from an empty map would
    // persist this server's choice by erasing every other server's.
    await get().hydrate();
    const previous = get().byServer;
    const byServer = rememberServerSession(previous, serverId, sessionId);
    if (byServer === previous) return;
    set({ byServer });
    await saveIndex(byServer);
  },
}));

async function loadIndex(): Promise<ServerSessionIndex> {
  try {
    const value = await SecureStore.getItemAsync(SERVER_SESSION_STORAGE_KEY);
    return value ? parseServerSessionIndex(value) : {};
  } catch {
    // No memory means the gateway's first session, which is where the app went
    // before it remembered anything. There is nothing to tell the user.
    return {};
  }
}

async function saveIndex(index: ServerSessionIndex): Promise<void> {
  try {
    await SecureStore.setItemAsync(SERVER_SESSION_STORAGE_KEY, JSON.stringify(index), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } catch {
    // The in-memory choice still drives the rest of this launch; the only
    // casualty is that a relaunch opens the gateway's first session again.
  }
}
