import { describe, expect, it } from 'bun:test';

import {
  TERMINAL_SWEEP_BATCH,
  TerminalPictureCache,
  freeRecording,
} from '@/terminal/picture-cache';

/**
 * A display list that records what was done to it.
 *
 * `disposed` counts rather than flags, because "freed twice" is a distinct
 * failure from "freed once" even though the native side survives both: the
 * second free means a reference outlived the first, and a reference that
 * outlives a free is what reaches a canvas.
 */
function recording(id: string) {
  return {
    id,
    disposed: 0,
    dispose() {
      this.disposed += 1;
    },
  };
}

type Recording = ReturnType<typeof recording>;

/** Every recording that has been freed, in the order it was freed. */
function freed(all: Recording[]): string[] {
  return all.filter((item) => item.disposed > 0).map((item) => item.id);
}

describe('the render phase', () => {
  it('only ever adds -- a render frees nothing', () => {
    const cache = new TerminalPictureCache<Recording>();
    const first = recording('a');
    const second = recording('b');

    cache.add('key-a', first);
    cache.add('key-b', second);

    expect(cache.size).toBe(2);
    expect(cache.retiredCount).toBe(0);
    expect(freed([first, second])).toEqual([]);
  });

  it('hands the same recording to two blocks holding the same rows', () => {
    const cache = new TerminalPictureCache<Recording>();
    const shared = recording('shared');
    const duplicate = recording('duplicate');

    expect(cache.add('key', shared)).toBe(shared);
    // The renderer asks first and records only on a miss, but a duplicate key
    // inside one frame must resolve to one recording either way.
    expect(cache.add('key', duplicate)).toBe(shared);
    expect(cache.get('key')).toBe(shared);
    // The loser is queued, never freed on the spot: the winner may be on screen.
    expect(duplicate.disposed).toBe(0);
    expect(cache.retiredCount).toBe(1);
  });

  it('leaves a discarded render`s recording for the next commit to retire', () => {
    const cache = new TerminalPictureCache<Recording>();
    const committed = recording('committed');
    const speculative = recording('speculative');

    cache.add('committed', committed);
    // A render React threw away: it recorded a block nothing went on to draw.
    cache.add('speculative', speculative);

    // The commit is the only thing that decides, and it decides from the frame
    // that was actually committed.
    cache.retain(['committed']);
    cache.sweep(TERMINAL_SWEEP_BATCH);

    expect(cache.get('committed')).toBe(committed);
    expect(committed.disposed).toBe(0);
    expect(speculative.disposed).toBe(1);
  });
});

describe('a commit', () => {
  it('keeps exactly the blocks the committed frame drew', () => {
    const cache = new TerminalPictureCache<Recording>();
    const head = recording('head');
    const body = recording('body');
    const tail = recording('tail');
    cache.add('head', head);
    cache.add('body', body);
    cache.add('tail', tail);

    // The stream appended a row: the head and body survive at new offsets, the
    // tail was re-recorded under a new key. This is #626's whole promise.
    const nextTail = recording('tail-2');
    cache.add('tail-2', nextTail);
    cache.retain(['head', 'body', 'tail-2']);

    expect(cache.size).toBe(3);
    expect(cache.get('head')).toBe(head);
    expect(cache.get('body')).toBe(body);
    expect(cache.retiredCount).toBe(1);
  });

  it('never frees during the commit itself', () => {
    const cache = new TerminalPictureCache<Recording>();
    const superseded = recording('superseded');
    cache.add('gone', superseded);

    cache.retain([]);

    // A frame's worth of defer belongs between here and the free: the scene the
    // retirement replaced may still be drawing it.
    expect(superseded.disposed).toBe(0);
    expect(cache.retiredCount).toBe(1);
  });

  it('retires nothing when the frame drew everything it holds', () => {
    const cache = new TerminalPictureCache<Recording>();
    const only = recording('only');
    cache.add('only', only);

    cache.retain(['only']);
    cache.retain(['only']);

    expect(cache.retiredCount).toBe(0);
    expect(cache.get('only')).toBe(only);
  });
});

describe('the sweep', () => {
  it('frees a batch per call and leaves the rest queued', () => {
    const cache = new TerminalPictureCache<Recording>();
    const all = Array.from({ length: 20 }, (_, index) => recording(`r${index}`));
    all.forEach((item, index) => cache.add(`k${index}`, item));

    cache.retain([]);
    expect(cache.retiredCount).toBe(20);

    expect(cache.sweep(TERMINAL_SWEEP_BATCH)).toBe(8);
    expect(cache.retiredCount).toBe(12);
    expect(freed(all)).toHaveLength(8);

    cache.sweep(TERMINAL_SWEEP_BATCH);
    cache.sweep(TERMINAL_SWEEP_BATCH);
    expect(cache.retiredCount).toBe(0);
    expect(freed(all)).toHaveLength(20);
  });

  it('frees each retired recording exactly once, however often it runs', () => {
    const cache = new TerminalPictureCache<Recording>();
    const one = recording('one');
    cache.add('one', one);
    cache.retain([]);

    cache.sweep(TERMINAL_SWEEP_BATCH);
    cache.sweep(TERMINAL_SWEEP_BATCH);
    cache.sweep(TERMINAL_SWEEP_BATCH);

    expect(one.disposed).toBe(1);
  });

  it('never reaches a live block', () => {
    const cache = new TerminalPictureCache<Recording>();
    const live = recording('live');
    cache.add('live', live);

    cache.sweep(TERMINAL_SWEEP_BATCH);

    expect(live.disposed).toBe(0);
    expect(cache.get('live')).toBe(live);
  });
});

describe('freeRecording', () => {
  it('is a no-op on nothing', () => {
    expect(() => freeRecording(null)).not.toThrow();
    expect(() => freeRecording(undefined)).not.toThrow();
  });

  it('survives an object whose native class never exported dispose', () => {
    // react-native-skia declares dispose() on every type from a shared base but
    // installs it one class at a time; JsiSkParagraphBuilder is the one that
    // does not have it, and a bare call there is a TypeError at runtime.
    expect(() => freeRecording({} as { dispose?: () => void })).not.toThrow();
  });
});
