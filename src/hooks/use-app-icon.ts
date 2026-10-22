import {
  getAppIconName,
  setAlternateAppIcon,
  supportsAlternateIcons,
} from 'expo-alternate-app-icons';
import { useCallback, useState } from 'react';
import { create } from 'zustand';

import { type AppIconId, appIconFromNative, nativeAppIconName } from '@/lib/app-icon';
import { settleAfter } from '@/lib/compiler-safe-control-flow';

/**
 * The OS is the store: the module reads the active icon back from it, so
 * nothing is persisted here and a reinstall cannot disagree with the home
 * screen. This mirror only lets every reader (the picker, and each in-app
 * brand mark) see a change made while they are mounted.
 */
const useActiveAppIconStore = create<{ icon: AppIconId }>(() => ({
  icon: appIconFromNative(supportsAlternateIcons ? getAppIconName() : null),
}));

/** The launcher icon in effect, for surfaces that draw the brand. */
export function useActiveAppIcon(): AppIconId {
  return useActiveAppIconStore((state) => state.icon);
}

/**
 * The launcher icon in effect, and the one call that changes it.
 *
 * `supported` is false on web and on the odd launcher that refuses
 * alternates, and the picker stays off the page there rather than offering
 * a choice that does nothing.
 */
export function useAppIcon() {
  const icon = useActiveAppIcon();
  const [busy, setBusy] = useState(false);

  const choose = useCallback(async (next: AppIconId) => {
    setBusy(true);
    return settleAfter(
      async () => {
        const applied = await setAlternateAppIcon(nativeAppIconName(next));
        useActiveAppIconStore.setState({ icon: appIconFromNative(applied) });
      },
      () => {
        setBusy(false);
      }
    );
  }, []);

  return { icon, choose, busy, supported: supportsAlternateIcons };
}
