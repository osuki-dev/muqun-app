/**
 * Where the agent screen's empty card stands.
 *
 * The card is centred in the room between the header and the composer, and
 * neither edge is a constant the card can be written against. The composer's
 * height is whatever its contents come to -- a session strip, a chips row, a
 * two-line draft, an offline notice -- and the top of the transcript moves
 * whenever a screen notice takes room above it.
 *
 * Both edges are measured, then, and this is the arithmetic that turns the
 * measurements into the two paddings that centre the card. It is here rather
 * than inline in the screen because the top one is applied on the UI thread
 * (the notice reserve only exists as a shared value) and is still worth
 * testing as arithmetic -- the same arrangement `composerBackdropBottom` is
 * in.
 */

/**
 * The room to leave under the composer before the composer has been measured.
 *
 * One frame's worth of guess, and deliberately generous: a card that starts a
 * little high and settles is better than one that starts under the dock.
 */
export const COMPOSER_RESERVE_FALLBACK = 185;

/**
 * The card's own top padding, given the room the transcript already gave a
 * notice.
 *
 * The empty card sits inside the transcript area, and that area already
 * carries the notice's reserve as padding. Adding the header inset on top of
 * it counts the header twice -- which is exactly how the card ended up in the
 * lower half of the screen whenever a notice was up. Taking the difference
 * instead means the content starts below whichever of the two reaches further
 * down, and the card moves only when the notice would otherwise reach it.
 */
export function emptyCardTopReserve(topInset: number, noticeReserve: number): number {
  'worklet';
  return Math.max(0, topInset - noticeReserve);
}

/**
 * The room to leave for the composer.
 *
 * The dock reports its own height; until it has, the fallback stands in. The
 * measurement is the whole dock, taken from the bottom of the screen, so it
 * already carries the bottom safe-area inset the dock pads itself with.
 */
export function emptyCardBottomReserve(dockHeight: number, bottomInset: number): number {
  return dockHeight > 0 ? dockHeight : bottomInset + COMPOSER_RESERVE_FALLBACK;
}
