import { describe, expect, test } from 'bun:test';
import { createHomeRefreshPause, scheduleHomeRefresh } from '@/lib/home-refresh-schedule';

function fakeTimers() {
  const intervals = new Map<number, () => void>();
  let next = 1;
  return {
    intervals,
    timers: {
      setInterval: (fn: () => void) => {
        const id = next++;
        intervals.set(id, fn);
        return id;
      },
      clearInterval: (id: number) => {
        intervals.delete(id);
      },
    },
    tick: () => [...intervals.values()].forEach((fn) => fn()),
  };
}

describe('scheduleHomeRefresh', () => {
  test('without a pause signal it refreshes now and on the interval', () => {
    const clock = fakeTimers();
    let calls = 0;
    const stop = scheduleHomeRefresh({
      intervalMs: 30_000,
      refresh: () => calls++,
      timers: clock.timers,
    });
    expect(calls).toBe(1);
    clock.tick();
    expect(calls).toBe(2);
    stop();
    expect(clock.intervals.size).toBe(0);
  });

  test('no refresh is scheduled while paused', () => {
    const clock = fakeTimers();
    const pause = createHomeRefreshPause(true);
    let calls = 0;
    const stop = scheduleHomeRefresh({
      intervalMs: 30_000,
      refresh: () => calls++,
      pause,
      timers: clock.timers,
    });
    expect(calls).toBe(0);
    expect(clock.intervals.size).toBe(0);
    clock.tick();
    expect(calls).toBe(0);
    stop();
  });

  test('pausing stops the interval; resuming refreshes once at once, then polls again', () => {
    const clock = fakeTimers();
    const pause = createHomeRefreshPause(false);
    let calls = 0;
    const stop = scheduleHomeRefresh({
      intervalMs: 30_000,
      refresh: () => calls++,
      pause,
      timers: clock.timers,
    });
    expect(calls).toBe(1);
    pause.set(true);
    expect(clock.intervals.size).toBe(0);
    clock.tick();
    expect(calls).toBe(1);
    pause.set(true);
    expect(calls).toBe(1);
    pause.set(false);
    expect(calls).toBe(2);
    expect(clock.intervals.size).toBe(1);
    clock.tick();
    expect(calls).toBe(3);
    stop();
    expect(clock.intervals.size).toBe(0);
    pause.set(true);
    pause.set(false);
    expect(calls).toBe(3);
  });
});
