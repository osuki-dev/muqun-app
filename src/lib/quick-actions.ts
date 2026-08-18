/**
 * What the quick actions sheet offers, decided once from the route's params.
 *
 * The sheet is reached two ways and they are not the same screen. From a pane's
 * lightning button it arrives holding a session, a pane and a server, and it may
 * offer every row. From Settings it arrives holding none of them, because there
 * is no pane to act on -- so it is the shortcut list and nothing else.
 *
 * These five answers used to be five expressions inside the component, each
 * repeating a piece of the one before it, and the interesting part -- that Stop
 * needs four separate facts to be true at once -- was spread across a boolean
 * chain nothing could test. They are here so that "which rows exist" is a
 * question with one answer and a test, and so the screen reads as a list of
 * rows rather than as a list of conditions.
 */
import { agentIsInterruptible } from '@/lib/agent-spawn';

export interface QuickActionParams {
  /** Present only when the sheet was opened over a live pane. */
  sessionId?: string;
  paneId?: string;
  serverId?: string;
  /** Whether this gateway said it can start and stop an agent. */
  spawnSupported: boolean;
  /** Whether opening a plain URL on the machine behind the pane is honest. */
  webServiceSupported: boolean;
  /** This pane's agent, and what it is doing. */
  agentTarget?: string;
  agentStatus?: string;
  /** The Settings entry, which manages the saved shortcuts and nothing else. */
  manageOnly: boolean;
}

export interface QuickActionAvailability {
  /** Whether there is a pane to make something beside, and somewhere to go after. */
  canCreate: boolean;
  canStartTask: boolean;
  canStopAgent: boolean;
  canOpenWebService: boolean;
  /**
   * Whether any row above the shortcut list is drawn at all. When nothing is,
   * the list is the whole sheet and must not be pushed down by the gap that
   * would have separated it from the rows above.
   */
  hasActions: boolean;
}

export function quickActionAvailability(params: QuickActionParams): QuickActionAvailability {
  // Making a panel needs a live pane to make it beside, and somewhere to send
  // the phone afterwards.
  const canCreate =
    !params.manageOnly && Boolean(params.sessionId && params.paneId && params.serverId);

  // A gateway that cannot spawn is never offered the row. Not disabled, not
  // explained -- absent, which is the whole rule of this feature: the phone
  // never shows an affordance the machine behind it has no answer for.
  const canStartTask = canCreate && params.spawnSupported;

  // Stop is contextual, not permanent: it belongs to a pane that is doing
  // something. Four facts, all of which have to hold -- there is a pane, the
  // gateway can interrupt, the agent is working, and we know what to interrupt.
  const canStopAgent =
    canCreate
    && params.spawnSupported
    && agentIsInterruptible(params.agentStatus)
    && Boolean(params.agentTarget);

  // Opening a web service is about the machine, not about this pane -- so it
  // needs a server to be about, but not a pane or a session the way the rows
  // above it do.
  const canOpenWebService =
    !params.manageOnly && Boolean(params.serverId) && params.webServiceSupported;

  return {
    canCreate,
    canStartTask,
    canStopAgent,
    canOpenWebService,
    hasActions: canCreate || canStartTask || canStopAgent || canOpenWebService,
  };
}
