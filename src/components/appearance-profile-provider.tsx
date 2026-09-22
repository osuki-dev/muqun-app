import { createContext, useContext, type ReactNode } from 'react';

import { resolveAppearanceProfile, type AppearanceProfile } from '@/lib/appearance-profile';
import { useAppSettings } from '@/stores/app-settings';

const AppearanceProfileContext = createContext<AppearanceProfile>(
  resolveAppearanceProfile('classic')
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
