import { describe, expect, test } from 'bun:test';

import {
  initialPaneReadState,
  paneReadStep,
  type PaneReadEvent,
  type PaneReadState,
} from '../pane-read-scheduler';

const TIMING = { minGapMs: 1_000, pollMs: 4_500, stuckMs: 10_000 };

/** Drives the step function the way the hook does: one timer, reads it starts. */
function harness() {
  let state: PaneReadState = initialPaneReadState();
  let wakeAtMs: number | undefined;
  const reads: number[] = [];
  const send = (event: PaneReadEvent, nowMs: number) => {
    const plan = paneReadStep(state, event, nowMs, TIMING);
    state = plan.state;
    wakeAtMs = plan.wakeAtMs;
    if (plan.read !== undefined) reads.push(nowMs);
  };
  /** Fire the pending tick while it is due by `untilMs`. */
  const runUntil = (untilMs: number) => {
    while (wakeAtMs !== undefined && wakeAtMs <= untilMs) send({ type: 'tick' }, wakeAtMs);
  };
  /** Settle the read in flight. */
  const settle = (nowMs: number) => {
    const id = state.reading?.id;
    if (id !== undefined) send({ type: 'settled', id }, nowMs);
  };
  return {
    send,
    runUntil,
    settle,
    reads,
    get state() {
      return state;
    },
    get wakeAtMs() {
      return wakeAtMs;
    },
  };
}

describe('paneReadStep', () => {
  test('reads at once, then not at all while the screen streams', () => {
    const h = harness();
    h.send({ type: 'tick' }, 0);
    expect(h.reads).toEqual([0]);
    h.send({ type: 'streaming', on: true }, 100);
    h.settle(200);
    expect(h.wakeAtMs).toBeUndefined();
    h.send({ type: 'changed' }, 5_000);
    h.send({ type: 'connected' }, 6_000);
    h.runUntil(60_000);
    expect(h.reads).toEqual([0]);
  });

  test('frames stopping resumes reading: a catch-up read, then the poll', () => {
    const h = harness();
    h.send({ type: 'tick' }, 0);
    h.send({ type: 'streaming', on: true }, 50);
    h.settle(100);
    h.send({ type: 'streaming', on: false }, 30_000);
    expect(h.reads).toEqual([0, 30_000]);
    h.settle(30_100);
    h.runUntil(34_500);
    expect(h.reads).toEqual([0, 30_000, 34_500]);
  });

  test('hints are coalesced: one read at a time, at least a gap apart', () => {
    const h = harness();
    for (let now = 0; now < 10_000; now += 80) {
      h.runUntil(now);
      h.send({ type: 'changed' }, now);
      const inFlight = h.state.reading;
      if (inFlight && now - inFlight.startedAtMs >= 250) h.settle(now);
    }
    for (let i = 1; i < h.reads.length; i += 1)
      expect(h.reads[i]! - h.reads[i - 1]!).toBeGreaterThanOrEqual(1_000);
    expect(h.reads.length).toBeGreaterThanOrEqual(9);
    expect(h.reads.length).toBeLessThanOrEqual(11);
  });

  test('a hint heard during a read is not lost', () => {
    const h = harness();
    h.send({ type: 'tick' }, 0);
    h.send({ type: 'changed' }, 100);
    h.send({ type: 'changed' }, 200);
    expect(h.reads).toEqual([0]);
    // Past the gap already: the coalesced read starts as the first settles.
    h.settle(1_500);
    expect(h.reads).toEqual([0, 1_500]);
  });

  test('the poll never stops while the screen does not stream', () => {
    const h = harness();
    h.send({ type: 'connected' }, 0);
    h.settle(100);
    h.send({ type: 'changed' }, 2_000);
    h.settle(2_100);
    // Herdr's hints can stand still for minutes while the pane prints.
    h.runUntil(6_500);
    expect(h.reads).toEqual([0, 2_000, 6_500]);
  });

  test('a read that never settles is given up, and its late answer changes nothing', () => {
    const h = harness();
    h.send({ type: 'tick' }, 0);
    h.send({ type: 'changed' }, 500);
    h.runUntil(9_999);
    expect(h.reads).toEqual([0]);
    h.runUntil(10_000);
    expect(h.reads).toEqual([0, 10_000]);
    h.send({ type: 'settled', id: 1 }, 10_100);
    expect(h.state.reading?.id).toBe(2);
    expect(h.state.latest).toBe(2);
    h.send({ type: 'changed' }, 10_200);
    expect(h.reads).toEqual([0, 10_000]);
  });
});
