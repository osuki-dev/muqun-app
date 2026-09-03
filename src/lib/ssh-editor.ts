/**
 * Is the SSH shell running an editor, and which nvim mode is it in?
 *
 * The gateway answers the first question from what tmux tells it -- the
 * pane's foreground command, its profile, its title -- and none of that
 * exists for a shell the app is talking to directly. What the SSH screen does
 * have is the terminal emulator's own account of the program on the far side:
 *
 *  - **The alternate screen.** `DECSET 1049` (or 47 / 1047) is how every
 *    full-screen program takes the screen, and the emulator tracks it
 *    (`TerminalModes.alternateScreen`). This is the real answer to "does this
 *    program own the screen", the question the gateway can only guess at from
 *    names; here it is the precondition for everything below, because an
 *    editor that is not on the alternate screen is not painting one.
 *  - **The title.** An editor with `title` set writes its name through OSC 0/2,
 *    and the emulator keeps it on the frame. The same pattern the gateway's
 *    `isFullScreenTuiPane` reads titles with is asked, so there is one list of
 *    editors in the app and not two -- but nvim and vim ship with `title`
 *    off, so most of the time there is no title to read.
 *  - **The mode line.** `parseNvimMode` reads `-- INSERT --` and a lualine
 *    block off the last rows of the screen. A mode that parses is an nvim on
 *    the screen, whatever the title says.
 *
 * Stock nvim shows a mode line only in Insert and Visual; in Normal mode there
 * is nothing on the screen to read. So the verdict *latches*: once an editor
 * has been seen on this alternate screen it stays an editor until the
 * alternate screen is left, which is what keeps the key row from swapping
 * between the shell set and the editor set on every Esc.
 *
 * What is still missing, and said plainly: a full-screen program that is not
 * nvim and does not set a title -- helix, emacs, nano with defaults, or an
 * nvim whose statusline plugin this table does not know, sitting in Normal
 * mode -- reads as a plain full-screen program. It gets the shell key row and
 * no editor actions until it says something this file can read.
 *
 * Pure: a rule over three facts, tested as a table.
 */
import { isFullScreenTuiPane, parseNvimMode } from '@/lib/terminal-keys';
import { terminalFrameText } from '@/terminal/terminal-core';
import type { TerminalFrame } from '@/terminal/types';

export type NvimMode = ReturnType<typeof parseNvimMode>;

export interface SshEditorSignals {
  /** The emulator is on the alternate screen. */
  alternateScreen: boolean;
  /** The title the stream set, as the frame carries it. */
  title: string | null;
  /** What `sshNvimMode` read off the frame. */
  nvimMode: NvimMode;
}

/** How many rows above the bottom the mode line is looked for. */
const MODE_LINE_LOOKBACK = 4;

/**
 * nvim's mode as read off the bottom of the frame, or `null` when nothing
 * there says. Only the last few rows are rendered to text: the SSH frame is
 * the whole scrollback window, and joining five thousand rows on every
 * publish would be paid for by every keystroke.
 */
export function sshNvimMode(frame: TerminalFrame | undefined, alternateScreen: boolean): NvimMode {
  if (!frame || !alternateScreen) return null;
  const tail = { ...frame, lines: frame.lines.slice(-MODE_LINE_LOOKBACK) };
  return parseNvimMode(terminalFrameText(tail), MODE_LINE_LOOKBACK);
}

/**
 * Whether the shell is running an editor now, given whether it was a moment
 * ago. `previous` is the latch described above.
 */
export function sshEditorPane(previous: boolean, { alternateScreen, title, nvimMode }: SshEditorSignals): boolean {
  if (!alternateScreen) return false;
  if (previous) return true;
  return nvimMode !== null || isFullScreenTuiPane(null, title);
}
