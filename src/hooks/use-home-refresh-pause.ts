import { createContext, useContext } from 'react';

import type { HomeRefreshPause } from '@/lib/home-refresh-schedule';

/**
 * The pause signal of a Home that stays mounted while hidden (the Pad overlay).
 * Provided outside that Home's `Freeze`; a Home with no provider (phone, the
 * rail's Continue) never pauses.
 */
export const HomeRefreshPauseContext = createContext<HomeRefreshPause | null>(null);

export function useHomeRefreshPause(): HomeRefreshPause | null {
  return useContext(HomeRefreshPauseContext);
}
