import { useEffect, useEffectEvent } from 'react';
import { BackHandler } from 'react-native';

/**
 * While `open`, Android's back button closes what is open instead of leaving
 * the screen. Subscribed when it opens, so it runs before the route's back.
 */
export function useBackToClose(open: boolean, close: () => void): void {
  const onBack = useEffectEvent(close);
  useEffect(() => {
    if (!open) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => subscription.remove();
  }, [open]);
}
