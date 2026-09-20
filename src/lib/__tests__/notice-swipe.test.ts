import { expect, test } from 'bun:test';
import { noticeDragOffset, noticeSwipeEnd, type NoticeSwipe } from '../notice-swipe';
const swipe = (parts: Partial<NoticeSwipe>): NoticeSwipe => ({
  translationX: 0,
  translationY: 0,
  velocityX: 0,
  velocityY: 0,
  ...parts,
});

test('a gentle twelve-point brush dismisses up or sideways', () => {
  expect(noticeSwipeEnd(swipe({ translationY: -12 }))).toEqual({ dismissed: true, x: 0, y: -28 });
  expect(noticeSwipeEnd(swipe({ translationX: 12 }))).toEqual({ dismissed: true, x: 28, y: 0 });
  expect(noticeSwipeEnd(swipe({ translationX: -12 }))).toEqual({ dismissed: true, x: -28, y: 0 });
});
test('taps and small tremors do not dismiss even with spurious velocity', () => {
  expect(noticeSwipeEnd(swipe({}))).toEqual({ dismissed: false });
  expect(noticeSwipeEnd(swipe({ translationY: -5, velocityY: -2000 }))).toEqual({
    dismissed: false,
  });
  expect(noticeSwipeEnd(swipe({ translationX: 11 }))).toEqual({ dismissed: false });
});
test('a short intentional flick works without a long drag', () => {
  expect(noticeSwipeEnd(swipe({ translationY: -6, velocityY: -300 })).dismissed).toBe(true);
  expect(noticeSwipeEnd(swipe({ translationX: 6, velocityX: 300 })).dismissed).toBe(true);
});
test('downward movement remains available for reaching the next card', () => {
  expect(noticeDragOffset({ translationX: 0, translationY: 400 })).toEqual({ x: 0, y: 0 });
  expect(noticeSwipeEnd(swipe({ translationY: 400, velocityY: 4000 }))).toEqual({
    dismissed: false,
  });
});
test('long drags cannot carry the card into the status bar or offscreen', () => {
  expect(noticeDragOffset({ translationX: 1000, translationY: -1000 })).toEqual({ x: 24, y: -24 });
  expect(noticeDragOffset({ translationX: -1000, translationY: 0 })).toEqual({ x: -24, y: 0 });
  expect(noticeDragOffset({ translationX: 10, translationY: -10 })).toEqual({ x: 5, y: -5 });
  expect(noticeSwipeEnd(swipe({ translationY: -1000, velocityY: -5000 }))).toEqual({
    dismissed: true,
    x: 0,
    y: -28,
  });
});
test('diagonal gestures finish along their dominant direction', () => {
  expect(noticeSwipeEnd(swipe({ translationX: 20, translationY: -40 }))).toEqual({
    dismissed: true,
    x: 10,
    y: -28,
  });
});
