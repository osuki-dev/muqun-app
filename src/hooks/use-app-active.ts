import { useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

/**
 * Whether the app is the thing the reader is looking at.
 *
 * Work that only exists to be seen -- a pulse, a shimmer, a countdown -- has no
 * reason to run while it cannot be. The polling loops in
 * `use-collaboration-output` and `use-agent-collaboration` already ask
 * `AppState` this question inline; this is the same question for the render
 * path, where an effect needs it as state rather than as a one-off check.
 *
 * `inactive` counts as away. On iOS it covers the app switcher, a system sheet
 * and the Face ID gate -- all moments when nothing of ours is being watched.
 */
export function useAppActive(): boolean {
  const [active, setActive] = useState(() => AppState.currentState === 'active');
  useEffect(() => {
    // Between the initial state above and this subscription the app may already
    // have changed, so read it again rather than trusting the first render.
    setActive(AppState.currentState === 'active');
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) =>
      setActive(next === 'active')
    );
    return () => subscription.remove();
  }, []);
  return active;
}
