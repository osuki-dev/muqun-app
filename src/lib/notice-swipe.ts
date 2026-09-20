/** Small deliberate gestures dismiss; visual travel stays bounded on every screen size. */
export const NOTICE_DRAG_FOLLOW = 0.5;
export const NOTICE_DRAG_LIMIT = 24;
export const NOTICE_DISMISS_DISTANCE = 12;
export const NOTICE_DISMISS_VELOCITY = 250;
export const NOTICE_DISMISS_MOVED = 6;
export const NOTICE_DISMISS_TRAVEL = 28;

export interface NoticeSwipe {
  translationX: number;
  translationY: number;
  velocityX: number;
  velocityY: number;
}

export type NoticeSwipeEnd = { dismissed: false } | { dismissed: true; x: number; y: number };

export function noticeDragOffset(swipe: Pick<NoticeSwipe, 'translationX' | 'translationY'>) {
  'worklet';
  return {
    x: Math.max(
      -NOTICE_DRAG_LIMIT,
      Math.min(NOTICE_DRAG_LIMIT, swipe.translationX * NOTICE_DRAG_FOLLOW)
    ),
    y: Math.max(-NOTICE_DRAG_LIMIT, Math.min(0, swipe.translationY * NOTICE_DRAG_FOLLOW)),
  };
}

export function noticeSwipeEnd(swipe: NoticeSwipe): NoticeSwipeEnd {
  'worklet';
  // Judge the finger's intent before resistance, not the clamped visual offset.
  const across = Math.abs(swipe.translationX);
  const up = Math.max(0, -swipe.translationY);
  const sweep =
    across >= NOTICE_DISMISS_DISTANCE ||
    (across >= NOTICE_DISMISS_MOVED && Math.abs(swipe.velocityX) >= NOTICE_DISMISS_VELOCITY);
  const rise =
    up >= NOTICE_DISMISS_DISTANCE ||
    (up >= NOTICE_DISMISS_MOVED && -swipe.velocityY >= NOTICE_DISMISS_VELOCITY);
  if (!sweep && !rise) return { dismissed: false };
  const offset = noticeDragOffset(swipe);
  if (sweep && (!rise || across >= up)) {
    return {
      dismissed: true,
      x: Math.sign(swipe.translationX) * NOTICE_DISMISS_TRAVEL,
      y: offset.y,
    };
  }
  return { dismissed: true, x: offset.x, y: -NOTICE_DISMISS_TRAVEL };
}
