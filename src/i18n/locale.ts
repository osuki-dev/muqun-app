// Which languages Muqun speaks, and how a device's preference becomes one.
//
// The codes here are not ours to invent. They are copied from the marketing
// site (`~/.osuki/web`, `src/lib/site-chrome.ts`), and the identical string is
// used in four places that must agree or the feature silently degrades to
// English: this catalog's directory name, the value persisted in app settings,
// the `X-Muqun-Locale` request header, and the gateway's language table. So:
// `zh-TW`, not `zh-Hant`, not `zh-Hant-TW`, not `zh_TW`.
//
// The six languages besides English and Traditional Chinese carry no region for
// the same reason: the website spells them `ja ko de fr es pt`, so one `pt`
// catalog serves Brazil and Portugal and one `es` catalog serves Spain and
// Latin America. Splitting either into regional variants here would invent a
// code the other two surfaces have never heard of.
//
// The order is the website's, and it is the order the picker renders in:
// English, Traditional Chinese, then the rest. It is not alphabetical and
// should not be "tidied" into being.
//
// Everything in this file is deliberately free of React and of native modules,
// so the negotiation rules can be tested as the pure functions they are.

export const APP_LOCALES = ['en', 'zh-TW', 'ja', 'ko', 'de', 'fr', 'es', 'pt'] as const;

export type AppLocale = (typeof APP_LOCALES)[number];

/** The locale used to author the source strings, and the end of every fallback chain. */
export const SOURCE_LOCALE: AppLocale = 'en';

/**
 * Language names written in their own language, which is the only labelling
 * that works in a language picker: someone looking for Chinese is not reading
 * the English word "Chinese".
 */
export const LOCALE_LABELS: Record<AppLocale, string> = {
  en: 'English',
  'zh-TW': '繁體中文',
  ja: '日本語',
  ko: '한국어',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
  pt: 'Português',
};

/**
 * The name under the icon, which this module does *not* control.
 *
 * Everything else here is JavaScript, resolved at runtime and changeable over
 * the air. The app's display name is not: it is baked into `Info.plist` on iOS
 * and `res/values/strings.xml` on Android, chosen by the operating system from
 * the device language before a line of JS has run. So it is configured, not
 * coded -- `expo.locales` in `app.json` points at one `native-locales/<code>.json`
 * per locale here, and `@expo/config-plugins` turns each into
 * `<code>.lproj/InfoPlist.strings` (`CFBundleDisplayName`) on iOS and
 * `res/values-b+<code>/strings.xml` (`app_name`) on Android during prebuild.
 * The file names are these same codes, which is why `native-locale-names` in
 * the catalog tests asserts the two lists are equal.
 *
 * Muqun is a brand name, and most of these files say "Muqun" for exactly that
 * reason -- the same reason the gateway's tables leave "Gateway" in Latin
 * script. `zh-TW` and `ja` are the deliberate exceptions: the site at
 * osuki.dev already gives the product a native name there, 牧群, and
 * `native-locales/zh-TW.json` and `native-locales/ja.json` carry it too, so a
 * reader who knows the app as 牧群 does not meet "Muqun" in a permission
 * prompt or the App Store's own listing of the app's name. The pipeline is
 * wired up for every locale regardless, because the alternative is
 * discovering it does not work on the day another market needs a local name,
 * and that day is a native build away from being fixed rather than an OTA.
 *
 * Anything changed here ships with a full build. It is not an OTA change.
 */

/** `null` means "follow the system", which is the default and not a locale. */
export type LocalePreference = AppLocale | null;

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === 'string' && (APP_LOCALES as readonly string[]).includes(value);
}

export function isLocalePreference(value: unknown): value is LocalePreference {
  return value === null || isAppLocale(value);
}

