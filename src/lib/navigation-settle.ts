/**
 * When a screen that was just dismissed has finished leaving.
 *
 * A theme change closes the screen it was chosen on under the reskin cover,
 * and the cover must not lift until that dismissal has come to rest: the
 * wash and a stack transition running together is the stutter the reader
 * sees. Native stacks announce the end of a transition on the leaving
 * screen's own navigation object; a cap stands in where no such event comes
 * (a screen closed without animation, a navigator that does not emit one),
 * so the cover can never be held hostage.
 */
export const NAVIGATION_SETTLE_CAP_MS = 450;

/**
 * The one method this needs of a navigation object. Typed by shape rather
 * than by React Navigation's prop: expo-router's `useNavigation()` names its
 * events from the root param map, where the native stack's `transitionEnd`
 * does not appear, though the stack emits it all the same.
 */
export type SettleNavigation = {
  addListener: (type: string, listener: () => void) => () => void;
};

export function afterNavigationSettles(
  navigation: SettleNavigation,
  capMs: number = NAVIGATION_SETTLE_CAP_MS
): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      remove();
      resolve();
    };
    const timer = setTimeout(finish, capMs);
    const remove = navigation.addListener('transitionEnd', finish);
  });
}
