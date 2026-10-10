/**
 * A setup guide's shell command, run for the reader (design §8): on a
 * computer that answers and can open a terminal, the guide's first action is
 * "Run on <computer>" -- a new pane there, the command typed into it, the
 * pane shown. Anywhere else the guide offers what it always did: copy the
 * command, then check again.
 */

export type GuideCommandAction = 'run' | 'copy';

/** Run only where a pane can be opened right now; copy everywhere else. */
export function guideCommandAction(computer: {
  /** The computer answers now, by the same evidence Home's cards use. */
  reachable: boolean;
  /** It has a terminal backend the app can open a pane on. */
  terminal: boolean;
}): GuideCommandAction {
  return computer.reachable && computer.terminal ? 'run' : 'copy';
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
