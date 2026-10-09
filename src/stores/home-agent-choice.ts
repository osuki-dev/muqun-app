import { createMMKV } from 'react-native-mmkv';
import { create } from 'zustand';

import type { AgentProfile } from '@/lib/agent-spawn';
import { parseHomeAgentChoices } from '@/lib/home-agent-choice';

type KeyValueStore = {
  getString: (key: string) => string | undefined;
  set: (key: string, value: string) => void;
};

const STORE_ID = 'muqun.home';
const CHOICES_KEY = 'muqun.home.agent-choice.v1';

/**
 * MMKV, read synchronously so the dock's first frame already names the
 * chosen agent. An OTA bundle on a binary without the module keeps the
 * choice for the launch only, the fallback `launch-intro-seen` uses.
 */
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

type HomeAgentChoiceState = {
  /** `{ [serverId]: 'session:<agentId>' | 'terminal:<kind>' }`. */
  byServer: Record<string, string>;
  /**
   * The terminal agents each computer's catalog last listed, this launch only:
   * what is installed is asked again when it matters.
   */
  terminalByServer: Record<string, AgentProfile[]>;
  choose: (serverId: string, key: string) => void;
  recordTerminal: (serverId: string, profiles: AgentProfile[]) => void;
};

function loadChoices(): Record<string, string> {
  try {
    return parseHomeAgentChoices(store().getString(CHOICES_KEY));
  } catch {
    return {};
  }
}

/** The reader's Home agent per computer (Settings → Computers, or the dock's bar). */
export const useHomeAgentChoice = create<HomeAgentChoiceState>((set, get) => ({
  byServer: loadChoices(),
  terminalByServer: {},
  choose(serverId, key) {
    const byServer = { ...get().byServer, [serverId]: key };
    set({ byServer });
    try {
      store().set(CHOICES_KEY, JSON.stringify(byServer));
    } catch {
      // Kept in memory for this launch.
    }
  },
  recordTerminal(serverId, profiles) {
    set((state) => ({ terminalByServer: { ...state.terminalByServer, [serverId]: profiles } }));
  },
}));
