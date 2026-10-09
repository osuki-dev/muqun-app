import { useLingui } from '@lingui/react/macro';

import { taskAgeParts } from '@/lib/server-tasks-state';

/** "5m ago" said whole, so a translator can write their own sentence. */
export function useTaskAge() {
  const { t } = useLingui();
  return (updatedMs: number, nowMs: number) => {
    const age = taskAgeParts(updatedMs, nowMs);
    if (age.unit === 'now') return t`just now`;
    if (age.unit === 'minute') return t`${age.value}m ago`;
    if (age.unit === 'hour') return t`${age.value}h ago`;
    return t`${age.value}d ago`;
  };
}
