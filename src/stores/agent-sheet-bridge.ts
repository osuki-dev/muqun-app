import { create } from 'zustand';

import type {
  AgentProject,
  AgentSessionInfo,
  ModelRef,
  TodoItem,
  TokensUsage,
} from '@/lib/agent-session';

/**
 * What the agent's sheets read, and what they call, now that they are routes.
 *
 * The six pickers on the agent screen used to be `<Modal>`s rendered inside
 * `AgentWorkbench`, so they could be handed the session list and a callback as
 * props. They are native `formSheet` routes now -- which is what gives them
 * the app's one sheet ground, the hardware back button and a real dismissal
 * gesture -- and a route is mounted by the navigator, not by the workbench.
 * There is nowhere to pass a prop through.
 *
 * So the workbench publishes what a sheet needs here, and registers the
 * handlers it owns. This is the same shape as `stores/panel-picker.ts`, one
 * step further: that store carries a choice back from a sheet, this one also
 * carries the state forward into it.
 *
 * Route params still carry *identity* -- which gateway session, which agent
 * session -- because that is the part a deep link has to be able to state.
 * What is in here is the part that changes while the sheet is open.
 */
export interface AgentSheetSnapshot {
  /** The gateway session every agent call is made against. */
  sessionId: string;
  /** The agent session the workbench is showing, if it has one. */
  activeAsid?: string;
  sessions: readonly AgentSessionInfo[];
  knownProjects: readonly AgentProject[];
  activeDirectory?: string;
  sessionInfo?: AgentSessionInfo;
  tokens?: TokensUsage;
  cost?: number;
  selectedModel?: ModelRef;
  selectedAgent?: string;
  showReasoning: boolean;
  yoloMode: boolean;
  todos: readonly TodoItem[];
}

/**
 * The handlers the workbench owns.
 *
 * Every one of them is a no-op by default and stays callable: a sheet route
 * can be reached by a deep link with no workbench mounted behind it, and a
 * picker whose button throws is worse than a picker that picks nothing.
 */
export interface AgentSheetActions {
  selectSession: (asid: string) => void;
  createSession: () => void;
  selectModel: (model: ModelRef) => void;
  selectAgentMode: (agent: string) => void;
  selectWorkspace: (directory: string, project?: AgentProject) => void;
  toggleReasoning: () => void;
  toggleYolo: () => void;
  compactContext: () => void;
  clearContext: () => void;
}

const NO_ACTIONS: AgentSheetActions = Object.freeze({
  selectSession: () => {},
  createSession: () => {},
  selectModel: () => {},
  selectAgentMode: () => {},
  selectWorkspace: () => {},
  toggleReasoning: () => {},
  toggleYolo: () => {},
  compactContext: () => {},
  clearContext: () => {},
});

const EMPTY_SESSIONS: readonly AgentSessionInfo[] = Object.freeze([]);
const EMPTY_PROJECTS: readonly AgentProject[] = Object.freeze([]);
const EMPTY_TODOS: readonly TodoItem[] = Object.freeze([]);

const INITIAL: AgentSheetSnapshot = {
  sessionId: '',
  activeAsid: undefined,
  sessions: EMPTY_SESSIONS,
  knownProjects: EMPTY_PROJECTS,
  activeDirectory: undefined,
  sessionInfo: undefined,
  tokens: undefined,
  cost: undefined,
  selectedModel: undefined,
  selectedAgent: undefined,
  showReasoning: true,
  yoloMode: false,
  todos: EMPTY_TODOS,
};

interface AgentSheetBridge extends AgentSheetSnapshot {
  actions: AgentSheetActions;
  /** Publish the parts that changed; an unchanged patch commits nothing. */
  publish: (patch: Partial<AgentSheetSnapshot>) => void;
  setActions: (actions: AgentSheetActions) => void;
  /** Back to the empty snapshot when the workbench goes away. */
  reset: () => void;
}

export const useAgentSheetBridge = create<AgentSheetBridge>((set, get) => ({
  ...INITIAL,
  actions: NO_ACTIONS,
  publish: (patch) => {
    const current = get();
    // The workbench publishes from an effect that re-runs on every stream
    // tick. Committing an identical snapshot would re-render every open sheet
    // for nothing, so the equal case never reaches `set`.
    let changed = false;
    for (const key of Object.keys(patch) as (keyof AgentSheetSnapshot)[]) {
      if (patch[key] !== current[key]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    set(patch);
  },
  setActions: (actions) => set({ actions }),
  reset: () => set({ ...INITIAL, actions: NO_ACTIONS }),
}));

export { EMPTY_TODOS };
