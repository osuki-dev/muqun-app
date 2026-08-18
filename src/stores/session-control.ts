import { create } from 'zustand';

import {
  gatewayTransport,
  type HealthResponse,
  type HerdrEntity,
  type SessionsResponse,
} from '@/lib/gateway-client';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';

export interface SessionControlState {
  workspaces: HerdrEntity[];
  tabs: HerdrEntity[];
  panes: HerdrEntity[];
  agents: HerdrEntity[];
  selectedWorkspaceId: string;
  selectedTabId: string;
  selectedPaneId: string;
  selectedAgentTarget: string;
  paneOutput: string;
  detailJson: string;
}

interface SessionControlStore {
  busy: boolean;
  statusMessage: string | null;
  health: HealthResponse | null;
  sessions: SessionsResponse | null;
  selectedSessionId: string;
  bySession: Record<string, SessionControlState>;
  refresh: () => Promise<void>;
  reset: () => void;
  setBusy: (busy: boolean) => void;
  setStatusMessage: (message: string | null) => void;
  selectWorkspace: (sessionId: string, id: string) => void;
  selectTab: (sessionId: string, id: string) => void;
  selectPane: (sessionId: string, id: string) => void;
  selectAgent: (sessionId: string, id: string) => void;
  setPaneOutput: (sessionId: string, output: string) => void;
  setDetailJson: (sessionId: string, json: string) => void;
}

const emptySessionState: SessionControlState = {
  workspaces: [],
  tabs: [],
  panes: [],
  agents: [],
  selectedWorkspaceId: '',
  selectedTabId: '',
  selectedPaneId: '',
  selectedAgentTarget: '',
  paneOutput: '',
  detailJson: '',
};

function getSessionState(state: SessionControlStore, sessionId: string): SessionControlState {
  return state.bySession[sessionId] ?? emptySessionState;
}

function updateSession(
  state: SessionControlStore,
  sessionId: string,
  update: Partial<SessionControlState>
): Record<string, SessionControlState> {
  return {
    ...state.bySession,
    [sessionId]: {
      ...getSessionState(state, sessionId),
      ...update,
    },
  };
}

function firstId(items: HerdrEntity[]): string {
  return items[0]?.id ?? '';
}

export const useSessionControlStore = create<SessionControlStore>((set, get) => ({
  busy: false,
  statusMessage: null,
  health: null,
  sessions: null,
  selectedSessionId: 'default',
  bySession: {},

  async refresh() {
    const record = useGatewayConnectionStore.getState().record;
    const { selectedSessionId } = get();
    if (!record) return;
    set({ busy: true, statusMessage: null });
    try {
      const [health, sessions] = await Promise.all([
        gatewayTransport.loadHealth(),
        gatewayTransport.loadSessions(),
      ]);
      const sessionId = sessions.sessions?.[0]?.id ?? selectedSessionId;
      const [workspaces, tabs, panes, agents] = await Promise.all([
        gatewayTransport.loadWorkspaces(sessionId),
        gatewayTransport.loadTabs(sessionId),
        gatewayTransport.loadPanes(sessionId),
        gatewayTransport.loadAgents(sessionId),
      ]);
      const currentSession = getSessionState(get(), sessionId);
      set((state) => ({
        health,
        sessions,
        selectedSessionId: sessionId,
        bySession: updateSession(state, sessionId, {
          workspaces,
          tabs,
          panes,
          agents,
          selectedWorkspaceId: currentSession.selectedWorkspaceId || firstId(workspaces),
          selectedTabId: currentSession.selectedTabId || firstId(tabs),
          selectedPaneId: currentSession.selectedPaneId || firstId(panes),
          selectedAgentTarget: currentSession.selectedAgentTarget || firstId(agents),
        }),
      }));
    } catch (err) {
      set({
        health: null,
        sessions: null,
        statusMessage: err instanceof Error ? err.message : 'Gateway is unreachable.',
      });
    } finally {
      set({ busy: false });
    }
  },

  reset() {
    set({
      busy: false,
      statusMessage: null,
      health: null,
      sessions: null,
      selectedSessionId: 'default',
      bySession: {},
    });
  },

  setBusy(busy) {
    set({ busy });
  },

  setStatusMessage(statusMessage) {
    set({ statusMessage });
  },

  selectWorkspace(sessionId, id) {
    set((state) => ({ bySession: updateSession(state, sessionId, { selectedWorkspaceId: id }) }));
  },

  selectTab(sessionId, id) {
    set((state) => ({ bySession: updateSession(state, sessionId, { selectedTabId: id }) }));
  },

  selectPane(sessionId, id) {
    set((state) => ({ bySession: updateSession(state, sessionId, { selectedPaneId: id }) }));
  },

  selectAgent(sessionId, id) {
    set((state) => ({ bySession: updateSession(state, sessionId, { selectedAgentTarget: id }) }));
  },

  setPaneOutput(sessionId, output) {
    set((state) => ({ bySession: updateSession(state, sessionId, { paneOutput: output }) }));
  },

  setDetailJson(sessionId, json) {
    set((state) => ({ bySession: updateSession(state, sessionId, { detailJson: json }) }));
  },
}));

export function selectCurrentSessionState(state: SessionControlStore): SessionControlState {
  return getSessionState(state, state.selectedSessionId);
}
