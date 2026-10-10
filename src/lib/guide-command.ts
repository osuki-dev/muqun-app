/**
 * A setup guide's shell command, run for the reader (design §8): on a
 * computer that answers and can open a terminal, the guide's first action is
 * "Run on <computer>" -- a new pane there, the command typed into it, the
 * pane shown. Anywhere else the guide offers what it always did: copy the
 * command, then check again.
 */

import type { ConnectionStatus } from './server-reachability';

export type GuideCommandAction = 'run' | 'copy';

/**
 * Run only where a pane can be opened right now: the computer is `live` (not
 * reconnecting, refused or unknown), its gateway has not said its terminal
 * plane is unsupported (the New terminal tile's rule), and its terminal
 * backend is not down. Copy everywhere else.
 */
export function guideCommandAction(computer: {
  status: ConnectionStatus;
  /** The gateway's terminal plane, when it said anything about one. */
  terminalPlane?: { supported: boolean };
  /** The terminal backend is known to be down (the backend-down screen). */
  terminalDown?: boolean;
}): GuideCommandAction {
  const terminal =
    (!computer.terminalPlane || computer.terminalPlane.supported) && !computer.terminalDown;
  return computer.status === 'live' && terminal ? 'run' : 'copy';
}

/**
 * What is typed into the pane: each line of the command as written, each
 * followed by Enter. Blank lines are left out (an Enter on its own does
 * nothing a reader asked for); nothing else is changed -- a `sudo` line runs
 * as is and the pane asks for the password.
 */
export function guideCommandLines(command: string): string[] {
  return command.split(/\r?\n/).filter((line) => line.trim().length > 0);
}

/** How long to wait for a new pane's shell to draw its prompt before typing anyway. */
export const SHELL_READY_TIMEOUT_MS = 3000;
/** How often a new pane is read while waiting for its prompt. */
export const SHELL_READY_POLL_MS = 150;
