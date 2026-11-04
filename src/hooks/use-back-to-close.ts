import { useIsFocused } from 'expo-router';
import { useEffect, useEffectEvent } from 'react';
import { BackHandler } from 'react-native';

/**
 * While `open`, Android's back button closes what is open instead of leaving
 * the screen. Subscribed when it opens, so it runs before the route's back.
 * Only while its screen is focused: a menu left open beneath a route sheet
 * (Home's options under the computer picker) must not take the back meant
 * for the sheet on top.
 */
export function useBackToClose(open: boolean, close: () => void): void {
  const focused = useIsFocused();
  const onBack = useEffectEvent(close);
  useEffect(() => {
    if (!open || !focused) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => subscription.remove();
  }, [open, focused]);
}
