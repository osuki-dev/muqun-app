/**
 * Home's dock gets out of the way while the reader scrolls down the list, and
 * comes back the moment they scroll up (design §9).
 *
 * This is the decision for one scroll event, run on the UI thread from the
 * scroll handler. It is pure so a table can pin it.
 *
 * - **Direction** is the sign of the event's offset change. Any upward step
 *   larger than `UPWARD_NOISE` shows the dock at once, so a resting finger's
 *   sub-point jitter does not show it.
 * - **Threshold:** a downward run accumulates in `travel` and resets on any
 *   upward step. The dock starts to move only once that run passes
 *   `HIDE_THRESHOLD`, so a small nudge or a tap that scrolls a few points
 *   leaves it where it is. Past the threshold it follows the finger point for
 *   point, up to its own height.
 * - **Edges:** at the top or the bottom of the list (within `EDGE`) the dock
 *   shows. A list too short to scroll is always at an edge, so it never hides.
 * - **Pinned:** a focused field, an open keyboard or a send in flight keeps
 *   the dock shown.
 * - **Only the finger moves it out:** `travel` counts only while a drag is
 *   active and starts from 0 with each drag. Momentum after the finger lifts,
 *   a scroll restored on return, or content growing under the list never
 *   hides the dock; an upward step or an edge from any of them still shows it.
 * - **No scroll needed to come back:** when the content or the viewport
 *   changes so the list can no longer scroll, or its end comes into view,
 *   `dockAtEdge` says so without a scroll event (`settle` in the hook).
 */

/** Points of continuous downward scroll before the dock starts to move. */
export const HIDE_THRESHOLD = 24;
/** An upward step smaller than this is a resting finger, not a direction. */
const UPWARD_NOISE = 1;
/** How close to either end of the list counts as being at that end. */
const EDGE = 4;

export interface DockScrollEvent {
  y: number;
  delta: number;
  contentHeight: number;
  viewportHeight: number;
  dragging: boolean;
  pinned: boolean;
}

/**
 * `show`: animate the dock fully back in.
 * `follow`: set the dock's offset to `offset` (it tracks the finger).
 * `hold`: leave it where it is (and wherever it is animating to).
 */
export type DockScrollStep =
  | { kind: 'show'; travel: 0 }
  | { kind: 'follow'; travel: number; offset: number }
  | { kind: 'hold'; travel: number };

/** Whether the list is at its top or bottom, or too short to scroll at all. */
export function dockAtEdge(y: number, viewportHeight: number, contentHeight: number): boolean {
  'worklet';
  return y <= EDGE || y + viewportHeight >= contentHeight - EDGE;
}

export function dockScrollStep(
  event: DockScrollEvent,
  state: { travel: number; offset: number; distance: number }
): DockScrollStep {
  'worklet';
  const atEdge = dockAtEdge(event.y, event.viewportHeight, event.contentHeight);
  if (event.pinned || atEdge || event.delta <= -UPWARD_NOISE) return { kind: 'show', travel: 0 };
  if (!event.dragging || event.delta <= 0) return { kind: 'hold', travel: state.travel };
  const travel = state.travel + event.delta;
  if (travel <= HIDE_THRESHOLD) return { kind: 'hold', travel };
  const offset = Math.min(state.distance, Math.max(state.offset, travel - HIDE_THRESHOLD));
  return { kind: 'follow', travel, offset };
}
