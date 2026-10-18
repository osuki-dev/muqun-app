import { create } from 'zustand';

import type { GatewayAgentSessionsSnapshot } from '@/lib/home-continue';

/**
 * The agent sessions each gateway last listed for Continue.
 *
 * Memory only: the gateway is the source, a cold start shows the device's own
 * recents until the first read answers, and nothing here is worth a write.
 */
interface HomeAgentSessionsState {
  byServer: Readonly<Record<string, GatewayAgentSessionsSnapshot>>;
  /**
   * When each gateway's list was last read back unchanged. Kept beside
   * `byServer` so a read that changes nothing but the time leaves the list --
   * and everything built from it -- alone; the rows' "Seen" age reads it.
   */
  seenAtMs: Readonly<Record<string, number>>;
  record: (snapshot: GatewayAgentSessionsSnapshot) => void;
}

export const useHomeAgentSessions = create<HomeAgentSessionsState>((set, get) => ({
  byServer: {},
  seenAtMs: {},
  record(snapshot) {
    const previous = get().byServer[snapshot.serverId];
    if (previous && sameAgentSessions(previous, snapshot)) {
      const seen = get().seenAtMs[snapshot.serverId] ?? previous.observedAtMs;
      if (snapshot.observedAtMs > seen) {
        set((state) => ({
          seenAtMs: { ...state.seenAtMs, [snapshot.serverId]: snapshot.observedAtMs },
        }));
      }
      return;
    }
    set((state) => ({ byServer: { ...state.byServer, [snapshot.serverId]: snapshot } }));
  },
}));

function sameAgentSessions(
  left: GatewayAgentSessionsSnapshot,
  right: GatewayAgentSessionsSnapshot
): boolean {
  return (
    left.sessionId === right.sessionId &&
    left.sessions.length === right.sessions.length &&
    left.sessions.every((session, index) => {
      const other = right.sessions[index];
      return (
        session.asid === other.asid &&
        session.agentId === other.agentId &&
        session.title === other.title &&
        session.directory === other.directory &&
        session.status === other.status &&
        session.updatedMs === other.updatedMs &&
        session.terminal?.sessionId === other.terminal?.sessionId &&
        session.terminal?.paneId === other.terminal?.paneId
      );
    })
  );
}
