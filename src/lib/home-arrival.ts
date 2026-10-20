/**
 * When Home has arrived on screen, for a theme change that lands there.
 *
 * Applying a theme from the editor or the file viewer goes home under the
 * reskin cover, and the cover lifts only once Home is the screen underneath
 * it: its artwork registers for `waitForThemeRender` only while Home is
 * focused, and a reveal that starts while the stack is still rearranging
 * itself shows the rearranging. Home announces the end of its own appearing
 * transition (`useAnnounceHomeArrival` in `app/index.tsx`); the screen that is
 * leaving cannot, because by then it has gone.
 *
 * Armed before the navigation is dispatched, so an arrival that lands in the
 * same frame is not missed. A cap stands in where no event comes (a navigator
 * that emits none, a dismissal that lands somewhere else), so the cover is
 * never held hostage.
 */
export const HOME_ARRIVAL_CAP_MS = 800;

const waiters = new Set<() => void>();

/** Home's appearing transition has ended. */
export function announceHomeArrival(): void {
  for (const waiter of [...waiters]) waiter();
}

export function waitForHomeArrival(capMs: number = HOME_ARRIVAL_CAP_MS): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      waiters.delete(finish);
      resolve();
    };
    const timer = setTimeout(finish, capMs);
    waiters.add(finish);
  });
}

/** Go home and resolve once Home has arrived, or at the cap. */
export function goHomeAndWait(router: { dismissTo: (href: '/') => void }): Promise<void> {
  const arrived = waitForHomeArrival();
  router.dismissTo('/');
  return arrived;
}
