// The locale the UI is currently rendering, readable from outside React.
//
// The network layer has to stamp a locale on every request, and it does that in
// plain functions -- `gatewayFetch`, `gatewayAuthHeaders` -- that have no hooks
// and no context. This module is the seam. It is deliberately its own file and
// deliberately dependency-free: `src/i18n/index.ts` pulls in the Intl polyfills
// and both catalogs, and the network layer has no business importing either.
import { SOURCE_LOCALE, localeHeaders, type AppLocale } from './locale';

let active: AppLocale = SOURCE_LOCALE;

/** Called by `activateLocale`. Nothing else should write this. */
export function setActiveLocale(locale: AppLocale): void {
  active = locale;
}

export function getActiveLocale(): AppLocale {
  return active;
}

/** The locale headers for the request being built right now. */
export function activeLocaleHeaders(): Record<string, string> {
  return localeHeaders(active);
}
