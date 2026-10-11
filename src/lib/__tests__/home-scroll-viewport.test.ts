import { describe, expect, test } from 'bun:test';
import { homeScrollViewportBottom } from '@/lib/home-scroll-viewport';

describe('Home scrolling foreground clearance', () => {
  test('clears the complete measured dock, including its outer gutter and decoration', () => {
    expect(homeScrollViewportBottom(224, 0, 0, 800)).toBe(224);
  });

  test('reveals the page in step with a hiding dock', () => {
    expect(homeScrollViewportBottom(224, 80, 0, 800)).toBe(144);
    expect(homeScrollViewportBottom(224, 224, 0, 800)).toBe(0);
  });

  test('follows the keyboard without shrinking the underlying scroll range', () => {
    expect(homeScrollViewportBottom(200, 0, -300, 800)).toBe(500);
    expect(homeScrollViewportBottom(200, 0, -100, 800)).toBe(300);
  });

  test('leaves the full viewport for unpaired Home and the two-column Pad layout', () => {
    expect(homeScrollViewportBottom(0, 0, -300, 800)).toBe(0);
  });

  test('clamps transition frames and small windows to valid viewport bounds', () => {
    expect(homeScrollViewportBottom(224, 240, 0, 800)).toBe(0);
    expect(homeScrollViewportBottom(224, 0, -400, 500)).toBe(500);
    expect(homeScrollViewportBottom(224, 0, 0, 0)).toBe(0);
  });
});
