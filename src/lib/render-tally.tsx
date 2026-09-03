/**
 * Render accounting for a screen, in development, when asked for.
 *
 * Card #678 asked for the settings page to be made faster and for the claim to
 * be *measured* rather than felt. "It feels snappier" is not evidence, and a
 * profiler session on a simulator is not something the next person can repeat.
 * This is the repeatable version: start Metro with the flag, drive the screen,
 * and read the numbers out of the packager log.
 *
 *     EXPO_PUBLIC_RENDER_TALLY=1 bun expo start
 *
 * Without the flag every export here is inert -- `useRenderTally` is a hook
 * that registers an effect which returns immediately, and `RenderTally` is its
 * children. The flag is read through `process.env.EXPO_PUBLIC_*`, which Metro
 * inlines at build time, so a production bundle has a literal `false` here and
 * drops the rest.
 *
 * Two numbers come out, and they answer different questions:
 *
 * - React's own `Profiler` reports `actualDuration` per commit -- how long the
 *   subtree took to render, in milliseconds. That is the cost of *opening* the
 *   page.
 * - The per-component tally says which components ran, and how many times. That
 *   is the cost of *touching* the page: a settings screen where flipping one
 *   switch re-renders thirty-two theme cards and nine language rows is paying for
 *   sections nobody asked about.
 *
 * Counting happens in an effect rather than in the render body, so this module
 * never makes a render impure and never trips `react-hooks/purity`. An effect
 * runs once per commit of its component, which is exactly the quantity being
 * counted: a component React bails out of does not commit and is not counted.
 */
import { Profiler, useEffect, type ReactNode } from 'react';

/**
 * Whether any of this does anything. `__DEV__` as well as the flag, so a
 * mistyped environment in a release build still cannot ship the timers.
 */
export const RENDER_TALLY_ENABLED = __DEV__ && process.env.EXPO_PUBLIC_RENDER_TALLY === '1';

/**
 * How long after the last render the report is printed.
 *
 * One interaction is many commits -- a store write, a persisted read, a layout
 * animation settling -- and printing per commit would bury the total in the
 * noise it is meant to summarise. So renders accumulate into one window and the
 * window closes when the screen goes quiet, which makes one tap produce one
 * line. Long enough to swallow a settle, short enough that two deliberate taps
 * do not merge.
 */
const QUIET_MS = 700;

type Window = {
  renders: Map<string, number>;
  commits: number;
  /**
   * The window's first commit, on its own.
   *
   * This is the number that matters for opening a screen: it is the work a
   * reader waits through before anything is on the glass. The total below adds
   * whatever the page does afterwards to settle, which they never experience as
   * a delay -- so a change that only moves work *off* the first frame shows up
   * here and nowhere else.
   */
  firstMs: number;
  /** Every commit in the window, added up. */
  totalMs: number;
};

let open: Window | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function window(): Window {
  open ??= { renders: new Map(), commits: 0, firstMs: 0, totalMs: 0 };
  return open;
}

function schedule() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(flush, QUIET_MS);
}

function flush() {
  timer = null;
  const current = open;
  open = null;
  if (!current) return;

  const components = [...current.renders.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => `${name}×${count}`)
    .join(' ');
  const total = [...current.renders.values()].reduce((sum, count) => sum + count, 0);

  console.log(
    `[render-tally] commits=${current.commits} first=${current.firstMs.toFixed(1)}ms ` +
      `total=${current.totalMs.toFixed(1)}ms renders=${total} | ${components}`
  );
}

/**
 * Count one component's commits under whichever name it gives.
 *
 * Called unconditionally -- the flag is checked inside the effect, not around
 * the hook -- because a hook behind a condition is a hook that changes order
 * between builds.
 */
export function useRenderTally(name: string): void {
  useEffect(() => {
    if (!RENDER_TALLY_ENABLED) return;
    const current = window();
    current.renders.set(name, (current.renders.get(name) ?? 0) + 1);
    schedule();
  });
}

/**
 * Wraps a subtree in React's profiler so its commits are timed.
 */
export function RenderTally({ id, children }: { id: string; children: ReactNode }) {
  if (!RENDER_TALLY_ENABLED) return children;
  return (
    <Profiler
      id={id}
      onRender={(_id, _phase, actualDuration) => {
        const current = window();
        if (current.commits === 0) current.firstMs = actualDuration;
        current.commits += 1;
        current.totalMs += actualDuration;
        schedule();
      }}>
      {children}
    </Profiler>
  );
}
