import { create } from 'zustand';

import type { AgentProject } from '@/lib/agent-session';
import type { SwipeableSession } from '@/lib/session-swipe';

/**
 * The agent screen's header-facing session state, shared with the workbench.
 *
 * The workbench owns the session machinery (stream, polling, permission
 * handling); the header needs only the run state, the live title and the
 * workspace. Writing those into this store instead of handing them to the
 * parent through prop callbacks in effects lets both sides read the same
 * value without the extra render the callback round-trip costs.
 *
 * Swiping the title pill added a fourth thing to share, and it is the reason
 * `switchSession` is a function kept in a store rather than another imperative
 * ref beside `createNewSessionRef`. The pill has to know *where* it can go
 * before the finger lands -- the edge marks and the gesture's own enabled state
 * are both drawn from the strip's order -- and that is data the header renders,
 * not a command it issues. Order and handler travel together because they must
 * agree: committing to an asid the order no longer holds is the one way this
 * can go wrong.
 */
interface AgentSessionState {
  running: boolean;
  title?: string;
  directory?: string;
  project?: AgentProject;
  /**
   * The sessions the composer's strip draws, in the order it draws them: this
   * workspace's roots, with the open root's subagents folded in where the strip
   * shows them. The header pill swipes along exactly this list, so a chip and a
   * swipe can never disagree about what "next" means.
   */
  sessionOrder: readonly SwipeableSession[];
  activeAsid?: string;
  /**
   * Whether the workbench is loading a session's snapshot. A swipe is still
   * allowed to *start* during one -- the gesture is about the reader's
   * intention, not the screen's progress -- but a commit lands on a screen that
   * is already fetching, so it is dropped rather than queued behind it.
   */
  switching: boolean;
  /**
   * The strip's own handler, so a committed swipe is the same act as tapping a
   * chip: one selection change, and the header, the strip, the snapshot load
   * and the stream all follow it as they already do.
   */
  switchSession?: (asid: string) => void;
  setSessionStatus: (state: { running: boolean; title?: string }) => void;
  setWorkspace: (directory?: string, project?: AgentProject) => void;
  setSessionRouting: (routing: {
    sessionOrder: readonly SwipeableSession[];
    activeAsid?: string;
    switching: boolean;
    switchSession: (asid: string) => void;
  }) => void;
}

const NO_SESSIONS: readonly SwipeableSession[] = [];

export const useAgentSessionState = create<AgentSessionState>((set) => ({
  running: false,
  title: undefined,
  directory: undefined,
  project: undefined,
  sessionOrder: NO_SESSIONS,
  activeAsid: undefined,
  switching: false,
  switchSession: undefined,
  setSessionStatus: (state) => set({ running: state.running, title: state.title }),
  setWorkspace: (directory, project) => set({ directory, project }),
  setSessionRouting: (routing) =>
    set({
      sessionOrder: routing.sessionOrder,
      activeAsid: routing.activeAsid,
      switching: routing.switching,
      switchSession: routing.switchSession,
    }),
}));
