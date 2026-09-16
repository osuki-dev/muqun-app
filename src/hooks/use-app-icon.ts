import { useCallback, useState } from 'react';

import type { AppIconId } from '@/lib/app-icon';

/**
 * Fallback app icon hook for platforms where alternate icons are unsupported.
 */
export function useAppIcon() {
  const [icon] = useState<AppIconId>('default');
  const choose = useCallback(async (_next: AppIconId) => {}, []);

  return { icon, choose, busy: false, supported: false };
}
