import { useCallback, useSyncExternalStore } from 'react';
import { useNavigation, useRoute } from 'expo-router';

import { seenThroughRoutes } from '@/lib/route-presentation';

/**
 * Whether this screen is still in view, which is not whether it is focused: a
 * sheet pushed over it blurs it while leaving it on screen (`seenThroughRoutes`).
 *
 * Read from the navigator's state in one snapshot rather than combined with
 * `useIsFocused`, whose blur and the push that causes it can land in different
 * renders -- one render of "not focused and not under a sheet" is a teardown.
 */
export function useScreenVisible(isPad: boolean): boolean {
  const navigation = useNavigation();
  const { key } = useRoute();
  const subscribe = useCallback(
    (onChange: () => void) => navigation.addListener('state', onChange),
    [navigation]
  );
  const getSnapshot = useCallback(() => {
    const state = navigation.getState();
    if (!state) return true;
    const index = state.routes.findIndex((route) => route.key === key);
    if (index < 0) return false;
    return seenThroughRoutes(
      state.routes.slice(index + 1).map((route) => route.name),
      isPad
    );
  }, [isPad, key, navigation]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
