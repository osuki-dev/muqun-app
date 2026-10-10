import { createMMKV } from 'react-native-mmkv';
import { create } from 'zustand';

import type { AgentProfile } from '@/lib/agent-spawn';
import { parseHomeAgentChoices } from '@/lib/home-agent-choice';
import { keepKeys } from '@/lib/keep-keys';
import type { ModelRef } from '@/lib/agent-session';
import type { RememberedAgentChoice } from '@/lib/agent-session-defaults';
import {
  homeFolderPick,
  homeModelChoiceKey,
  keepHomeModelChoices,
  parseHomeFolders,
  parseHomeModelChoices,
} from '@/lib/home-composer';

type KeyValueStore = {
  getString: (key: string) => string | undefined;
  set: (key: string, value: string) => void;
};

const STORE_ID = 'muqun.home';
const CHOICES_KEY = 'muqun.home.agent-choice.v1';
const FOLDERS_KEY = 'muqun.home.folder.v1';
const MODELS_KEY = 'muqun.home.model.v1';

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
   * the dock's bar, `~` for the home directory picked on purpose. Absent
   * means nothing picked: no folder is sent, and the gateway uses the
   * device's last one.
   */
  folderByServer: Record<string, string>;
  /**
   * The mode and model last picked on the dock, per computer and agent
   * (`homeModelChoiceKey`). Absent: nothing picked, the agent's own default.
   */
  modelChoice: Record<string, RememberedAgentChoice>;
  choose: (serverId: string, key: string) => void;
  chooseModel: (serverId: string, agentId: string | undefined, model: ModelRef) => void;
  /** A mode that names its own model brings it: the model pick is dropped. */
  chooseMode: (serverId: string, agentId: string | undefined, mode: string) => void;
  /** Set (or, with a blank answer, clear) a computer's folder from a picker answer. */
  chooseFolder: (serverId: string, directory: string) => void;
  recordTerminal: (serverId: string, profiles: AgentProfile[]) => void;
  /** Forgets the folder and model picks of every computer not in `serverIds` (unpaired). */
  keepOnly: (serverIds: readonly string[]) => void;
};

function load<T>(key: string, parse: (value: string | undefined) => Record<string, T>) {
  try {
    return parse(store().getString(key));
  } catch {
    return {};
  }
}

function save(key: string, value: Record<string, unknown>) {
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
  modelChoice: load(MODELS_KEY, parseHomeModelChoices),
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
  chooseModel(serverId, agentId, model) {
    const key = homeModelChoiceKey(serverId, agentId);
    const current = get().modelChoice;
    const modelChoice = { ...current, [key]: { ...current[key], model } };
    set({ modelChoice });
    save(MODELS_KEY, modelChoice);
  },
  chooseMode(serverId, agentId, mode) {
    const modelChoice = { ...get().modelChoice, [homeModelChoiceKey(serverId, agentId)]: { mode } };
    set({ modelChoice });
    save(MODELS_KEY, modelChoice);
  },
  keepOnly(serverIds) {
    const kept = new Set(serverIds);
    const { folderByServer, modelChoice } = get();
    const folders = keepKeys(folderByServer, (serverId) => kept.has(serverId));
    const models = keepHomeModelChoices(modelChoice, serverIds);
    if (folders !== folderByServer) save(FOLDERS_KEY, folders);
    if (models !== modelChoice) save(MODELS_KEY, models);
    if (folders !== folderByServer || models !== modelChoice) {
      set({ folderByServer: folders, modelChoice: models });
    }
  },
  recordTerminal(serverId, profiles) {
    set((state) => ({ terminalByServer: { ...state.terminalByServer, [serverId]: profiles } }));
  },
}));
