import { describe, expect, test } from 'bun:test';

import {
  NOTICE_DISMISS_MOVED,
  NOTICE_DISMISS_OVERSHOOT,
  NOTICE_DISMISS_RISE,
  NOTICE_DISMISS_SWEEP_MIN,
  NOTICE_DISMISS_SWEEP_RATIO,
  NOTICE_DISMISS_VELOCITY,
  NOTICE_DRAG_FOLLOW,
  noticeDragOffset,
  noticeSwipeEnd,
  type NoticeSwipe,
} from '../notice-swipe';

const plate = { width: 360, height: 84 };
const still: NoticeSwipe = { translationX: 0, translationY: 0, velocityX: 0, velocityY: 0 };
const swipe = (parts: Partial<NoticeSwipe>): NoticeSwipe => ({ ...still, ...parts });

/** The finger travel that puts the plate exactly at a threshold. */
const toOffset = (points: number) => points / NOTICE_DRAG_FOLLOW;

describe('notice drag offset', () => {
  test('upward and sideways travel follow the finger, held slightly back', () => {
    expect(noticeDragOffset({ translationX: 100, translationY: -50 })).toEqual({
      x: 100 * NOTICE_DRAG_FOLLOW,
      y: -50 * NOTICE_DRAG_FOLLOW,
    });
  });

  test('downward travel does not move the plate, so the deck below stays reachable', () => {
    expect(noticeDragOffset({ translationX: 0, translationY: 120 })).toEqual({ x: 0, y: 0 });
    // A stroke that went up, came back down and overshot its own start.
    expect(noticeDragOffset({ translationX: -8, translationY: 40 })).toEqual({
      x: -8 * NOTICE_DRAG_FOLLOW,
      y: 0,
    });
  });
});

describe('notice swipe end', () => {
  test('a still finger and a short stroke spring back', () => {
    expect(noticeSwipeEnd(still, plate)).toEqual({ dismissed: false });
    expect(noticeSwipeEnd(swipe({ translationY: -toOffset(20) }), plate)).toEqual({
      dismissed: false,
    });
    expect(noticeSwipeEnd(swipe({ translationX: toOffset(40) }), plate)).toEqual({
      dismissed: false,
    });
  });

  test('a downward stroke never dismisses, however fast', () => {
    expect(noticeSwipeEnd(swipe({ translationY: 400, velocityY: 4000 }), plate)).toEqual({
      dismissed: false,
    });
  });

  test('rising past the threshold flies the plate off the top edge', () => {
    const under = noticeSwipeEnd(
      swipe({ translationY: -toOffset(NOTICE_DISMISS_RISE - 2) }),
      plate
    );
    expect(under).toEqual({ dismissed: false });
    const end = noticeSwipeEnd(swipe({ translationY: -toOffset(NOTICE_DISMISS_RISE + 2) }), plate);
    expect(end.dismissed).toBe(true);
    if (!end.dismissed) return;
    expect(end.y).toBe(-(plate.height + NOTICE_DISMISS_OVERSHOOT));
    expect(end.x).toBe(0);
  });

  test('sweeping past a third of the plate leaves by the side it was heading for', () => {
    const sweep = plate.width * NOTICE_DISMISS_SWEEP_RATIO;
    expect(noticeSwipeEnd(swipe({ translationX: toOffset(sweep - 2) }), plate)).toEqual({
      dismissed: false,
    });
    const right = noticeSwipeEnd(swipe({ translationX: toOffset(sweep + 2) }), plate);
    const left = noticeSwipeEnd(swipe({ translationX: -toOffset(sweep + 2) }), plate);
    expect(right).toEqual({ dismissed: true, x: plate.width + NOTICE_DISMISS_OVERSHOOT, y: 0 });
    expect(left).toEqual({ dismissed: true, x: -(plate.width + NOTICE_DISMISS_OVERSHOOT), y: 0 });
  });

  test('the sideways threshold has a floor, so a narrow plate is not a hair trigger', () => {
    const narrow = { width: 120, height: 84 };
    const under = toOffset(NOTICE_DISMISS_SWEEP_MIN - 4);
    expect(noticeSwipeEnd(swipe({ translationX: under }), narrow)).toEqual({ dismissed: false });
    const over = toOffset(NOTICE_DISMISS_SWEEP_MIN + 4);
    expect(noticeSwipeEnd(swipe({ translationX: over }), narrow).dismissed).toBe(true);
  });

  test('a throw dismisses on velocity alone, once the finger has actually moved', () => {
    const flick = swipe({
      translationY: -toOffset(NOTICE_DISMISS_MOVED + 2),
      velocityY: -NOTICE_DISMISS_VELOCITY - 1,
    });
    expect(noticeSwipeEnd(flick, plate).dismissed).toBe(true);
    // Same speed, no travel: a tap on a plate that was already settling.
    const jitter = swipe({ translationY: -1, velocityY: -NOTICE_DISMISS_VELOCITY - 1 });
    expect(noticeSwipeEnd(jitter, plate)).toEqual({ dismissed: false });
  });

  test('a diagonal throw leaves the way it was mostly going', () => {
    const acrossHarder = swipe({
      translationX: toOffset(NOTICE_DISMISS_SWEEP_MIN * 2),
      translationY: -toOffset(NOTICE_DISMISS_RISE + 2),
    });
    const end = noticeSwipeEnd(acrossHarder, plate);
    expect(end.dismissed).toBe(true);
    if (!end.dismissed) return;
    expect(end.x).toBe(plate.width + NOTICE_DISMISS_OVERSHOOT);

    const upHarder = swipe({
      translationX: toOffset(plate.width * NOTICE_DISMISS_SWEEP_RATIO + 2),
      translationY: -toOffset(NOTICE_DISMISS_RISE * 4),
    });
    const upEnd = noticeSwipeEnd(upHarder, plate);
    expect(upEnd.dismissed).toBe(true);
    if (!upEnd.dismissed) return;
    expect(upEnd.y).toBe(-(plate.height + NOTICE_DISMISS_OVERSHOOT));
  });

  test('a sideways throw with no travel bias still picks a side from its velocity', () => {
    const end = noticeSwipeEnd(
      swipe({ translationX: -toOffset(NOTICE_DISMISS_MOVED + 2), velocityX: -2000 }),
      plate
    );
    expect(end).toEqual({ dismissed: true, x: -(plate.width + NOTICE_DISMISS_OVERSHOOT), y: 0 });
  });
});
