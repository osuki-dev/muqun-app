import { useLingui } from '@lingui/react/macro';

import { relativeTimeParts } from '@/lib/asset-display';

/**
 * "just now", "4m ago", "2h ago" -- said in the active locale.
 *
 * A hook returning a formatter rather than a helper taking `t`: a `t` passed
 * as a parameter is a binding the Lingui macro cannot walk back to
 * `useLingui()`, so it silently never expands (see
 * `src/i18n/__tests__/macro-expansion.test.ts`). One message per unit rather
 * than a template with a unit letter in a hole, because "4m ago" is English's
 * abbreviation and a translator needs the whole sentence to write their own.
 */
export function useRelativeTime(): (unixMs: number, now?: number) => string {
  const { t } = useLingui();
  return (unixMs, now) => {
    const parts = relativeTimeParts(unixMs, now);
    switch (parts.unit) {
      case 'none':
        return '';
      case 'now':
        return t`just now`;
      case 'minute':
        return t`${parts.value}m ago`;
      case 'hour':
        return t`${parts.value}h ago`;
      case 'day':
        return t`${parts.value}d ago`;
      case 'date':
        // Past a week the date says it better than a count of days would, and
        // the device formats it in its own regional shape.
        return new Date(parts.value).toLocaleDateString();
    }
  };
}
