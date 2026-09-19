/**
 * Whether the left drawer is reachable at all (card #664).
 *
 * The drawer held three rows: `Servers`, which navigated to the screen it was
 * opened from; `Pair a server`; and `Settings`. One was a no-op and the other
 * two are now a single tap away in the home header, so the drawer was a gesture
 * and a hamburger spent on nothing.
 *
 * Off and retired: the drawer navigator has been removed and the home screen
 * moved to `src/app/index.tsx`. The drawer held rows that are now single taps
 * in the top header.
 *
 * `HOME_DRAWER_ENABLED` remains false and governs the tablet permanent drawer
 * fallback logic.
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
