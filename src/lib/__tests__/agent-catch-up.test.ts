import { describe, expect, test } from 'bun:test';

import {
  advanceSeq,
  askCatchUp,
  CATCH_UP_START,
  snapshotSettled,
  type CatchUpState,
} from '../agent-catch-up';

describe('advanceSeq', () => {
  test('raises the marker, and never lowers it', () => {
    const at12 = advanceSeq(CATCH_UP_START, 12);
    expect(at12.seq).toBe(12);
    // A snapshot taken at 9 answering after a frame at 12 is the case that was
    // walking the marker backwards.
    expect(advanceSeq(at12, 9).seq).toBe(12);
    expect(advanceSeq(at12, 12).seq).toBe(12);
    expect(advanceSeq(at12, 13).seq).toBe(13);
  });

  test('an unreadable sequence leaves it alone', () => {
    const at12 = advanceSeq(CATCH_UP_START, 12);
    expect(advanceSeq(at12, Number.NaN).seq).toBe(12);
    expect(advanceSeq(at12, Number.POSITIVE_INFINITY).seq).toBe(12);
    expect(advanceSeq(CATCH_UP_START, -1).seq).toBe(0);
  });

  test('the same state comes back unchanged, so a ref write is a no-op', () => {
    const at12 = advanceSeq(CATCH_UP_START, 12);
    expect(advanceSeq(at12, 5)).toBe(at12);
  });

  test('the debt survives a sequence bump', () => {
    const owed: CatchUpState = { seq: 0, owed: true };
    expect(advanceSeq(owed, 4)).toEqual({ seq: 4, owed: true });
  });
});

describe('askCatchUp', () => {
  test('asks from the highest sequence seen', () => {
    const asked = askCatchUp({ seq: 12, owed: false });
    expect(asked.from).toBe(12);
    expect(asked.state).toEqual({ seq: 12, owed: false });
  });

  test('asking with nothing to ask from leaves a debt instead of nothing', () => {
    const asked = askCatchUp(CATCH_UP_START);
    expect(asked.from).toBeNull();
    expect(asked.state).toEqual({ seq: 0, owed: true });
  });

  test('a debt that can be paid now is paid now', () => {
    const asked = askCatchUp({ seq: 7, owed: true });
    expect(asked.from).toBe(7);
    expect(asked.state).toEqual({ seq: 7, owed: false });
  });
});

describe('snapshotSettled', () => {
  test('the snapshot raises the marker and owes nothing by itself', () => {
    const settled = snapshotSettled(CATCH_UP_START, 42);
    expect(settled.state).toEqual({ seq: 42, owed: false });
    expect(settled.from).toBeNull();
  });

  test('a catch-up asked for before the snapshot runs once it lands', () => {
    // The order entering a session actually takes: the stream connects, asks,
    // and only then does the snapshot answer.
    const { state: afterAsk, from: nothing } = askCatchUp(CATCH_UP_START);
    expect(nothing).toBeNull();
    const settled = snapshotSettled(afterAsk, 42);
    expect(settled.from).toBe(42);
    expect(settled.state).toEqual({ seq: 42, owed: false });
    // And once only: a second snapshot does not re-run it.
    expect(snapshotSettled(settled.state, 43).from).toBeNull();
  });

  test('a late snapshot pays the debt from where the stream had reached', () => {
    const streamed = advanceSeq(CATCH_UP_START, 50);
    const { state: owed } = askCatchUp({ ...streamed, seq: 0 });
    const settled = snapshotSettled({ seq: 50, owed: owed.owed }, 20);
    expect(settled.state.seq).toBe(50);
    expect(settled.from).toBe(50);
  });
});
