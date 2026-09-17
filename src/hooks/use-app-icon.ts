import {
  getAppIconName,
  setAlternateAppIcon,
  supportsAlternateIcons,
} from 'expo-alternate-app-icons';
import { useCallback, useState } from 'react';

import { type AppIconId, appIconFromNative, nativeAppIconName } from '@/lib/app-icon';

/**
 * The launcher icon in effect, and the one call that changes it.
 *
 * The OS is the store: the module reads the active icon back from it, so
 * nothing is persisted here and a reinstall cannot disagree with the home
 * screen. `supported` is false on web and on the odd launcher that refuses
 * alternates, and the picker stays off the page there rather than offering
 * a choice that does nothing.
 */
export function useAppIcon() {
  const [icon, setIcon] = useState<AppIconId>(() =>
    appIconFromNative(supportsAlternateIcons ? getAppIconName() : null)
  );
  const [busy, setBusy] = useState(false);

  const choose = useCallback(async (next: AppIconId) => {
    setBusy(true);
    try {
      const applied = await setAlternateAppIcon(nativeAppIconName(next));
      setIcon(appIconFromNative(applied));
    } finally {
      setBusy(false);
    }
  }, []);

  return { icon, choose, busy, supported: supportsAlternateIcons };
}
