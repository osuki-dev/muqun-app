import { useSyncExternalStore } from 'react';

import {
  agentChoiceMemoryRevision,
  loadRememberedAgentDefaults,
  subscribeAgentChoiceMemory,
} from '@/lib/agent-model-memory';
import type { RememberedAgentDefaults } from '@/lib/agent-session-defaults';

/** Snapshots of the current revision, per place; emptied when the memory changes. */
let cachedRevision = -1;
const cached = new Map<string, RememberedAgentDefaults>();

/**
 * The model and mode remembered for one computer, agent and folder -- the one
 * memory Home's pills and a session screen both read and write -- kept current
 * when a pick is made anywhere in the app.
 */
export function useRememberedAgentDefaults(
  serverId: string | undefined,
  directory: string | undefined,
  agentId: string | undefined
): RememberedAgentDefaults {
  return useSyncExternalStore(subscribeAgentChoiceMemory, () => {
    if (cachedRevision !== agentChoiceMemoryRevision()) {
      cachedRevision = agentChoiceMemoryRevision();
      cached.clear();
    }
    const key = JSON.stringify([serverId, directory, agentId]);
    let value = cached.get(key);
    if (!value) {
      value = loadRememberedAgentDefaults(serverId ?? '', directory, agentId);
      cached.set(key, value);
    }
    return value;
  });
}
