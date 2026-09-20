import { describe, expect, test } from 'bun:test';

import { createTranscriptFollow } from '../transcript-follow';

/** A viewport 800 tall onto 5000 of content, scrolled to `offset`. */
function at(offset: number) {
  return { offset, viewport: 800, content: 5000 };
}

const BOTTOM = at(4200);
const AWAY = at(1000);

describe('createTranscriptFollow', () => {
  test('starts level with the end, with nothing to offer', () => {
    const follow = createTranscriptFollow();
    expect(follow.getSnapshot()).toEqual({ atBottom: true, unseen: 0, visible: false });
  });

  test('scrolling away is not by itself a reason to show the way back', () => {
    const follow = createTranscriptFollow();
    follow.setGeometry(AWAY);
    expect(follow.getSnapshot()).toEqual({ atBottom: false, unseen: 0, visible: false });
  });

  test('rows landing under the reader are counted and offered', () => {
    const follow = createTranscriptFollow();
    follow.setMark({ rows: 10, seq: 10 });
    follow.setGeometry(AWAY);
    follow.setMark({ rows: 13, seq: 13 });
    expect(follow.getSnapshot()).toEqual({ atBottom: false, unseen: 3, visible: true });
  });

  test('a row that only grew counts as one thing to go and see', () => {
    const follow = createTranscriptFollow();
    follow.setMark({ rows: 10, seq: 10 });
    follow.setGeometry(AWAY);
    follow.setMark({ rows: 10, seq: 44 });
    expect(follow.getSnapshot().unseen).toBe(1);
  });

  test('reaching the end clears the count without a tap', () => {
    const follow = createTranscriptFollow();
    follow.setMark({ rows: 10, seq: 10 });
    follow.setGeometry(AWAY);
    follow.setMark({ rows: 20, seq: 20 });
    expect(follow.getSnapshot().visible).toBe(true);
    follow.setGeometry(BOTTOM);
    expect(follow.getSnapshot()).toEqual({ atBottom: true, unseen: 0, visible: false });
  });

  test('output arriving while the reader is at the end never offers anything', () => {
    const follow = createTranscriptFollow();
    follow.setGeometry(BOTTOM);
    for (let seq = 1; seq <= 50; seq++) follow.setMark({ rows: seq, seq });
    expect(follow.getSnapshot().visible).toBe(false);
  });

  test('reset forgets what was waiting -- a new session, or a deliberate jump', () => {
    const follow = createTranscriptFollow();
    follow.setMark({ rows: 10, seq: 10 });
    follow.setGeometry(AWAY);
    follow.setMark({ rows: 30, seq: 30 });
    expect(follow.getSnapshot().visible).toBe(true);
    follow.reset();
    expect(follow.getSnapshot()).toEqual({ atBottom: true, unseen: 0, visible: false });
  });

  describe('as a `useSyncExternalStore` source', () => {
    test('an unchanged answer is the same object, not an equal one', () => {
      const follow = createTranscriptFollow();
      const first = follow.getSnapshot();
      follow.setGeometry(BOTTOM);
      follow.setGeometry(at(4300));
      expect(follow.getSnapshot()).toBe(first);
    });

    test('a drag that does not change the answer notifies nobody', () => {
      const follow = createTranscriptFollow();
      let notifications = 0;
      follow.subscribe(() => {
        notifications++;
      });
      // Sixty frames of a drag that never leaves the end.
      for (let frame = 0; frame < 60; frame++) follow.setGeometry(at(4200 + frame));
      expect(notifications).toBe(0);
    });

    test('a drag that does change the answer notifies exactly once', () => {
      const follow = createTranscriptFollow();
      follow.setMark({ rows: 10, seq: 10 });
      let notifications = 0;
      follow.subscribe(() => {
        notifications++;
      });
      for (let frame = 0; frame < 30; frame++) follow.setGeometry(at(4200 - frame * 100));
      expect(notifications).toBe(1);
      expect(follow.getSnapshot().atBottom).toBe(false);
    });

    test('unsubscribing stops the notifications', () => {
      const follow = createTranscriptFollow();
      let notifications = 0;
      const unsubscribe = follow.subscribe(() => {
        notifications++;
      });
      follow.setGeometry(AWAY);
      expect(notifications).toBe(1);
      unsubscribe();
      follow.setGeometry(BOTTOM);
      expect(notifications).toBe(1);
    });
  });
});
