import { createContext, useContext, type ReactNode } from 'react';

import { resolveAppearanceProfile, type AppearanceProfile } from '@/lib/appearance-profile';
import { DEFAULT_HOME_LAYOUT } from '@/lib/home-layout';
import { useAppSettings } from '@/stores/app-settings';

const AppearanceProfileContext = createContext<AppearanceProfile>(
  resolveAppearanceProfile(DEFAULT_HOME_LAYOUT)
);

export function AppearanceProfileProvider({ children }: { children: ReactNode }) {
  const homeLayout = useAppSettings((state) => state.homeLayout);
  return (
    <AppearanceProfileContext.Provider value={resolveAppearanceProfile(homeLayout)}>
      {children}
    </AppearanceProfileContext.Provider>
  );
}

export function useAppearanceProfile(): AppearanceProfile {
  return useContext(AppearanceProfileContext);
}
