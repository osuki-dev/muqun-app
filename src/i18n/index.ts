// The i18n runtime: polyfills, catalogs, and the one hook screens use.
//
// Messages are written as natural language in the source -- `<Trans>Pair a
// server</Trans>`, `` t`Retry` `` -- and `bun run i18n:extract` harvests them
// into `src/i18n/locales/<locale>/messages.po`. There is no key namespace to
// maintain, so a string that disappears from the source disappears from the
// catalog on the next extract.
// Hermes ships a partial `Intl`. `@lingui/core` needs `Intl.Locale` for its
// fallback chain and `Intl.PluralRules` for ICU plurals, and neither is
// reliably present across the OS versions Muqun supports. `/polyfill-force`
// installs unconditionally, which is cheaper than the feature detection in the
// default entry -- that detection is itself slow on the low-end Android devices
// we care about, and it runs on every cold start.
//
// First in the file on purpose: ES module imports evaluate in source order, so
// these have to sit above `@lingui/core` for it to find a complete `Intl`.
//
// One plural-rules data file per language we ship, named by the *language*
// subtag rather than the locale: the data for `zh-TW` is `zh`, and there is no
// `zh-TW.js` to import. A locale whose data is missing does not throw -- it
// falls back to English pluralisation, which is wrong in exactly the languages
// that need it most, and wrong silently. So this list has to grow with
// `APP_LOCALES` even though nothing type-checks that it did.
import '@formatjs/intl-getcanonicallocales/polyfill-force';
import '@formatjs/intl-locale/polyfill-force';
import '@formatjs/intl-pluralrules/polyfill-force';
import '@formatjs/intl-pluralrules/locale-data/en';
import '@formatjs/intl-pluralrules/locale-data/zh';
import '@formatjs/intl-pluralrules/locale-data/ja';
import '@formatjs/intl-pluralrules/locale-data/ko';
import '@formatjs/intl-pluralrules/locale-data/de';
import '@formatjs/intl-pluralrules/locale-data/fr';
import '@formatjs/intl-pluralrules/locale-data/es';
import '@formatjs/intl-pluralrules/locale-data/pt';

import { i18n } from '@lingui/core';

import { setActiveLocale } from './active-locale';
import { messages as enMessages } from './locales/en/messages';
import { messages as zhTWMessages } from './locales/zh-TW/messages';
import { messages as jaMessages } from './locales/ja/messages';
import { messages as koMessages } from './locales/ko/messages';
import { messages as deMessages } from './locales/de/messages';
import { messages as frMessages } from './locales/fr/messages';
import { messages as esMessages } from './locales/es/messages';
import { messages as ptMessages } from './locales/pt/messages';
import { APP_LOCALES, SOURCE_LOCALE, type AppLocale } from './locale';

export * from './locale';
export { getActiveLocale, activeLocaleHeaders } from './active-locale';

const catalogs: Record<AppLocale, typeof enMessages> = {
  en: enMessages,
  'zh-TW': zhTWMessages,
  ja: jaMessages,
  ko: koMessages,
  de: deMessages,
  fr: frMessages,
  es: esMessages,
  pt: ptMessages,
};

let loaded = false;

/**
 * Make every catalog available and select one.
 *
 * Every catalog is loaded rather than fetched on demand. Eight compiled
 * catalogs of ~200 messages are a few tens of kilobytes of strings the bundle
 * already has to ship, and a language switch that has to wait on I/O is a
 * language switch that flickers. `i18n.activate` is what actually re-renders
 * the tree, through the `I18nProvider` in the root layout.
 */
export function activateLocale(locale: AppLocale): void {
  if (!loaded) {
    for (const code of APP_LOCALES) {
      i18n.load(code, catalogs[code]);
    }
    loaded = true;
  }
  i18n.activate(locale);
  // Mirrored where the network layer can read it without importing this module
  // and, with it, the polyfills and every catalog.
  setActiveLocale(locale);
}

/** The locale currently rendering, for the code that has to ask rather than render. */
export function currentLocale(): AppLocale {
  const active = i18n.locale;
  return (APP_LOCALES as readonly string[]).includes(active)
    ? (active as AppLocale)
    : SOURCE_LOCALE;
}

export { i18n };
