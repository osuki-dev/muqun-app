/**
 * Smallest short side, in dp, from which a device counts as a tablet. Android's
 * own `sw600dp` line, and the one the Pad layout's tablets sit above.
 */
export const TABLET_MIN_SHORT_SIDE = 600;

export type OrientationPolicy = 'landscape' | 'portrait';

/**
 * Which orientation the app is locked to, from the screen's metrics.
 *
 * The Pad layout is a cover spread that does not survive portrait, so a tablet
 * is landscape-only; a phone is portrait-only. The decision reads the *shorter*
 * side, which rotation does not change, so a tablet that boots in a portrait
 * window is still a tablet and a phone that boots in landscape is still a phone.
 * Unusable metrics (zero before the window exists, NaN) fall back to portrait,
 * the phone policy.
 */
export function orientationPolicy(width: number, height: number): OrientationPolicy {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return 'portrait';
  return Math.min(width, height) >= TABLET_MIN_SHORT_SIDE ? 'landscape' : 'portrait';
}
