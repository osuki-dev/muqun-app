/**
 * `importantForAccessibility` for a live subtree that is sometimes hidden
 * behind something drawn over it (the Pad's Home over the workspace, the
 * drawer's overlay over the page).
 *
 * Shown again it is `'yes'`, not `'auto'`. Android's
 * `View.setImportantForAccessibility` only announces a subtree change when the
 * view's own inclusion changes or neither mode is AUTO; going from
 * NO_HIDE_DESCENDANTS to AUTO on a plain container changes neither, so the
 * subtree is never re-announced and an accessibility client that cached it
 * hidden keeps it hidden. That is how the Pad's terminal shortcut chips --
 * mounted under Home, then revealed -- stayed out of the tree while plainly on
 * screen. NO_HIDE_DESCENDANTS to YES always notifies. A YES container with no
 * label or action is not a stop for a screen reader, so nothing extra is read.
 */
export function revealableSubtreeImportance(hidden: boolean): 'yes' | 'no-hide-descendants' {
  return hidden ? 'no-hide-descendants' : 'yes';
}
