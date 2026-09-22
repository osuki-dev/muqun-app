/**
 * Where Home's hero picture actually is on screen, published by Home and read
 * by the launch opening.
 *
 * The opening ends by putting the pack's picture down in exactly the place
 * Home keeps it, so that the cover coming off is not a transition between two
 * compositions but the same composition losing a layer. That only works if the
 * two agree on one rectangle, and the rectangle is not something the overlay
 * can compute: it is the bottom of a measured header, plus a brand block that
 * some packs hide entirely, plus a banner slot that is usually absent -- and
 * Home already measures the result. So Home says, and the opening listens.
 *
 * A module-level value with subscribers rather than a React context, because
 * the two live on opposite sides of the tree: `LaunchOverlay` is a sibling of
 * the router, mounted above it, and Home is several screens down inside it.
 * A context spanning both would have to be installed above the overlay and
 * would exist solely for one rectangle that matters for one second.
 *
 * Free of React and React Native imports on purpose, so `bun test` can load it.
 *
 * The publisher clears its value when Home loses focus or unmounts, so a
 * deep link cannot land the opening on an inactive screen.
 */

export type LaunchArtworkRect = {
  /** Window coordinates, in points. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Decoded artwork identity and actual drawn bounds, rather than its layout band. */
  source?: string;
  intrinsicWidth?: number;
  intrinsicHeight?: number;
  /** A cover crop or mask cannot be represented by scaling the launch image. */
  cropped?: boolean;
};

type Listener = (rect: LaunchArtworkRect | null) => void;

let current: LaunchArtworkRect | null = null;
const listeners = new Set<Listener>();

/** A rect the opening can actually aim at: on screen, and with area. */
function usable(rect: LaunchArtworkRect | null): rect is LaunchArtworkRect {
  if (!rect) return false;
  const { x, y, width, height } = rect;
  if (![x, y, width, height].every((value) => Number.isFinite(value))) return false;
  return width > 0 && height > 0;
}

function same(a: LaunchArtworkRect | null, b: LaunchArtworkRect | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height &&
    a.source === b.source &&
    a.intrinsicWidth === b.intrinsicWidth &&
    a.intrinsicHeight === b.intrinsicHeight &&
    a.cropped === b.cropped
  );
}

/**
 * Home reports the band it drew its picture in, in window coordinates.
 *
 * Anything that is not a usable rectangle is stored as "no rect", which is the
 * same state as never having been told: the opening falls back to a cross-fade
 * rather than flying the picture to a corner.
 */
export function publishLaunchArtworkRect(rect: LaunchArtworkRect | null): void {
  const next = usable(rect) ? rect : null;
  if (same(current, next)) return;
  current = next;
  for (const listener of listeners) listener(current);
}

/** The last rect Home reported, or null if it has not drawn a hero. */
export function launchArtworkRect(): LaunchArtworkRect | null {
  return current;
}

/**
 * Watch for Home reporting its hero band.
 *
 * The listener is called immediately with the current value, because the
 * opening may mount before or after Home measures and must not care which.
 */
export function subscribeLaunchArtworkRect(listener: Listener): () => void {
  listeners.add(listener);
  listener(current);
  return () => {
    listeners.delete(listener);
  };
}

/** Tests only. */
export function resetLaunchArtworkRectForTesting(): void {
  current = null;
  listeners.clear();
}
