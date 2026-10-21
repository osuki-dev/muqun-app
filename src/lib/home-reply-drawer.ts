/**
 * Home's reply drawer: the dock's conversation, drawn in a sheet that rises
 * from behind the composer (`components/home-reply-drawer.tsx`).
 *
 * Pure: how tall its two resting places are on a given window, and where a
 * drag released at some height and speed comes to rest. Both run on the UI
 * thread from the drag, so they are worklets.
 */

/** Where the drawer rests: shut, at its peek height, or nearly the whole window. */
export type ReplyDrawerSnap = 'closed' | 'peek' | 'full';

/** The peek's top edge, as a share of the window from its bottom. */
export const REPLY_DRAWER_PEEK_SHARE = 0.65;
/** The least the drawer shows above the dock's field, on a short window or with the keyboard up. */
export const REPLY_DRAWER_MIN_HEIGHT = 180;
/** The room the full drawer leaves under the status bar. */
export const REPLY_DRAWER_TOP_GAP = 8;
/** A release faster than this (points a second) carries the drawer one snap in its direction. */
export const REPLY_DRAWER_FLICK = 700;
/** How far ahead of the release a throw is projected, in seconds of its speed. */
const PROJECTION_S = 0.12;

export type ReplyDrawerHeights = { peek: number; full: number };

/**
 * The drawer's heights from the window's bottom edge: it stands on the
 * bottom, behind the dock, whose field covers its lowest `field` points. The
 * peek reaches `REPLY_DRAWER_PEEK_SHARE` of the window; full reaches just
 * under the status bar. Either always shows at least the minimum above the
 * field, and peek is never above full.
 */
export function replyDrawerHeights(input: {
  windowHeight: number;
  topInset: number;
  field: number;
}): ReplyDrawerHeights {
  'worklet';
  const { windowHeight, topInset, field } = input;
  const least = field + REPLY_DRAWER_MIN_HEIGHT;
  const full = Math.max(least, windowHeight - topInset - REPLY_DRAWER_TOP_GAP);
  const peek = Math.min(full, Math.max(least, windowHeight * REPLY_DRAWER_PEEK_SHARE));
  return { peek, full };
}

/** The visible height a snap rests at. */
export function replyDrawerSnapHeight(snap: ReplyDrawerSnap, heights: ReplyDrawerHeights): number {
  'worklet';
  return snap === 'closed' ? 0 : snap === 'peek' ? heights.peek : heights.full;
}

/**
 * Where a drag released at `height` (visible points) with `velocityY` (points
 * a second, down positive, as the gesture reports it) comes to rest.
 *
 * A flick moves one snap in its direction from the snap the drag started at
 * or passed; anything slower rests at the snap nearest the throw's projection.
 */
export function replyDrawerSettle(input: {
  height: number;
  velocityY: number;
  heights: ReplyDrawerHeights;
}): ReplyDrawerSnap {
  'worklet';
  const { height, velocityY, heights } = input;
  const order: ReplyDrawerSnap[] = ['closed', 'peek', 'full'];
  const at = order.map((snap) => replyDrawerSnapHeight(snap, heights));
  if (Math.abs(velocityY) >= REPLY_DRAWER_FLICK) {
    if (velocityY < 0) {
      // Upward: the first snap above where it was let go.
      for (let index = 0; index < at.length; index += 1)
        if (at[index]! > height + 1) return order[index]!;
      return 'full';
    }
    for (let index = at.length - 1; index >= 0; index -= 1)
      if (at[index]! < height - 1) return order[index]!;
    return 'closed';
  }
  const projected = height - velocityY * PROJECTION_S;
  let best = 0;
  for (let index = 1; index < at.length; index += 1)
    if (Math.abs(at[index]! - projected) < Math.abs(at[best]! - projected)) best = index;
  return order[best]!;
}

/**
 * A drag past the full height gives way less and less, as a sheet pulled past
 * its top does, rather than stopping dead under the finger.
 */
export function replyDrawerRubberBand(height: number, full: number): number {
  'worklet';
  if (height <= full) return Math.max(0, height);
  const over = height - full;
  return full + over / (1 + over / 60);
}
