import { useCallback, useSyncExternalStore } from 'react';
import { useNavigation } from 'expo-router';

/** Subscribe to root transitions instead of caching an imperative state read. */
export function useRootRouteName(): string | undefined {
  const navigation = useNavigation('/');
  const subscribe = useCallback(
    (onChange: () => void) => navigation.addListener('state', onChange),
    [navigation]
  );
  const getSnapshot = useCallback(() => {
    const state = navigation.getState();
    return state?.routes[state.index]?.name;
  }, [navigation]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
