/**
 * What the composer dock shows, and -- the reason this file exists -- what it
 * stops showing while the pane is waiting on a permission menu.
 *
 * An approval is a question with a small set of right answers, and the dock it
 * arrives in is the busiest surface in the app: a quick-actions entry, a files
 * button, an on-screen-keyboard toggle, a scrolling row of terminal keys, a
 * pane strip, a paperclip, an input, a send button. Every one of those is a way
 * to send the pane something that is not an answer, and none of them is what is
 * being asked for. So while the banner is up the dock is *only* the banner: the
 * question, the lines around it, and the answers. Everything else leaves, and
 * everything else comes back the moment the question is gone.
 *
 * Two things survive that clearing, and both are load-bearing:
 *
 * - **Escape.** `esc` is how the agent's menu is dismissed without answering
 *   it, and on this screen it lives on the terminal key row. Clearing the row
 *   without putting `esc` back would mean the app had removed the only way out
 *   of the state it was asking about, so the banner grows its own compact one
 *   for exactly as long as the row is gone.
 * - **A menu with no answers is not a menu.** A degenerate parse -- an envelope
 *   whose options came back empty -- would otherwise clear the dock down to a
 *   question that cannot be answered and a screen that cannot be used. That
 *   case keeps the whole ordinary dock with the banner sitting on top of it,
 *   which is what the screen did before any of this existed.
 *
 * Kept pure and free of React so the rule is one table in one test rather than
 * a conclusion drawn from six `&&`s spread through a 3000-line screen.
 */
import type { PaneApproval } from '@/lib/pane-approval';

export interface DockPresentationInput {
  /** The menu the selected pane is blocked on, if it is blocked on one. */
  approval: PaneApproval | null;
  /** The app's own on-screen keyboard has taken the dock. */
  keyboardMode: boolean;
  /** How many panes the current tab holds. One pane needs no chips. */
  paneCount: number;
  /** The user's "show terminal key row" setting. */
  showTerminalKeyRow: boolean;
  /** Attachments are offered at all: a real gateway, not the bundled demo. */
  attachmentsAvailable: boolean;
  /** Files already staged for the next message. */
  stagedAttachments: number;
  /**
   * This screen is the one on top -- no sheet is covering the dock.
   *
   * The panels sheet is a full-height `formSheet`, so a pane picked on it
   * changes which rows the dock has while the dock cannot be seen at all.
   */
  screenOnTop: boolean;
}

export interface DockPresentation {
  /** The dock is down to the banner: a question is standing and can be answered. */
  approvalOnly: boolean;
  /** The pane strip. */
  paneChips: boolean;
  /** The app's on-screen keyboard, which replaces the key row when it is up. */
  virtualKeyboard: boolean;
  /**
   * The in-dock row: quick actions, files, the keyboard toggle, and the
   * scrolling terminal keys it exists to carry.
   */
  keyRow: boolean;
  /**
   * Quick actions and files as a floating pair over the pane rather than as a
   * row inside the dock: what a user who switched the key row off gets.
   *
   * A row that exists only to hold two circles costs the pane a whole line of
   * output for the width of the screen, and buys nothing the corner cannot
   * carry. With the keys gone the two entries go and stand opposite the "jump
   * to latest" pill instead -- same height, other side.
   */
  floatingActions: boolean;
  /** The paperclip, and the menu it opens. */
  attachEntry: boolean;
  /** The tiles for files already staged for the next message. */
  attachmentStrip: boolean;
  /** The input, its send button, and the popups that hang off the caret. */
  composer: boolean;
  /** A compact `esc` on the banner, standing in for the row that carried it. */
  bannerEscape: boolean;
  /**
   * The dock's rows may animate their reflow when one of them arrives or
   * leaves.
   *
   * Only while the dock is on screen. A row's layout transition started under
   * the full-height panels sheet has nobody to play to, and it settles at the
   * frame it began on rather than the one it was going to: the key row and the
   * composer stayed in the pane strip's slot, and the strip -- which has no
   * layout transition of its own -- came back to its proper place on top of
   * them (card #827). Covered, the rows take their new places outright.
   */
  animateReflow: boolean;
}

/** The dock's whole visibility rule, in one function. */
export function dockPresentation({
  approval,
  keyboardMode,
  paneCount,
  showTerminalKeyRow,
  attachmentsAvailable,
  stagedAttachments,
  screenOnTop,
}: DockPresentationInput): DockPresentation {
  // A question with no answers on it clears nothing: see the note above. The
  // banner still draws -- the prompt and its context are worth reading even
  // when the options did not survive the parse -- it just draws over an
  // otherwise ordinary dock.
  const answerable = approval !== null && approval.options.length > 0;
  const virtualKeyboard = keyboardMode && !answerable;
  // The two entries are offered whenever the dock is ordinary; the setting
  // decides only *where*, so exactly one of these is ever true.
  const entriesShown = !answerable && !virtualKeyboard;
  const keyRow = entriesShown && showTerminalKeyRow;

  return {
    approvalOnly: answerable,
    paneChips: !answerable && !virtualKeyboard && paneCount > 1,
    virtualKeyboard,
    keyRow,
    floatingActions: entriesShown && !showTerminalKeyRow,
    attachEntry: !answerable && attachmentsAvailable,
    attachmentStrip: !answerable && stagedAttachments > 0,
    composer: !answerable,
    // Derived from the two surfaces that carry a real `esc` rather than from
    // the flag alone, so that a rule which one day keeps the row up through
    // some approval cannot silently produce two escapes side by side. The
    // floating pair carries no keys, so it is not one of them.
    bannerEscape: answerable && !keyRow && !virtualKeyboard,
    animateReflow: screenOnTop,
  };
}