/**
 * Fold one BCP 47 tag onto a locale we actually ship.
 *
 * Matching is deliberately generous in one direction only. An exact hit wins;
 * then the script subtag, because `zh-Hant`, `zh-Hant-HK` and `zh-TW` are the
 * same catalog to us; then the region; and finally the bare language, but only
 * for languages whose variants we do not distinguish. A device set to
 * Simplified Chinese (`zh-Hans`, `zh-CN`, `zh-SG`) deliberately does *not*
 * match `zh-TW` -- serving Traditional characters to a Simplified reader is a
 * worse answer than English, and it would also be a silent claim to support a
 * language nobody has translated.
 *
 * Chinese is the only language we split, so it is the only one with a rule of
 * its own. Every other catalog we ship is named by a bare language subtag, and
 * the last step below simply asks whether the tag's language *is* one of them.
 * That is what makes `pt-BR` and `pt-PT` both Portuguese here, and `es-419`,
 * `es-MX` and `es-ES` all Spanish: we have one catalog for each, and a
 * Brazilian reader served European Portuguese is still being served
 * Portuguese. The comparison is against `APP_LOCALES` rather than a second
 * hand-written list, so adding a language cannot leave device negotiation
 * behind.
 */
export function matchLocale(tag: string | null | undefined): AppLocale | null {
  if (typeof tag !== 'string') return null;
  const trimmed = tag.trim();
  if (!trimmed) return null;

  const normalized = trimmed.replace(/_/g, '-').toLowerCase();
  const subtags = normalized.split('-').filter(Boolean);
  if (subtags.length === 0) return null;

  for (const locale of APP_LOCALES) {
    if (locale.toLowerCase() === normalized) return locale;
  }

  const [language, ...rest] = subtags;

  if (language === 'zh') {
    // Script wins over region: `zh-Hans-TW` is Simplified text, whatever the
    // region says.
    if (rest.includes('hans')) return null;
    if (rest.includes('hant')) return 'zh-TW';
    if (rest.some((part) => part === 'tw' || part === 'hk' || part === 'mo')) return 'zh-TW';
    return null;
  }

  // Every remaining catalog is named by a bare language subtag, so the tag's
  // own language is the answer if we happen to ship it. `zh` cannot arrive here
  // -- it returned above -- and `zh-TW` is not a bare subtag, so there is no
  // path by which a Chinese tag falls through into this.
  for (const locale of APP_LOCALES) {
    if (locale === language) return locale;
  }

  return null;
}

/**
 * Pick a locale from the device's ordered preference list.
 *
 * `expo-localization` returns the user's languages most-wanted first, so the
 * first tag that maps onto something we ship wins. A device that wants nothing
 * we have gets the source locale rather than an error.
 */
export function negotiateLocale(preferredTags: readonly (string | null | undefined)[]): AppLocale {
  for (const tag of preferredTags) {
    const matched = matchLocale(tag);
    if (matched) return matched;
  }
  return SOURCE_LOCALE;
}

/**
 * The locale the app should actually render in.
 *
 * An explicit choice in Settings always beats the system, including the case
 * where it agrees with it -- that is the point of the setting. `null` hands the
 * decision back to the device.
 */
export function resolveLocale(
  preference: LocalePreference,
  preferredTags: readonly (string | null | undefined)[]
): AppLocale {
  if (preference && isAppLocale(preference)) return preference;
  return negotiateLocale(preferredTags);
}

/**
 * The headers every gateway request carries.
 *
 * `X-Muqun-Locale` is the one the gateway reads first: it is a single exact
 * code with no q-values to parse and no negotiation to get wrong.
 * `Accept-Language` carries the same value because it is the standard header
 * and anything sitting between the phone and the gateway will understand it.
 *
 * Note this is the *effective* locale -- what the UI is rendering right now --
 * so a manual override in Settings is what the gateway sees, not the raw system
 * language the device would have reported.
 */
export function localeHeaders(locale: AppLocale): Record<string, string> {
  return {
    'X-Muqun-Locale': locale,
    'Accept-Language': locale,
  };
}
