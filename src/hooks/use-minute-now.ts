import { useSyncExternalStore } from 'react';
import { AppState, type NativeEventSubscription } from 'react-native';

/**
 * One shared clock for relative-time labels: "Seen just now", "4m ago".
 *
 * Those labels change once a minute at most, so they read a clock that moves
 * once a minute, and only the components that draw one subscribe to it. A
 * ticking `nowMs` held by a screen re-rendered the whole screen to change one
 * label. One timer serves every subscriber; it runs while anything is
 * subscribed and the app is in the foreground, and catches up on the way back.
 */
const MINUTE_MS = 60_000;

let nowMs = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;
let appState: NativeEventSubscription | null = null;
const listeners = new Set<() => void>();

function tick(): void {
  nowMs = Date.now();
  for (const listener of [...listeners]) listener();
}

function run(): void {
  if (timer) return;
  if (AppState.currentState !== 'active') return;
  tick();
  timer = setInterval(tick, MINUTE_MS);
}

function stop(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    appState = AppState.addEventListener('change', (next) => (next === 'active' ? run() : stop()));
    run();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    stop();
    appState?.remove();
    appState = null;
  };
}

/**
 * While nothing is subscribed the clock is not ticking, so the first reader
 * after a quiet spell would paint with a stale minute (the catch-up `tick` in
 * `subscribe` lands only after paint). Advance it here instead; within a
 * minute two reads still agree, as `useSyncExternalStore` requires.
 */
const read = () => {
  if (timer === null && Date.now() - nowMs >= MINUTE_MS) nowMs = Date.now();
  return nowMs;
};

/**
 * The time, to the minute, for a label that says how long ago something was.
 * `floorMs` is a newer instant the caller already holds (a screen's own
 * freshness clock), so the answer is never older than what the parent drew.
 */
export function useMinuteNow(floorMs = 0): number {
  return Math.max(useSyncExternalStore(subscribe, read, read), floorMs);
}
