// The chrome's clock: out on open, away a few seconds after it was last used,
// and never moved by anything the device was told. The clock is a fake that
// fires when told, as in the session tests.
import { describe, expect, test } from 'bun:test';

import {
  recallSimfarmChrome,
  rememberSimfarmChrome,
  SIMFARM_CHROME_TIMEOUT_MS,
  SimfarmChrome,
  simfarmChromeTransition,
} from '@/lib/simfarm-chrome';

class FakeClock {
  private readonly pending = new Map<number, { run: () => void; ms: number }>();
  private next = 1;
  schedule = (run: () => void, ms: number): (() => void) => {
    const id = this.next++;
    this.pending.set(id, { run, ms });
    return () => {
      this.pending.delete(id);
    };
  };
  armed(): number {
    return this.pending.size;
  }
  delays(): number[] {
    return [...this.pending.values()].map((entry) => entry.ms);
  }
  elapse(): void {
    const due = [...this.pending.values()];
    this.pending.clear();
    for (const entry of due) entry.run();
  }
}

function open(options: { shown?: boolean } = {}) {
  const clock = new FakeClock();
  const seen: boolean[] = [];
  const chrome = new SimfarmChrome({ shown: options.shown, schedule: clock.schedule });
  chrome.subscribe((shown) => seen.push(shown));
  return { chrome, clock, seen };
}

describe('coming out and going away', () => {
  test('starts out, with the countdown running', () => {
    const { chrome, clock } = open();
    expect(chrome.isShown).toBe(true);
    expect(clock.armed()).toBe(1);
    expect(clock.delays()).toEqual([SIMFARM_CHROME_TIMEOUT_MS]);
  });

  test('the countdown puts it away, once', () => {
    const { chrome, clock, seen } = open();
    clock.elapse();
    expect(chrome.isShown).toBe(false);
    expect(seen).toEqual([false]);
    // Nothing is armed while it is away: there is nothing left to hide.
    expect(clock.armed()).toBe(0);
  });

  test('the handle brings it back, and the countdown starts again', () => {
    const { chrome, clock, seen } = open();
    clock.elapse();
    chrome.toggle();
    expect(chrome.isShown).toBe(true);
    expect(clock.armed()).toBe(1);
    clock.elapse();
    expect(seen).toEqual([false, true, false]);
  });

  test('the handle puts it away early, and disarms the countdown', () => {
    const { chrome, clock } = open();
    chrome.toggle();
    expect(chrome.isShown).toBe(false);
    expect(clock.armed()).toBe(0);
  });

  test('can start away, when that is how the reader left it', () => {
    const { chrome, clock } = open({ shown: false });
    expect(chrome.isShown).toBe(false);
    expect(clock.armed()).toBe(0);
  });
});

describe('what restarts the countdown', () => {
  test('using a control does', () => {
    const { chrome, clock } = open();
    const first = clock.delays();
    chrome.touched();
    // One timer, not two: the old one was cancelled rather than joined.
    expect(clock.armed()).toBe(1);
    expect(clock.delays()).toEqual(first);
    clock.elapse();
    expect(chrome.isShown).toBe(false);
  });

  test('pressing the handle while it is already out does too', () => {
    const { chrome, clock, seen } = open();
    chrome.show();
    expect(chrome.isShown).toBe(true);
    expect(clock.armed()).toBe(1);
    // Nothing changed, so nobody is told.
    expect(seen).toEqual([]);
  });

  test('a touch while it is away does not bring it back', () => {
    // The device's touches never reach this; the one thing that could is a
    // control that is no longer on screen, and that is a no-op on purpose.
    const { chrome, clock } = open({ shown: false });
    chrome.touched();
    expect(chrome.isShown).toBe(false);
    expect(clock.armed()).toBe(0);
  });
});

describe('holding it out', () => {
  test('an open picker stops the clock, and closing it starts it over', () => {
    const { chrome, clock } = open();
    chrome.hold(true);
    expect(clock.armed()).toBe(0);
    chrome.hold(false);
    expect(clock.armed()).toBe(1);
    clock.elapse();
    expect(chrome.isShown).toBe(false);
  });

  test('showing it while held does not arm a countdown', () => {
    const { chrome, clock } = open({ shown: false });
    chrome.hold(true);
    chrome.toggle();
    expect(chrome.isShown).toBe(true);
    expect(clock.armed()).toBe(0);
  });

  test('holding twice is holding once', () => {
    const { chrome, clock } = open();
    chrome.hold(true);
    chrome.hold(true);
    chrome.hold(false);
    expect(clock.armed()).toBe(1);
  });

  test('dispose lets go of the timer', () => {
    const { chrome, clock } = open();
    chrome.dispose();
    expect(clock.armed()).toBe(0);
  });
});

describe('the transition', () => {
  test('slides over the short token by default', () => {
    expect(simfarmChromeTransition(false)).toEqual({ duration: 'short', slide: true });
  });

  test('with motion reduced it fades in place, and still fades', () => {
    expect(simfarmChromeTransition(true)).toEqual({ duration: 'micro', slide: false });
  });
});

describe('memory', () => {
  test('is out until told otherwise, and remembers only for the process', () => {
    expect(recallSimfarmChrome()).toBe(true);
    rememberSimfarmChrome(false);
    expect(recallSimfarmChrome()).toBe(false);
    rememberSimfarmChrome(true);
    expect(recallSimfarmChrome()).toBe(true);
  });
});
