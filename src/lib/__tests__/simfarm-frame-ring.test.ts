// The frames kept alive behind the one on screen.
//
// The property pinned here is ordering: a frame is handed back for disposal
// only once `depth` newer frames have been pushed after it, and never in any
// other order than oldest first. The defect this exists for is the picture
// going blank while the state says `live`, which is what disposing a frame
// before the UI runtime has recorded it looks like -- and it looks like
// nothing else, so the arithmetic is pinned on its own.
import { describe, expect, test } from 'bun:test';

import { SimfarmFrameRing } from '@/lib/simfarm-frame-ring';

describe('a ring of three', () => {
  test('hands nothing back while it is filling', () => {
    const ring = new SimfarmFrameRing<string>(3);
    expect(ring.push('a')).toBeNull();
    expect(ring.push('b')).toBeNull();
    expect(ring.push('c')).toBeNull();
    expect(ring.size).toBe(3);
  });

  test('hands back the frame exactly three behind the newest, oldest first', () => {
    const ring = new SimfarmFrameRing<string>(3);
    ring.push('a');
    ring.push('b');
    ring.push('c');
    expect(ring.push('d')).toBe('a');
    expect(ring.push('e')).toBe('b');
    expect(ring.push('f')).toBe('c');
    expect(ring.size).toBe(3);
  });

  test('every frame ever pushed comes back exactly once, in push order', () => {
    const ring = new SimfarmFrameRing<number>(3);
    const out: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const stale = ring.push(i);
      if (stale !== null) out.push(stale);
    }
    out.push(...ring.drain());
    expect(out).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });

  test('a frame is never handed back before three newer ones were pushed', () => {
    const ring = new SimfarmFrameRing<number>(3);
    for (let i = 0; i < 50; i += 1) {
      const stale = ring.push(i);
      if (stale !== null) expect(i - stale).toBe(3);
    }
  });
});

describe('draining', () => {
  test('returns everything held, oldest first, and holds nothing after', () => {
    const ring = new SimfarmFrameRing<string>(3);
    ring.push('a');
    ring.push('b');
    expect(ring.drain()).toEqual(['a', 'b']);
    expect(ring.size).toBe(0);
    expect(ring.drain()).toEqual([]);
  });

  test('a drained ring fills again from empty', () => {
    const ring = new SimfarmFrameRing<string>(2);
    ring.push('a');
    ring.push('b');
    ring.drain();
    expect(ring.push('c')).toBeNull();
    expect(ring.push('d')).toBeNull();
    expect(ring.push('e')).toBe('c');
  });
});

describe('the depth', () => {
  test('one is the least a ring may keep', () => {
    const ring = new SimfarmFrameRing<string>(1);
    expect(ring.push('a')).toBeNull();
    expect(ring.push('b')).toBe('a');
    expect(() => new SimfarmFrameRing<string>(0)).toThrow(/at least one frame/);
  });
});
