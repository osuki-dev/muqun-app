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
 * The other surface that takes the dock away is an editor, and it takes it
 * away for the opposite reason: not because the dock offers too much, but
 * because the program underneath owns every row of the screen and the dock is
 * standing on the last two of them. `editorMode` below is that rule; what is
 * left of the dock floats over the grid instead of reserving height from it,
 * and none of it may change the terminal's layout.
 *
 * Kept pure and free of React so the rule is one table in one test rather than
 * a conclusion drawn from six `&&`s spread through a 3000-line screen.
 */
import type { PaneApproval } from '@/lib/pane-approval';

export interface DockPresentationInput {
  /** The menu the selected pane is blocked on, if it is blocked on one. */
  approval: PaneApproval | null;
  /**
   * The app's own on-screen keyboard has taken the dock.
   *
   * On an editor pane there is no dock left for it to take, so the same flag
   * means the floating cluster is open rather than collapsed to its handle --
   * one state, because "the app's keyboard is up" is the same fact either way
   * and a second flag would be a second thing to keep in step.
   */
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
   * The selected pane is a modal editor -- nvim, helix, emacs, nano.
   *
   * Such a pane is driven a keystroke at a time, which is what the keyboard
   * sends and what the composer, a line buffer needing Enter, does not.
   *
   * It is also the one pane whose program has an opinion about every row of
   * the screen, which is why this flag no longer merely *rearranges* the dock:
   * it takes the dock off the screen. See `editorMode`.
   */
  editorPane: boolean;
  /**
   * The reader asked for the composer back on a pane where it had stood down.
   *
   * Per visit and not remembered: the composer is summoned to send one line,
   * and a pane that kept it out would have taken back the height the keyboard
   * was opened for.
   */
  composerRevealed: boolean;
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
  /**
   * The pane is an editor and the dock has left the screen for it.
   *
   * The maintainer's rule for these panes: if nvim is open then this is a whole
   * nvim, and a whole nvim is the whole pane. Every row of the
   * grid belongs to the program: nvim's status line and its command line are
   * the *last two*, which is exactly where a dock sits, so a dock on an editor
   * covers the two rows the reader is typing into.
   *
   * So on these panes the dock does not shrink or rearrange -- it goes, and
   * what is left floats over the grid: `editorHandle` when it is out of the
   * way, `editorPanel` when it has been asked for. Nothing that floats is
   * allowed to change the terminal's layout, which is the other half of the
   * same sentence: a dock that reserved height would resize the grid, and a
   * grid resize is a SIGWINCH and a full repaint every time a reader reaches
   * for `esc`.
   *
   * A standing question outranks it. An approval clears the dock down to
   * itself on every pane, editor included, and an answerable question with the
   * answers floating in a corner is worse than one in a banner.
   */
  editorMode: boolean;
  /**
   * The one small control left over the editor: the way back to the keyboard.
   *
   * Collapsed state of the cluster. Mutually exclusive with `editorPanel`,
   * because they are the same object in its two sizes.
   */
  editorHandle: boolean;
  /**
   * The cluster opened: the app's keyboard, the editor keys, and the way to
   * the composer -- all of it floating over an unchanged grid.
   */
  editorPanel: boolean;
  /** The pane strip. */
  paneChips: boolean;
  /** The app's on-screen keyboard, which replaces the key row when it is up. */
  virtualKeyboard: boolean;
  /**
   * The in-dock row: quick actions, files, the keyboard toggle, and the
   * scrolling terminal keys it exists to carry.
   *
   * On an editor there is no dock, and this means the same row standing on its
   * own inside the floating panel -- which happens for exactly one reason: the
   * composer took the app's keyboard away, and the keys were riding in it.
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
  /**
   * The way back to a composer that stood down for an editor's keyboard.
   *
   * A floating button rather than a row, for the same reason `floatingActions`
   * is one: a line of the pane is too much rent for a single control, and the
   * height it would take is the height the keyboard was opened to get.
   */
  composerEntry: boolean;
  /**
   * The terminal keys ride inside the keyboard panel instead of on their own
   * row.
   *
   * `esc`, `:w`, the leader combos and the Ctrl chords are what an editor is
   * driven by, and the keyboard used to replace the row that carried them --
   * so typing and reaching for them were mutually exclusive, on the one surface
   * where both are wanted at once.
   */
  keysInKeyboard: boolean;
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
  editorPane,
  composerRevealed,
}: DockPresentationInput): DockPresentation {
  // A question with no answers on it clears nothing: see the note above. The
  // banner still draws -- the prompt and its context are worth reading even
  // when the options did not survive the parse -- it just draws over an
  // otherwise ordinary dock.
  const answerable = approval !== null && approval.options.length > 0;
  // The editor takes the pane. A question outranks it -- see `editorMode`.
  const editorMode = editorPane && !answerable;
  // The cluster's two sizes, which are the same control and never both.
  const editorPanel = editorMode && keyboardMode;
  const editorHandle = editorMode && !keyboardMode;
  // Two keyboards on one screen is not a design, it is an accident.
  //
  // Summoning the composer raises the phone's own keyboard for it, and inside
  // the floating panel the app's QWERTY would then be stacked on top of that:
  // a grip, thirty keys, a text field and the system keyboard under all of it,
  // which on a small phone is taller than the phone. The dock could survive
  // that arrangement because a dock reserves its height and simply pushes the
  // terminal up; a panel that reserves nothing runs off the top of the screen
  // instead. So the app's keyboard stands down here -- and the terminal keys,
  // which are the reason the panel exists at all, come back onto a row of
  // their own rather than leaving with the QWERTY that was carrying them.
  const editorComposing = editorPanel && composerRevealed;
  const virtualKeyboard = keyboardMode && !answerable && !editorComposing;
  // Whether an ordinary dock row may be on screen at all. Two things take the
  // dock away wholesale: a question that can be answered, and an editor.
  const dockRows = !answerable && !editorMode;
  // The two entries are offered whenever the dock is ordinary; the setting
  // decides only *where*, so exactly one of these is ever true.
  const entriesShown = dockRows && !virtualKeyboard;
  const keyRow = showTerminalKeyRow && (entriesShown || editorComposing);
  // The keys do not leave when the keyboard arrives -- they move into it. The
  // setting still governs whether they exist at all, so a reader who switched
  // the row off does not get it back by opening the keyboard.
  const keysInKeyboard = virtualKeyboard && showTerminalKeyRow;
  // The keyboard already took the composer's place -- it is the input now, and
  // a line buffer under a full QWERTY is two inputs arguing. What was missing
  // was the way back to it *without* dismissing the keyboard, which on an
  // editor is the difference between pasting a line and losing your keys to do
  // it. So this is not a new hiding rule; it is the old one, named, with a door
  // in it.
  //
  // An editor adds the second reason for the composer to stand down, and it is
  // the stronger one: on a collapsed cluster there is nothing on screen but the
  // handle, so a text field cannot be among what is left whether or not the
  // reader asked for one earlier.
  const composerStandsDown = editorHandle || ((virtualKeyboard || editorMode) && !composerRevealed);

  return {
    approvalOnly: answerable,
    editorMode,
    editorHandle,
    editorPanel,
    paneChips: dockRows && !virtualKeyboard && paneCount > 1,
    virtualKeyboard,
    keyRow,
    floatingActions: entriesShown && !showTerminalKeyRow,
    attachEntry: dockRows && attachmentsAvailable,
    attachmentStrip: dockRows && stagedAttachments > 0,
    composer: !answerable && !composerStandsDown,
    // The handle is the only thing over a collapsed editor, and it is already
    // the way to the composer -- a second floating button beside it would be
    // two controls for one door.
    composerEntry: composerStandsDown && !editorHandle,
    keysInKeyboard,
    // Derived from the two surfaces that carry a real `esc` rather than from
    // the flag alone, so that a rule which one day keeps the row up through
    // some approval cannot silently produce two escapes side by side. The
    // floating pair carries no keys, so it is not one of them.
    bannerEscape: answerable && !keyRow && !virtualKeyboard,
    animateReflow: screenOnTop,
  };
}
