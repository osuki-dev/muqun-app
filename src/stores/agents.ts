import { createMMKV } from 'react-native-mmkv';
import { create } from 'zustand';

import {
  DEFAULT_AGENT_ID,
  agentFeaturesFor,
  emptyAgentsMirror,
  lastUsedAgent,
  mirrorDiscovery,
  normalizeAgentId,
  parseAgentsMirrorIndex,
  selectHomeAgents,
  selectedAgentFor,
  serializeAgentsMirrorIndex,
  serverOffersAgentChoice,
  withMirroredDiscovery,
  type AgentFeatures,
  type AgentsMirrorIndex,
  type HomeAgentEntry,
  type MirroredServerDiscovery,
} from '@/lib/agent-discovery';
import type { GatewayDiscovery } from '@/lib/agent-protocol';

/**
 * What every paired gateway said in `GET /api/discovery`, the last time the
 * app asked -- and which agent the reader wants on each.
 *
 * A mirror, on the model of `server-capabilities.ts`: the screen that opens a
 * server writes the answer down, Home and the workbench read it back, and a
 * server this device has never opened offers nothing. The pick and the
 * last-used agent ride in the same document because they are read at the
 * same moment, when a session is about to be created.
 *
 * MMKV rather than the keychain: nothing here is a secret (endpoints and
 * versions are dropped before writing; see `mirrorDiscovery`), and the
 * workbench wants the pick synchronously on its first render. The store still
 * works when the native module is missing from an older binary -- the memory
 * then lasts one launch, as `agent-model-memory.ts` does.
 */
const STORE_ID = 'muqun.agents';
const INDEX_KEY = 'index.v1';

type KeyValueStore = {
  getString: (key: string) => string | undefined;
  set: (key: string, value: string) => void;
};

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

let storageInstance: KeyValueStore | null = null;
function storage(): KeyValueStore {
  if (!storageInstance) storageInstance = openStore();
  return storageInstance;
}

function restore(): AgentsMirrorIndex {
  try {
    return parseAgentsMirrorIndex(storage().getString(INDEX_KEY));
  } catch {
    return emptyAgentsMirror();
  }
}

function save(index: AgentsMirrorIndex): void {
  try {
    storage().set(INDEX_KEY, serializeAgentsMirrorIndex(index));
  } catch {
    // Memory remains authoritative for this launch; the next answer writes again.
  }
}

interface AgentsState {
  index: AgentsMirrorIndex;
  /** Writes down what `GET /api/discovery` just said for one server. */
  record: (serverId: string, discovery: GatewayDiscovery, nowMs?: number) => void;
  /** The reader's own pick for new sessions on one server. */
  select: (serverId: string, agentId: string) => void;
  /** Noted when a session is created, whichever way the agent was chosen. */
  markUsed: (serverId: string, agentId: string) => void;
  /** Drops everything; for a test and for the day the last server is unpaired. */
  forgetAll: () => void;
}

export const useAgents = create<AgentsState>((set) => ({
  index: restore(),

  record(serverId, discovery, nowMs = Date.now()) {
    if (!serverId) return;
    set((state) => {
      const mirrored: MirroredServerDiscovery = mirrorDiscovery(discovery, nowMs);
      const index = withMirroredDiscovery(state.index, serverId, mirrored);
      save(index);
      return { index };
    });
  },

  select(serverId, agentId) {
    if (!serverId) return;
    set((state) => {
      const id = normalizeAgentId(agentId);
      if (state.index.selected[serverId] === id) return state;
      const index = { ...state.index, selected: { ...state.index.selected, [serverId]: id } };
      save(index);
      return { index };
    });
  },

  markUsed(serverId, agentId) {
    if (!serverId) return;
    set((state) => {
      const id = normalizeAgentId(agentId);
      if (state.index.lastUsed[serverId] === id) return state;
      const index = { ...state.index, lastUsed: { ...state.index.lastUsed, [serverId]: id } };
      save(index);
      return { index };
    });
  },

  forgetAll() {
    const index = emptyAgentsMirror();
    save(index);
    set({ index });
  },
}));

// ---------------------------------------------------------------------------
// Selectors over the store, for hooks and for callers outside React
// ---------------------------------------------------------------------------

/** The mirrored discovery of one server, or `undefined` for one never asked. */
export function mirroredDiscoveryFor(serverId: string): MirroredServerDiscovery | undefined {
  return useAgents.getState().index.servers[serverId];
}

/** The agent a new session on `serverId` goes to right now. */
export function selectedAgentOn(serverId: string): string {
  return serverId ? selectedAgentFor(useAgents.getState().index, serverId) : DEFAULT_AGENT_ID;
}

/** Whether a new-session path on `serverId` has more than one ready agent to offer. */
export function offersAgentChoiceOn(serverId: string): boolean {
  return serverId ? serverOffersAgentChoice(useAgents.getState().index, serverId) : false;
}

/** Whether `serverId` has ever answered discovery with an agents plane. */
export function hasAgentsDiscoveryFor(serverId: string): boolean {
  return Boolean(mirroredDiscoveryFor(serverId)?.agents);
}

/** What `agentId` can do on `serverId`; the kind's default when nobody has said. */
export function agentFeaturesOn(
  serverId: string,
  agentId: string | undefined | null
): AgentFeatures {
  return agentFeaturesFor(mirroredDiscoveryFor(serverId)?.agents?.agents, agentId);
}

/** Home's rows for one server: every agent in gateway order, with its readiness. */
export function homeAgentsFor(serverId: string): HomeAgentEntry[] {
  return selectHomeAgents(useAgents.getState().index, serverId);
}

export function lastUsedAgentOn(serverId: string): string | undefined {
  return lastUsedAgent(useAgents.getState().index, serverId);
}
