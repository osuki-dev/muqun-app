import { create } from 'zustand';

import type { AgentProject } from '@/lib/agent-session';

/**
 * The agent screen's header-facing session state, shared with the workbench.
 *
 * The workbench owns the session machinery (stream, polling, permission
 * handling); the header needs only the run state, the live title and the
 * workspace. Writing those into this store instead of handing them to the
 * parent through prop callbacks in effects lets both sides read the same
 * value without the extra render the callback round-trip costs.
 */
interface AgentSessionState {
  running: boolean;
  title?: string;
  directory?: string;
  project?: AgentProject;
  setSessionStatus: (state: { running: boolean; title?: string }) => void;
  setWorkspace: (directory?: string, project?: AgentProject) => void;
}

export const useAgentSessionState = create<AgentSessionState>((set) => ({
  running: false,
  title: undefined,
  directory: undefined,
  project: undefined,
  setSessionStatus: (state) => set({ running: state.running, title: state.title }),
  setWorkspace: (directory, project) => set({ directory, project }),
}));
