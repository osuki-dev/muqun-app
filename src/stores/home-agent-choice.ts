import { createMMKV } from 'react-native-mmkv';
import { create } from 'zustand';

import type { AgentProfile } from '@/lib/agent-spawn';
import { parseHomeAgentChoices } from '@/lib/home-agent-choice';
import { homeFolderPick, parseHomeFolders } from '@/lib/home-composer';

type KeyValueStore = {
  getString: (key: string) => string | undefined;
  set: (key: string, value: string) => void;
};

const STORE_ID = 'muqun.home';
const CHOICES_KEY = 'muqun.home.agent-choice.v1';
const FOLDERS_KEY = 'muqun.home.folder.v1';

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
  /**
   * The folder Home's goals start in, per computer: the one last picked on
   * the dock's bar. Absent means the agent's own default (`~`).
   */
  folderByServer: Record<string, string>;
  choose: (serverId: string, key: string) => void;
  /** Set (or, with `~`, clear) a computer's folder from a picker answer. */
  chooseFolder: (serverId: string, directory: string) => void;
  recordTerminal: (serverId: string, profiles: AgentProfile[]) => void;
};

function load(key: string, parse: (value: string | undefined) => Record<string, string>) {
  try {
    return parse(store().getString(key));
  } catch {
    return {};
  }
}

function save(key: string, value: Record<string, string>) {
  try {
    store().set(key, JSON.stringify(value));
  } catch {
    // Kept in memory for this launch.
  }
}

/** The reader's Home agent per computer (Settings → Computers, or the dock's bar). */
export const useHomeAgentChoice = create<HomeAgentChoiceState>((set, get) => ({
  byServer: load(CHOICES_KEY, parseHomeAgentChoices),
  terminalByServer: {},
  folderByServer: load(FOLDERS_KEY, parseHomeFolders),
  choose(serverId, key) {
    const byServer = { ...get().byServer, [serverId]: key };
    set({ byServer });
    save(CHOICES_KEY, byServer);
  },
  chooseFolder(serverId, directory) {
    const { [serverId]: _previous, ...others } = get().folderByServer;
    const folder = homeFolderPick(directory);
    const folderByServer = folder ? { ...others, [serverId]: folder } : others;
    set({ folderByServer });
    save(FOLDERS_KEY, folderByServer);
  },
  recordTerminal(serverId, profiles) {
    set((state) => ({ terminalByServer: { ...state.terminalByServer, [serverId]: profiles } }));
  },
}));
