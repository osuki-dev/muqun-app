import { useEffect, useState } from 'react';

import { taskRouteFor } from '@/hooks/use-server-tasks';
import type { AgentProfile } from '@/lib/agent-spawn';
import { loadAgentProfiles, type GatewayEndpoint } from '@/lib/gateway-client';
import { useHomeAgentChoice } from '@/stores/home-agent-choice';

/** How long a failed catalog read waits before asking again while someone is looking. */
const RETRY_MS = 15_000;

const inFlight = new Map<string, Promise<AgentProfile[] | null>>();

/**
 * Read a computer's terminal-agent catalog (`GET /api/agents/catalog`) and
 * keep it for this launch: the selected computer through the shared client,
 * any other paired computer through its own stored address, as its task list
 * is read. `null` when it could not be read (or the computer is reached only
 * through an SSH tunnel it does not hold). One read per computer at a time.
 */
export function loadTerminalCatalog(serverId: string): Promise<AgentProfile[] | null> {
  const running = inFlight.get(serverId);
  if (running) return running;
  const route = taskRouteFor(serverId);
  if (!route) return Promise.resolve(null);
  const endpoint = route.kind === 'endpoint' ? (route.endpoint as GatewayEndpoint) : undefined;
  const read = loadAgentProfiles(endpoint)
    .then((profiles): AgentProfile[] | null => {
      useHomeAgentChoice.getState().recordTerminal(serverId, profiles);
      return profiles;
    })
    .catch((): AgentProfile[] | null => null)
    .then((answer) => {
      inFlight.delete(serverId);
      return answer;
    });
  inFlight.set(serverId, read);
  return read;
}

/**
 * The terminal agents a computer has installed, as last read this launch;
 * `undefined` until the first answer. A failed read is asked again every
 * 15 s while the caller is mounted and enabled.
 */
export function useTerminalAgentCatalog(
  serverId: string | undefined,
  enabled = true
): AgentProfile[] | undefined {
  const known = useHomeAgentChoice((state) =>
    serverId ? state.terminalByServer[serverId] : undefined
  );
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled || !serverId || known) return;
    let current = true;
    let retry: ReturnType<typeof setTimeout> | null = null;
    void loadTerminalCatalog(serverId).then((profiles) => {
      if (!current || profiles) return;
      retry = setTimeout(() => setAttempt((count) => count + 1), RETRY_MS);
    });
    return () => {
      current = false;
      if (retry) clearTimeout(retry);
    };
  }, [enabled, serverId, known, attempt]);
  return known;
}
