import { t } from '@lingui/core/macro';

/**
 * What to tell someone whose terminal backend is not running, in their own
 * language: why the terminal cannot open, and what to do on the computer the
 * gateway runs on. One place, so the workspace's unavailable state and Home's
 * "New terminal" notice say the same thing.
 */
export type TerminalBackendCopy = {
  reason: string;
  hint: string;
  /** A command that starts the backend, when there is one worth showing. */
  command?: string;
};

/** Starts a detached tmux server with one session: the smallest thing that works. */
export const TMUX_START_COMMAND = 'tmux new-session -d';

export function terminalBackendCopy(backend: string): TerminalBackendCopy {
  if (backend === 'tmux') {
    return {
      reason: t`Muqun Gateway is running, but it cannot reach a tmux server on its computer`,
      hint: t`Start one there, then tap Retry:`,
      command: TMUX_START_COMMAND,
    };
  }
  if (backend === 'herdr') {
    return {
      reason: t`Muqun Gateway is running, but it cannot reach Herdr on its computer`,
      hint: t`Start Herdr there, then tap Retry`,
    };
  }
  return {
    reason: t`Muqun Gateway is running, but it cannot reach the ${backend} backend on its computer`,
    hint: t`Start it there, then tap Retry`,
  };
}
