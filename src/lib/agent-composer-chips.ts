/**
 * Which chips the composer's second row carries, in order.
 *
 * The row is a list of independent facts -- the agent, the model, the queue,
 * what is still running, the context, the changes on disk -- and each one is
 * there or not on its own terms. Written inline as ten nested ternaries that
 * was easy to lose: the changes chip sat last in the source and only appeared
 * on a session with no context pill in front of it, so the one affordance for
 * "see what the agent wrote" went missing exactly on the sessions that had
 * written something.
 *
 * Stated here instead, pure and in one place, so the order is readable and the
 * independence is a thing a test can assert. The row scrolls; nothing is
 * dropped to make it fit.
 */

export type ComposerChipId =
  | 'sessions'
  | 'mode'
  | 'model'
  | 'tasks'
  | 'inbox'
  | 'background'
  | 'context'
  | 'diff'
  | 'delivery'
  | 'stop';

export interface ComposerChipState {
  /** The all-sessions button, when the screen offers the sheet. */
  canOpenSessions: boolean;
  /** The model picker, when the screen offers the sheet. */
  canOpenModel: boolean;
  /** How many todos the run has published. */
  taskCount: number;
  /** The tasks sheet, when the screen offers it. */
  canOpenTasks: boolean;
  /** How many messages are waiting behind the current turn. */
  inboxCount: number;
  /** How many shells and detached tools are still running. */
  backgroundCount: number;
  /** The background tray, when the screen offers it. */
  canOpenBackground: boolean;
  /** Whether there is a context/spend pill to draw. */
  hasContextPill: boolean;
  /** Whether the workspace has uncommitted changes. */
  hasDiffs: boolean;
  /** Whether a turn is in flight. */
  running: boolean;
}

/** The chips, in the order the row draws them. */
export function composerChipIds(state: ComposerChipState): ComposerChipId[] {
  const ids: ComposerChipId[] = [];
  if (state.canOpenSessions) ids.push('sessions');
  // The agent chip is unconditional: it is what the session is running, and a
  // session is always running something.
  ids.push('mode');
  if (state.canOpenModel) ids.push('model');
  if (state.canOpenTasks || state.taskCount > 0) ids.push('tasks');
  if (state.inboxCount > 0) ids.push('inbox');
  if (state.backgroundCount > 0 && state.canOpenBackground) ids.push('background');
  if (state.hasContextPill) ids.push('context');
  if (state.hasDiffs) ids.push('diff');
  if (state.running) ids.push('delivery', 'stop');
  return ids;
}
