/**
 * Whether the left drawer is reachable at all (card #664).
 *
 * The drawer held three rows: `Servers`, which navigated to the screen it was
 * opened from; `Pair a server`; and `Settings`. One was a no-op and the other
 * two are now a single tap away in the home header, so the drawer was a gesture
 * and a hamburger spent on nothing.
 *
 * Off rather than deleted, and this constant is the whole switch: the navigator,
 * the `(drawer)` route group and `AppDrawerContent` all stay exactly as they
 * were, so a fourth top-level place -- one that genuinely does not fit in a
 * header -- flips this to `true` and gets its drawer back. Deleting the
 * navigator would also mean re-parenting `index` and `settings` out of the
 * group, which rewrites every route these screens are pushed from for no gain.
 *
 * It also governs the >=900pt "permanent drawer" layout, which is why it lives
 * here rather than in the layout file: three components ask whether the drawer
 * is on, and a shared constant is what stops two of them drifting into a state
 * where a permanent panel is drawn beside a screen that has no way to open it.
 */
export const HOME_DRAWER_ENABLED = false;

/**
 * Whether the drawer is showing as a fixed side panel rather than an overlay.
 *
 * Always false while the drawer is off: a tablet must not get a permanent panel
 * from a navigator nothing can reach.
 */
export function isDrawerPermanent(width: number): boolean {
  return HOME_DRAWER_ENABLED && width >= 900;
}
